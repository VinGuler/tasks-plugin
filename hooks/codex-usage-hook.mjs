#!/usr/bin/env node
// Tasks usage reporter for Codex (DOC-41 "Codex adapter design", roadmap #18). Runs from Codex's
// hooks, async where it can be, outside the model: zero model tokens, prints nothing (empty
// stdout is what every Codex hook event requires) and always exits 0.
//
// PostModelRequest: appends the request's token counts to a spool, ~/.tasks/codex/<session>.jsonl.
// PostToolUse (Tasks' MCP tools only): follows which item the session works on and under which
// agent label, from set_status and the `agent` argument. Stop / SessionEnd: send the spool to
// Tasks (POST /api/usage, tool "codex"), or append it to ~/.tasks/usage.jsonl in local mode.
//
// Config, token, local mode, POST, lock and last-run.json are the Claude Code hook's
// (tasks-usage-hook.mjs, installed next to this file).
//
// Privacy: only token counts, the model name, ids, item keys and the agent label are read. Never
// prompts, last_assistant_message, tool_response, cwd or transcript_path; of tool_input only
// key, keys, status and agent.
//
// Dedupe contract (as for Claude Code): a dedupeKey names ONE fixed set of requests; a failed
// POST keeps the exact records and resends them unchanged before reading the spool on.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ITEM_KEY,
  ID_RE,
  MODEL_RE,
  STATUSES,
  LABEL_RE,
  nextItem,
  tasksToolRe,
  readJson,
  writeJson,
  postAll,
  appendLocal,
  writeLastRun,
  withLock,
} from './tasks-usage-hook.mjs';

export const CODEX_VERSION = 1;

const MAX_TOKENS = 1_000_000_000;
const DAY_MS = 86_400_000;
const MAX_WINDOW_MS = 6 * DAY_MS;
/** A spool untouched this long belongs to a session whose last hook was cancelled. */
const STALE_MS = 15 * 60_000;
const CLEAN_MS = DAY_MS;
const STATUS_TOOL = /^mcp__[A-Za-z0-9_-]+__set_status(_bulk)?$/;

const count = (v) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.min(Math.max(n, 0), MAX_TOKENS);
};

/** OpenAI counts cached and written tokens inside input_tokens, reasoning inside output_tokens. */
export function mapUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const total = count(u.input_tokens);
  const cacheRead = count(u.cached_input_tokens);
  const cacheWrite = count(u.cache_write_input_tokens);
  return {
    input: Math.max(0, total - cacheRead - cacheWrite),
    output: count(u.output_tokens),
    cacheRead,
    cacheWrite,
    cacheWriteLong: 0,
    prompt: total,
  };
}

/** What a Tasks tool call changes: the item (status calls) and the agent label. */
export function applyToolCall(state, toolName, toolInput, tasksTool = tasksToolRe()) {
  const next = { item: state.item ?? null, agent: state.agent ?? null };
  if (typeof toolName !== 'string' || !tasksTool.test(toolName)) return next;
  if (!toolInput || typeof toolInput !== 'object') return next;
  const label = typeof toolInput.agent === 'string' ? toolInput.agent.trim() : '';
  if (LABEL_RE.test(label)) next.agent = label;
  if (STATUS_TOOL.test(toolName)) {
    const keys = (toolName.endsWith('_bulk') ? toolInput.keys : [toolInput.key]) ?? [];
    const valid = (Array.isArray(keys) ? keys : []).filter(
      (k) => typeof k === 'string' && ITEM_KEY.test(k)
    );
    if (valid.length && STATUSES.has(toolInput.status)) {
      next.item = nextItem(next.item, { keys: valid, status: toolInput.status });
    }
  }
  return next;
}

/** Group spool lines into records: consecutive lines with the same agent, item, label, model. */
export function buildCodexRecords(lines, { sessionId, now }) {
  const records = [];
  let open = null;
  const same = (l) =>
    open &&
    open.agentId === l.agentId &&
    open.item === l.item &&
    open.label === l.label &&
    open.model === l.model &&
    l.t - open.t0 <= MAX_WINDOW_MS;
  for (const l of lines) {
    if (!same(l)) {
      open = {
        first: l.id,
        agentId: l.agentId,
        item: l.item,
        label: l.label,
        model: l.model,
        t0: l.t,
        t1: l.t,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 },
        requests: 0,
        maxPrompt: 0,
      };
      records.push(open);
    }
    for (const f of Object.keys(open.tokens)) open.tokens[f] += l[f];
    open.requests += 1;
    open.t0 = Math.min(open.t0, l.t);
    open.t1 = Math.max(open.t1, l.t);
    open.maxPrompt = Math.max(open.maxPrompt, l.prompt);
  }
  return records.map((rec) => {
    const out = {
      dedupeKey: `cx:${sessionId}:${rec.agentId ?? 'main'}:${rec.first}`.replace(
        /[^A-Za-z0-9._:@/+=-]/g,
        '_'
      ),
      windowStart: new Date(Math.min(rec.t0, now)).toISOString(),
      windowEnd: new Date(Math.min(rec.t1, now)).toISOString(),
      tokens: rec.tokens,
      requests: rec.requests,
    };
    if (rec.model) out.model = rec.model;
    if (rec.item) out.itemKey = rec.item;
    if (rec.label) out.agent = rec.label;
    out.sessionId = sessionId;
    if (rec.agentId) out.agentId = rec.agentId;
    if (rec.maxPrompt) out.maxPromptTokens = rec.maxPrompt;
    return out;
  });
}

/** One spool line, validated; null for anything that is not ours. */
function parseSpoolLine(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || !ID_RE.test(String(o.id)) || !Number.isFinite(o.t)) {
    return null;
  }
  return {
    id: o.id,
    t: o.t,
    model: typeof o.model === 'string' && MODEL_RE.test(o.model) ? o.model : null,
    agentId: typeof o.agentId === 'string' && ID_RE.test(o.agentId) ? o.agentId : null,
    item: typeof o.item === 'string' && ITEM_KEY.test(o.item) ? o.item : null,
    label: typeof o.label === 'string' && LABEL_RE.test(o.label) ? o.label : null,
    input: count(o.input),
    output: count(o.output),
    cacheRead: count(o.cacheRead),
    cacheWrite: count(o.cacheWrite),
    cacheWriteLong: 0,
    prompt: count(o.prompt),
  };
}

const safeId = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

/** Hook event PostModelRequest: spool one request's counts. */
function spoolRequest(home, input, now) {
  const usage = mapUsage(input.token_usage);
  if (!usage) return;
  const dir = path.join(home, 'codex');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const session = input.session_id;
  const state = readJson(path.join(dir, `${session}.state.json`)) || {};
  const turn = safeId(input.turn_id) ?? 'turn';
  const line = {
    id: `${turn}:${crypto.randomBytes(4).toString('hex')}`.slice(0, 100),
    t: now,
    model: typeof input.model === 'string' && MODEL_RE.test(input.model) ? input.model : null,
    agentId: safeId(input.agent_id),
    item: typeof state.item === 'string' && ITEM_KEY.test(state.item) ? state.item : null,
    label: typeof state.agent === 'string' && LABEL_RE.test(state.agent) ? state.agent : null,
    ...usage,
  };
  // O_APPEND of one short line: concurrent async hooks do not interleave.
  fs.appendFileSync(path.join(dir, `${session}.jsonl`), JSON.stringify(line) + '\n', {
    mode: 0o600,
  });
}

/** Hook event PostToolUse: follow the item and label of the session. */
function trackTool(home, cfg, input) {
  const dir = path.join(home, 'codex');
  const file = path.join(dir, `${input.session_id}.state.json`);
  const prev = readJson(file) || {};
  // Not `mcpServer`: that is Claude Code's name for the server (the plugin's is
  // `plugin_tasks_tasks`), and Codex names it as added (`codex mcp add tasks`, the plugin's key).
  const server = cfg.codexMcpServer || 'tasks';
  const next = applyToolCall(prev, input.tool_name, input.tool_input, tasksToolRe(server));
  if (next.item === (prev.item ?? null) && next.agent === (prev.agent ?? null)) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJson(file, next);
}

/** Send what is new in one session's spool. Returns false when it must be retried later. */
async function flushSpool(home, cfg, local, session, ctx) {
  const dir = path.join(home, 'codex');
  const spool = path.join(dir, `${session}.jsonl`);
  const sentFile = path.join(dir, `${session}.sent.json`);
  const sent = readJson(sentFile) || {};
  let offset = Number.isInteger(sent.offset) ? sent.offset : 0;
  let pending = sent.pending || null;

  const send = async (records, nextOffset) => {
    if (!records.length) return true;
    if (local) {
      try {
        appendLocal(home, records);
        ctx.summary.sent += records.length;
        return true;
      } catch {
        ctx.summary.error = 'write failed';
      }
    } else {
      const r = await postAll(cfg, records, ctx.fetchFn, 'codex');
      ctx.summary.sent += r.stats.accepted;
      ctx.summary.duplicate += r.stats.duplicate;
      ctx.summary.rejected += r.stats.rejected;
      if (r.ok || r.permanent) return true;
      ctx.summary.error = `HTTP ${r.status}`;
    }
    writeJson(sentFile, { offset, pending: { records, next: nextOffset } });
    return false;
  };

  if (pending && Array.isArray(pending.records)) {
    if (!(await send(pending.records, pending.next))) return false;
    offset = Number.isInteger(pending.next) ? pending.next : offset;
    pending = null;
    writeJson(sentFile, { offset, pending: null });
  }

  let buf;
  try {
    buf = fs.readFileSync(spool);
  } catch {
    return true;
  }
  if (buf.length < offset) offset = 0; // the spool shrank: start over (the server dedupes)
  const end = buf.lastIndexOf(10) + 1; // complete lines only
  if (end <= offset) return true;
  const lines = buf
    .toString('utf8', offset, end)
    .split('\n')
    .filter(Boolean)
    .map(parseSpoolLine)
    .filter(Boolean);
  const records = buildCodexRecords(lines, { sessionId: session, now: ctx.now });
  if (!(await send(records, end))) return false;
  writeJson(sentFile, { offset: end, pending: null });
  return true;
}

/** Remove the files of sessions that are fully sent and a day old. */
function cleanup(home, now) {
  const dir = path.join(home, 'codex');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const m = /^(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      const sent = readJson(path.join(dir, `${m[1]}.sent.json`));
      if (now - st.mtimeMs < CLEAN_MS || !sent || sent.pending || sent.offset < st.size) continue;
      for (const f of [name, `${m[1]}.sent.json`, `${m[1]}.state.json`]) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
    } catch {
      /* gone meanwhile */
    }
  }
}

async function flushAll(home, cfg, local, session, ctx) {
  const dir = path.join(home, 'codex');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  await withLock(
    path.join(dir, 'flush.lock'),
    async () => {
      const sessions = new Set([session]);
      for (const name of fs.readdirSync(dir)) {
        const m = /^(.+)\.jsonl$/.exec(name);
        if (!m || !ID_RE.test(m[1]) || m[1] === session) continue;
        try {
          if (ctx.now - fs.statSync(path.join(dir, name)).mtimeMs >= STALE_MS) sessions.add(m[1]);
        } catch {
          /* gone meanwhile */
        }
      }
      for (const s of sessions) await flushSpool(home, cfg, local, s, ctx);
      cleanup(home, ctx.now);
    },
    ctx.sleep
  );
}

/**
 * One hook run. `env`: { home, fetch, now, sleep } are injectable for tests.
 * Returns a small summary (never throws).
 */
export async function run(input, env = {}) {
  const home = env.home || process.env.TASKS_HOME || path.join(os.homedir(), '.tasks');
  const now = env.now ?? Date.now();
  const summary = { sent: 0, duplicate: 0, rejected: 0, error: null };
  let flushed = false;
  try {
    const cfg = readJson(path.join(home, 'config.json'));
    const local = !!cfg && cfg.mode === 'local';
    if (!cfg || !input || !ID_RE.test(String(input.session_id))) return summary;
    if (!local && (!cfg.baseUrl || !cfg.token)) return summary;
    const event = input.hook_event_name;
    if (event === 'PostModelRequest') spoolRequest(home, input, now);
    else if (event === 'PostToolUse') trackTool(home, cfg, input);
    else if (event === 'Stop' || event === 'SessionEnd') {
      flushed = true;
      await flushAll(home, cfg, local, input.session_id, {
        summary,
        now,
        fetchFn: env.fetch || globalThis.fetch,
        sleep: env.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
      });
    }
  } catch (err) {
    summary.error = String((err && err.message) || err).slice(0, 200);
  }
  // The per-request and per-tool events are too frequent for a status file; only flushes report.
  if (flushed) writeLastRun(home, now, summary);
  return summary;
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  const timer = setTimeout(() => process.stdin.destroy(), 3000);
  try {
    for await (const c of process.stdin) chunks.push(c);
  } catch {
    /* stdin closed */
  }
  clearTimeout(timer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = await readStdin();
  if (input) await run(input);
  process.exit(0);
}

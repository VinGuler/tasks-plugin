#!/usr/bin/env node
// Tasks usage reporter for Antigravity (agy). Runs from agy's Stop hook (hooks.json at the plugin
// root), outside the model: zero model tokens, prints `{}` (the empty result agy expects) and
// always exits 0.
//
// Stop (the end of each turn): reads what is new in the conversation's transcript
// (`transcriptPath` in the hook input), takes the token counts of each model response, follows
// which item the conversation works on and under which agent label from Tasks' own MCP calls
// (set_status and the `agent` argument), and sends it to Tasks (POST /api/usage, tool
// "antigravity"), or appends it to ~/.tasks/usage.jsonl in local mode.
//
// Config, token, local mode, POST, lock and last-run.json are the Claude Code hook's
// (tasks-usage-hook.mjs, next to this file).
//
// Privacy: of the transcript only step_index, type, created_at, the token counts and, of Tasks'
// MCP calls, the tool name and the key, keys, status and agent arguments are read. Never prompts,
// replies, thinking, file paths or tool output; of the hook input never lastUserInput.
//
// Dedupe contract (as for Claude Code and Codex): a dedupeKey names ONE fixed set of steps; a
// failed POST keeps the exact records and resends them unchanged before reading on.
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
  readJson,
  writeJson,
  postAll,
  appendLocal,
  writeLastRun,
  withLock,
} from './tasks-usage-hook.mjs';

export const AGY_VERSION = 1;

const MAX_TOKENS = 1_000_000_000;
const DAY_MS = 86_400_000;
const MAX_WINDOW_MS = 6 * DAY_MS;
const CLEAN_MS = DAY_MS;
const STATUS_TOOLS = new Set(['set_status', 'set_status_bulk']);

const count = (v) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.min(Math.max(n, 0), MAX_TOKENS);
};

/** agy shows display names ("Gemini 3.8 Flash"); Tasks takes ids: lower case, dashes. */
export function modelId(name) {
  if (typeof name !== 'string') return null;
  const id = name.trim().toLowerCase().replace(/\s+/g, '-');
  return id && id !== 'auto' && MODEL_RE.test(id) ? id : null;
}

/** agy writes some tool arguments as JSON text: decode them, else keep the value. */
const decoded = (v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** What one tool call of a response changes: the item (Tasks status calls) and the agent label. */
export function applyToolCall(state, call, server = 'tasks') {
  const next = { item: state.item ?? null, agent: state.agent ?? null };
  if (!call || call.name !== 'call_mcp_tool' || !call.args || typeof call.args !== 'object') {
    return next;
  }
  if (decoded(call.args.ServerName) !== server) return next;
  const tool = decoded(call.args.ToolName);
  const args = decoded(call.args.Arguments);
  if (typeof tool !== 'string' || !args || typeof args !== 'object') return next;
  const label = typeof args.agent === 'string' ? args.agent.trim() : '';
  if (LABEL_RE.test(label)) next.agent = label;
  if (STATUS_TOOLS.has(tool)) {
    const keys = (tool === 'set_status_bulk' ? args.keys : [args.key]) ?? [];
    const valid = (Array.isArray(keys) ? keys : []).filter(
      (k) => typeof k === 'string' && ITEM_KEY.test(k)
    );
    if (valid.length && STATUSES.has(args.status)) {
      next.item = nextItem(next.item, { keys: valid, status: args.status });
    }
  }
  return next;
}

/**
 * Transcript lines → one entry per model response, tagged with the item and label it was made
 * under (the state before its own tool calls), and the state after them.
 */
export function readSteps(lines, state, server) {
  let cur = { item: state.item ?? null, agent: state.agent ?? null };
  const steps = [];
  for (const text of lines) {
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object' || o.type !== 'PLANNER_RESPONSE') continue;
    const t = Date.parse(o.created_at);
    const input = count(o.input_tokens);
    const output = count(o.output_tokens);
    const cacheRead = count(o.cache_read_tokens);
    if (Number.isInteger(o.step_index) && Number.isFinite(t) && input + output + cacheRead > 0) {
      steps.push({
        index: o.step_index,
        t,
        item: cur.item,
        label: cur.agent,
        input,
        output,
        cacheRead,
      });
    }
    for (const call of Array.isArray(o.tool_calls) ? o.tool_calls : []) {
      cur = applyToolCall(cur, call, server);
    }
  }
  return { steps, state: cur };
}

/** Group steps into records: consecutive steps with the same item, label and model. */
export function buildAgyRecords(steps, { conversationId, model, now }) {
  const records = [];
  let open = null;
  for (const s of steps) {
    if (!open || open.item !== s.item || open.label !== s.label || s.t - open.t0 > MAX_WINDOW_MS) {
      open = {
        first: s.index,
        item: s.item,
        label: s.label,
        t0: s.t,
        t1: s.t,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 },
        requests: 0,
        maxPrompt: 0,
      };
      records.push(open);
    }
    open.tokens.input += s.input;
    open.tokens.output += s.output;
    open.tokens.cacheRead += s.cacheRead;
    open.requests += 1;
    open.t0 = Math.min(open.t0, s.t);
    open.t1 = Math.max(open.t1, s.t);
    open.maxPrompt = Math.max(open.maxPrompt, s.input + s.cacheRead);
  }
  return records.map((rec) => {
    const out = {
      dedupeKey: `ag:${conversationId}:${rec.first}`.replace(/[^A-Za-z0-9._:@/+=-]/g, '_'),
      windowStart: new Date(Math.min(rec.t0, now)).toISOString(),
      windowEnd: new Date(Math.min(rec.t1, now)).toISOString(),
      tokens: rec.tokens,
      requests: rec.requests,
    };
    if (model) out.model = model;
    if (rec.item) out.itemKey = rec.item;
    if (rec.label) out.agent = rec.label;
    out.sessionId = conversationId;
    if (rec.maxPrompt) out.maxPromptTokens = rec.maxPrompt;
    return out;
  });
}

/** Send what is new in one conversation's transcript. Returns false when it must be retried. */
async function flush(home, cfg, local, input, ctx) {
  const dir = path.join(home, 'agy');
  const conv = input.conversationId;
  const sentFile = path.join(dir, `${conv}.sent.json`);
  const sent = readJson(sentFile) || {};
  let offset = Number.isInteger(sent.offset) ? sent.offset : 0;
  let state = sent.state && typeof sent.state === 'object' ? sent.state : {};
  let pending = sent.pending || null;

  const send = async (records) => {
    if (!records.length) return true;
    if (local) {
      try {
        appendLocal(home, records);
        ctx.summary.sent += records.length;
        return true;
      } catch {
        ctx.summary.error = 'write failed';
        return false;
      }
    }
    const r = await postAll(cfg, records, ctx.fetchFn, 'antigravity');
    ctx.summary.sent += r.stats.accepted;
    ctx.summary.duplicate += r.stats.duplicate;
    ctx.summary.rejected += r.stats.rejected;
    if (r.ok || r.permanent) return true;
    ctx.summary.error = `HTTP ${r.status}`;
    return false;
  };

  if (pending && Array.isArray(pending.records)) {
    if (!(await send(pending.records))) return false;
    offset = Number.isInteger(pending.next) ? pending.next : offset;
    state = pending.state && typeof pending.state === 'object' ? pending.state : state;
    pending = null;
    writeJson(sentFile, { offset, state, pending: null });
  }

  const transcript = typeof input.transcriptPath === 'string' ? input.transcriptPath : '';
  let buf;
  try {
    buf = fs.readFileSync(transcript);
  } catch {
    return true;
  }
  if (buf.length < offset) offset = 0; // a new transcript: start over (the server dedupes)
  const end = buf.lastIndexOf(10) + 1; // complete lines only
  if (end <= offset) return true;
  const lines = buf.toString('utf8', offset, end).split('\n').filter(Boolean);
  const read = readSteps(lines, state, cfg.agyMcpServer || 'tasks');
  const records = buildAgyRecords(read.steps, {
    conversationId: conv,
    model: modelId(input.modelName),
    now: ctx.now,
  });
  if (!(await send(records))) {
    writeJson(sentFile, { offset, state, pending: { records, next: end, state: read.state } });
    return false;
  }
  writeJson(sentFile, { offset: end, state: read.state, pending: null });
  return true;
}

/** Remove the files of conversations that are fully sent and a day old. */
function cleanup(home, now) {
  const dir = path.join(home, 'agy');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.sent.json')) continue;
    try {
      const file = path.join(dir, name);
      const sent = readJson(file);
      if (now - fs.statSync(file).mtimeMs >= CLEAN_MS && sent && !sent.pending) {
        fs.rmSync(file, { force: true });
      }
    } catch {
      /* gone meanwhile */
    }
  }
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
    if (!cfg || !input || !ID_RE.test(String(input.conversationId))) return summary;
    if (!local && (!cfg.baseUrl || !cfg.token)) return summary;
    if (input.hookEventName !== 'Stop') return summary;
    flushed = true;
    const dir = path.join(home, 'agy');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    await withLock(
      path.join(dir, 'flush.lock'),
      async () => {
        await flush(home, cfg, local, input, {
          summary,
          now,
          fetchFn: env.fetch || globalThis.fetch,
        });
        cleanup(home, now);
      },
      env.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
    );
  } catch (err) {
    summary.error = String((err && err.message) || err).slice(0, 200);
  }
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
  process.stdout.write('{}\n');
  process.exit(0);
}

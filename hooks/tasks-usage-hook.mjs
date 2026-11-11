#!/usr/bin/env node
// Tasks usage reporter for Claude Code (DOC-41, roadmap #18). Runs from the stop hooks, async
// and outside the model: it costs zero model tokens, prints nothing, never blocks the session
// and always exits 0.
//
// Usage (Stop, StopFailure, SubagentStop, SessionEnd): reads only the NEW lines of the session
// transcript (a byte offset per file is
// kept in ~/.tasks/state/<session>.json), takes the token counters of each API request, cuts
// them into item segments from the `set_status` calls, adds the sub-agent files, and POSTs the
// result to Tasks (POST /api/usage) with a report-only token.
//
// Local mode ("mode": "local" in config.json, no baseUrl/token): the same records are appended
// as JSON lines to ~/.tasks/usage.jsonl (mode 600) instead of being POSTed; nothing leaves.
//
// Privacy: records are built from named numeric fields, ids, the model name, item keys and the
// agent's self-chosen label. No message text, code, path, cwd or tool input ever leaves (only
// `input.key(s)`/`input.status` of Tasks' status calls and `input.agent`, the label an agent
// passes to Tasks' own tools, are read). Lines that are not `assistant` lines are never parsed.
// The prompt and tool fields of the hook's own input are never read either.
//
// Dedupe contract: a dedupeKey names ONE fixed set of API requests. A failed POST keeps the
// exact records and resends them unchanged before reading on; a record is never grown.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = 5;

const ITEM_KEY = /^[A-Z]{2,5}-\d+$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const MODEL_RE = /^[A-Za-z0-9._:@/[\]-]{1,100}$/;
const STATUSES = new Set(['TODO', 'IN_PROGRESS', 'DONE']);
const STATUS_TOOL = /^mcp__[A-Za-z0-9_-]+__set_status(_bulk)?$/;
/** Tasks' MCP tools: their `agent` argument is the label the agent reports under. */
const TASKS_TOOL_NAMES =
  'approve_document|assign|clear_user_action|create_document|create_epic|create_folder|create_item|create_project|delete_item|get_context|get_document|get_item|get_project|get_roadmap|link_document|list_documents|list_folders|list_in_progress|list_items|list_members|list_projects|log_work|patch_document|report_usage|request_user_action|search|set_resume|set_roadmap_item|set_status|set_status_bulk|unlink_document|update_document|update_folder|update_item';
/** The MCP server name Tasks is registered under (`claude mcp add tasks …`); config `mcpServer`. */
const SERVER_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const tasksToolRe = (server = 'tasks') =>
  new RegExp(`^mcp__${SERVER_RE.test(server) ? server : 'tasks'}__(${TASKS_TOOL_NAMES})$`);
/** The server's label rule: one line, at most 100 characters. */
const LABEL_RE = /^[^\p{Cc}\p{Cf}\u2028\u2029]{1,100}$/u;
/** A sub-agent type from its .meta.json (`Explore`, `general-purpose`, a custom agent's name). */
const AGENT_TYPE_RE = /^[A-Za-z0-9 ._:-]{1,40}$/;
const MAX_TOKENS = 1_000_000_000;
const DAY_MS = 86_400_000;
/** Longest span of one record (the server allows 7 days). */
const MAX_WINDOW_MS = 6 * DAY_MS;
/** Older requests are refused by the server (90-day retention). */
const MAX_AGE_MS = 89 * DAY_MS;
/** Read at most this much of one file per run; the rest is caught up at the next event. */
const MAX_CHUNK = 32 * 1024 * 1024;
const BATCH = 200;
const SENT_KEEP = 200;
const SPAWNS_KEEP = 500;
const ASSISTANT = Buffer.from('"type":"assistant"');

/**
 * Installs before v4 also ran on these for the Live page's heartbeats (removed, roadmap #42).
 * Until the installer is re-run they still fire: nothing to do on them.
 */
const MID_TURN = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PostToolUse']);

const count = (v) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.min(Math.max(n, 0), MAX_TOKENS);
};

/**
 * Parse the complete lines of `buf` (which starts at file offset `base`). Only assistant lines
 * are decoded. Returns the usage lines, the item and spawn markers, and where the complete
 * lines end.
 */
export function scanChunk(
  buf,
  base = 0,
  { skipSidechain = false, tasksTool = tasksToolRe() } = {}
) {
  const lines = [];
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break; // a half-written last line: leave it for the next run
    const start = pos;
    pos = nl + 1;
    if (!buf.subarray(start, nl).includes(ASSISTANT)) continue;
    let o;
    try {
      o = JSON.parse(buf.toString('utf8', start, nl));
    } catch {
      continue;
    }
    if (!o || o.type !== 'assistant') continue;
    if (skipSidechain && o.isSidechain === true) continue;
    const line = { start: base + start, end: base + pos, ts: Date.parse(o.timestamp) };
    const msg = o.message;
    const requestId = typeof o.requestId === 'string' ? o.requestId : null;
    const u = msg && msg.usage;
    if (
      requestId &&
      u &&
      typeof u === 'object' &&
      msg.model !== '<synthetic>' &&
      Number.isFinite(line.ts)
    ) {
      const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : {};
      const long = count(cc.ephemeral_1h_input_tokens);
      const write = Math.max(
        count(u.cache_creation_input_tokens),
        count(cc.ephemeral_5m_input_tokens) + long
      );
      line.req = {
        requestId,
        model: typeof msg.model === 'string' && MODEL_RE.test(msg.model) ? msg.model : null,
        input: count(u.input_tokens),
        output: count(u.output_tokens),
        cacheRead: count(u.cache_read_input_tokens),
        cacheWrite: write,
        cacheWriteLong: Math.min(long, write),
        speed: u.speed === 'fast' ? 'fast' : u.speed === 'standard' ? 'standard' : null,
        geo: u.inference_geo === 'us' ? 'us' : u.inference_geo === 'global' ? 'global' : null,
      };
    }
    // Tool calls: only the item keys and status of Tasks' set_status, the agent label passed to
    // Tasks' tools, and the id of a spawned sub-agent (to link its file). Nothing else of a tool
    // input is looked at.
    const events = [];
    if (msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
        if (tasksTool.test(b.name) && b.input && typeof b.input === 'object') {
          const label = typeof b.input.agent === 'string' ? b.input.agent.trim() : '';
          if (LABEL_RE.test(label)) events.push({ type: 'agent', label });
        }
        if (STATUS_TOOL.test(b.name) && b.input && typeof b.input === 'object') {
          const keys = (b.name.endsWith('_bulk') ? b.input.keys : [b.input.key]) ?? [];
          const valid = (Array.isArray(keys) ? keys : []).filter(
            (k) => typeof k === 'string' && ITEM_KEY.test(k)
          );
          if (valid.length && STATUSES.has(b.input.status)) {
            events.push({ type: 'status', keys: valid, status: b.input.status });
          }
        } else if ((b.name === 'Agent' || b.name === 'Task') && ID_RE.test(String(b.id))) {
          events.push({ type: 'spawn', toolUseId: b.id });
        }
      }
    }
    if (line.req || events.length) {
      line.events = events;
      lines.push(line);
    }
  }
  return { lines, end: base + pos };
}

/** A status call moves the item the agent is working on. */
export function nextItem(current, { keys, status }) {
  if (status === 'IN_PROGRESS') return keys[0];
  return current && keys.includes(current) ? null : current;
}

/**
 * Turn scanned lines into settled API requests, each tagged with the item it was made under.
 * One request is several lines (the last has the final output count): merged by requestId.
 * Unless `final`, the trailing request may still be streaming and is left for the next run;
 * `consumed` is the offset to resume from.
 */
export function buildRequests(
  scan,
  { item = null, agent = null, fallbackAgent = null, sent = [], final = false, owner = 'main' }
) {
  const groups = [];
  for (const line of scan.lines) {
    const id = line.req ? line.req.requestId : null;
    let g = groups[groups.length - 1];
    if (!g || (id && g.id && g.id !== id)) {
      g = { id, start: line.start, end: line.end, lines: [] };
      groups.push(g);
    } else {
      g.id = g.id ?? id;
      g.end = line.end;
    }
    g.lines.push(line);
  }
  let consumed = scan.end;
  if (!final && groups.length) {
    const last = groups.pop();
    consumed = last.start;
  }
  const sentSet = new Set(sent);
  const requests = [];
  const spawns = {};
  let current = item;
  // The label is the agent's identity: the requests before its first Tasks call carry it too.
  // A file that never names one uses `fallbackAgent` (a sub-agent: its parent's label + type).
  const firstLabel = scan.lines.flatMap((l) => l.events).find((e) => e.type === 'agent');
  let label = agent ?? (firstLabel ? firstLabel.label : fallbackAgent);
  for (const g of groups) {
    const reqLines = g.lines.filter((l) => l.req);
    for (const l of g.lines) {
      for (const e of l.events)
        if (e.type === 'spawn') spawns[e.toolUseId] = { owner, item: current, agent: label };
    }
    if (g.id && reqLines.length && !sentSet.has(g.id)) {
      const first = reqLines[0];
      const lastReq = reqLines[reqLines.length - 1].req;
      const maxOf = (k) => Math.max(...reqLines.map((l) => l.req[k]));
      requests.push({
        id: g.id,
        model: lastReq.model,
        tokens: {
          input: maxOf('input'),
          output: maxOf('output'),
          cacheRead: maxOf('cacheRead'),
          cacheWrite: maxOf('cacheWrite'),
          cacheWriteLong: maxOf('cacheWriteLong'),
        },
        speed: lastReq.speed,
        geo: lastReq.geo,
        t0: first.ts,
        t1: reqLines[reqLines.length - 1].ts,
        item: current,
        agent: label,
      });
    }
    // The request's own tokens belong to the item it started under; its status calls apply after.
    for (const l of g.lines) {
      for (const e of l.events) {
        if (e.type === 'status') current = nextItem(current, e);
        else if (e.type === 'agent') label = e.label;
      }
    }
  }
  return { requests, spawns, item: current, agent: label, consumed };
}

/** Group requests into records: per item segment and model, windows of at most six days. */
export function buildRecords(requests, { sessionId, agentId = null, parentAgentId = null, now }) {
  const records = [];
  const open = new Map();
  let segItem;
  let segAgent;
  let started = false;
  for (const r of requests) {
    const agent = r.agent ?? null;
    if (!started || r.item !== segItem || agent !== segAgent) {
      open.clear();
      segItem = r.item;
      segAgent = agent;
      started = true;
    }
    const k = r.model ?? '';
    let rec = open.get(k);
    if (rec && r.t1 - rec.t0 > MAX_WINDOW_MS) {
      open.delete(k);
      rec = undefined;
    }
    if (!rec) {
      rec = {
        first: r.id,
        model: r.model,
        item: r.item,
        agent,
        t0: r.t0,
        t1: r.t1,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 },
        requests: 0,
        speed: r.speed,
        geo: r.geo,
        maxPrompt: 0,
      };
      open.set(k, rec);
      records.push(rec);
    }
    for (const f of Object.keys(rec.tokens)) rec.tokens[f] += r.tokens[f];
    rec.requests += 1;
    rec.t0 = Math.min(rec.t0, r.t0);
    rec.t1 = Math.max(rec.t1, r.t1);
    rec.speed = rec.speed === r.speed ? rec.speed : 'standard';
    rec.geo = rec.geo === r.geo ? rec.geo : null;
    rec.maxPrompt = Math.max(
      rec.maxPrompt,
      r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite
    );
  }
  const safe = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);
  return records.map((rec) => {
    const out = {
      dedupeKey: `cc:${safe(sessionId) ?? 'x'}:${agentId ?? 'main'}:${rec.first}`.replace(
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
    if (typeof rec.agent === 'string' && LABEL_RE.test(rec.agent)) out.agent = rec.agent;
    if (safe(sessionId)) out.sessionId = sessionId;
    if (safe(agentId)) out.agentId = agentId;
    if (safe(parentAgentId)) out.parentAgentId = parentAgentId;
    if (rec.speed) out.speed = rec.speed;
    if (rec.geo) out.geo = rec.geo;
    if (rec.maxPrompt) out.maxPromptTokens = rec.maxPrompt;
    return out;
  });
}

// --- files, state, network ---------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readFrom(file, offset) {
  const size = fs.statSync(file).size;
  if (size <= offset) return { buf: Buffer.alloc(0), size, truncated: false };
  const len = Math.min(size - offset, MAX_CHUNK);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, offset);
  } finally {
    fs.closeSync(fd);
  }
  return { buf, size, truncated: offset + len < size };
}

async function post(cfg, records, fetchFn) {
  try {
    const res = await fetchFn(`${cfg.baseUrl.replace(/\/+$/, '')}/api/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({
        tool: 'claude-code',
        ...(cfg.agent ? { agent: cfg.agent } : {}),
        records,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      return { ok: true, result: json && json.data };
    }
    // 4xx other than auth/limits will never succeed: drop the batch instead of retrying forever.
    const permanent =
      res.status >= 400 && res.status < 500 && ![401, 403, 408, 429].includes(res.status);
    return { ok: false, permanent, status: res.status };
  } catch {
    return { ok: false, permanent: false, status: 0 };
  }
}

async function postAll(cfg, records, fetchFn) {
  const stats = { accepted: 0, duplicate: 0, rejected: 0 };
  for (let i = 0; i < records.length; i += BATCH) {
    const r = await post(cfg, records.slice(i, i + BATCH), fetchFn);
    if (!r.ok) return { ok: false, permanent: r.permanent, status: r.status, stats, sentUpTo: i };
    const d = r.result || {};
    stats.accepted += d.accepted || 0;
    stats.duplicate += d.duplicate || 0;
    stats.rejected += Array.isArray(d.rejected) ? d.rejected.length : 0;
  }
  return { ok: true, stats };
}

function withLock(file, fn, sleep) {
  return (async () => {
    let held = false;
    for (let i = 0; i < 12 && !held; i++) {
      try {
        fs.closeSync(fs.openSync(file, 'wx'));
        held = true;
      } catch {
        try {
          if (Date.now() - fs.statSync(file).mtimeMs > 60_000) fs.unlinkSync(file);
        } catch {
          /* gone meanwhile */
        }
        if (!held) await sleep(500);
      }
    }
    if (!held) return null;
    try {
      return await fn();
    } finally {
      try {
        fs.unlinkSync(file);
      } catch {
        /* already gone */
      }
    }
  })();
}

/** A sub-agent that never names itself: "<parent label> › <type>", either part alone, or null. */
export function subagentLabel(parent, type) {
  const label = [parent, type].filter(Boolean).join(' › ').slice(0, 100);
  return LABEL_RE.test(label) ? label : null;
}

/** Sub-agent files next to the transcript: `<session>/subagents/agent-<id>.jsonl` + `.meta.json`. */
function listSubagents(transcript, extraFile) {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  const found = new Map();
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = /^agent-(.+)\.jsonl$/.exec(name);
      if (m && ID_RE.test(m[1])) found.set(m[1], path.join(dir, name));
    }
  } catch {
    /* no sub-agents */
  }
  if (extraFile) {
    const m = /agent-(.+)\.jsonl$/.exec(path.basename(extraFile));
    if (m && ID_RE.test(m[1]) && fs.existsSync(extraFile)) found.set(m[1], extraFile);
  }
  return [...found].map(([id, file]) => {
    // Only four metadata fields are read; `description` is free text and is never touched.
    const meta = readJson(file.replace(/\.jsonl$/, '.meta.json')) || {};
    return {
      id,
      file,
      type:
        typeof meta.agentType === 'string' && AGENT_TYPE_RE.test(meta.agentType)
          ? meta.agentType
          : null,
      toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null,
      depth: Number.isInteger(meta.spawnDepth) ? meta.spawnDepth : 1,
      finished: meta.finished === true,
    };
  });
}

/**
 * One hook run. `env`: { home, fetch, now, sleep } are injectable for tests.
 * Returns a small summary (never throws).
 */
export async function run(input, env = {}) {
  const home = env.home || process.env.TASKS_HOME || path.join(os.homedir(), '.tasks');
  const fetchFn = env.fetch || globalThis.fetch;
  const sleep = env.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = env.now ?? Date.now();
  const summary = { sent: 0, duplicate: 0, rejected: 0, error: null };
  try {
    const cfg = readJson(path.join(home, 'config.json'));
    const sessionId = input && input.session_id;
    const transcript = input && input.transcript_path;
    // Local mode (DOC-60): records go to a file on this machine, nothing is sent anywhere.
    const local = !!cfg && cfg.mode === 'local';
    if (!cfg || !ID_RE.test(String(sessionId))) return summary;
    if (!local && (!cfg.baseUrl || !cfg.token)) return summary;
    const event = input.hook_event_name;
    // The sub-agent's file lags its stop event by a few hundred ms.
    if (MID_TURN.has(event)) return summary;
    if (event === 'SubagentStop') await sleep(env.subagentWaitMs ?? 1000);

    const stateDir = path.join(home, 'state');
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    if (typeof transcript !== 'string' || !fs.existsSync(transcript)) return summary;
    const stateFile = path.join(stateDir, `${sessionId}.json`);
    await withLock(
      `${stateFile}.lock`,
      async () => {
        let state = readJson(stateFile) || {};
        state = {
          files: state.files || {},
          spawns: state.spawns || {},
          pending: state.pending || null,
        };

        const flush = async (records, next) => {
          if (!records.length) return true;
          if (local) {
            // Same offset/dedupe state as hosted: a record is written once, in the run that
            // advances the offset. A failed write keeps the batch as pending, like a failed POST.
            try {
              const file = path.join(home, 'usage.jsonl');
              // O_NOFOLLOW refuses a planted symlink; fchmod before writing so a failed chmod
              // cannot leave lines that the pending retry would append a second time.
              const fd = fs.openSync(
                file,
                fs.constants.O_WRONLY |
                  fs.constants.O_APPEND |
                  fs.constants.O_CREAT |
                  (fs.constants.O_NOFOLLOW || 0),
                0o600
              );
              try {
                fs.fchmodSync(fd, 0o600);
                fs.writeSync(fd, records.map((rec) => JSON.stringify(rec) + '\n').join(''));
              } finally {
                fs.closeSync(fd);
              }
              summary.sent += records.length;
              return true;
            } catch {
              summary.error = 'write failed';
              state.pending = { records, next };
              writeJson(stateFile, state);
              return false;
            }
          }
          const r = await postAll(cfg, records, fetchFn);
          summary.sent += r.stats.accepted;
          summary.duplicate += r.stats.duplicate;
          summary.rejected += r.stats.rejected;
          if (r.ok || r.permanent) return true;
          summary.error = `HTTP ${r.status}`;
          state.pending = { records, next };
          writeJson(stateFile, state);
          return false;
        };

        if (state.pending) {
          const { records, next } = state.pending;
          if (!(await flush(records, next))) return;
          state.files = next.files;
          state.spawns = next.spawns;
          state.pending = null;
        }

        const next = { files: { ...state.files }, spawns: { ...state.spawns } };
        const tasksTool = tasksToolRe(cfg.mcpServer);
        const records = [];
        const cutoff = now - MAX_AGE_MS;
        const step = (key, file, opts) => {
          const prev = next.files[key] || {
            offset: 0,
            item: opts.initialItem ?? null,
            agent: null,
            sent: [],
          };
          let offset = prev.offset || 0;
          let read = readFrom(file, offset);
          if (read.size < offset) {
            // The file shrank: start over (the server dedupes).
            offset = 0;
            read = readFrom(file, 0);
          }
          const scan = scanChunk(read.buf, offset, { skipSidechain: key === 'main', tasksTool });
          const res = buildRequests(scan, {
            item: prev.item ?? null,
            agent: prev.agent ?? null,
            fallbackAgent: opts.fallbackAgent ?? null,
            sent: prev.sent,
            final: opts.final && !read.truncated,
            owner: opts.agentId ?? 'main',
          });
          const fresh = res.requests.filter((r) => r.t1 >= cutoff);
          records.push(
            ...buildRecords(fresh, {
              sessionId,
              agentId: opts.agentId,
              parentAgentId: opts.parentAgentId,
              now,
            })
          );
          next.files[key] = {
            offset: res.consumed,
            item: res.item,
            agent: res.agent,
            sent: [...(prev.sent || []), ...res.requests.map((r) => r.id)].slice(-SENT_KEEP),
          };
          Object.assign(next.spawns, res.spawns);
          const ids = Object.keys(next.spawns);
          for (const id of ids.slice(0, Math.max(0, ids.length - SPAWNS_KEEP)))
            delete next.spawns[id];
        };

        step('main', transcript, {
          final: event === 'Stop' || event === 'StopFailure' || event === 'SessionEnd',
          agentId: null,
          parentAgentId: null,
        });
        const agents = listSubagents(transcript, input.agent_transcript_path).sort(
          (a, b) => a.depth - b.depth || a.id.localeCompare(b.id)
        );
        for (const a of agents) {
          const key = `agent:${a.id}`;
          let size;
          try {
            size = fs.statSync(a.file).size;
          } catch {
            continue;
          }
          if (next.files[key] && next.files[key].offset >= size) continue;
          const link = a.toolUseId ? next.spawns[a.toolUseId] : null;
          step(key, a.file, {
            final:
              a.finished ||
              event === 'SessionEnd' ||
              (event === 'SubagentStop' && input.agent_id === a.id),
            agentId: a.id,
            parentAgentId: link && link.owner !== 'main' ? link.owner : null,
            initialItem: link ? link.item : null,
            fallbackAgent: subagentLabel(link && link.agent, a.type),
          });
        }

        if (!(await flush(records, next))) return;
        state.files = next.files;
        state.spawns = next.spawns;
        state.pending = null;
        writeJson(stateFile, state);
      },
      sleep
    );
  } catch (err) {
    summary.error = String((err && err.message) || err).slice(0, 200);
  }
  try {
    const home2 = env.home || process.env.TASKS_HOME || path.join(os.homedir(), '.tasks');
    // Last run only, no content: counts and an error class, for "why is nothing arriving?".
    writeJson(path.join(home2, 'last-run.json'), {
      at: new Date(now).toISOString(),
      ...summary,
      version: VERSION,
    });
  } catch {
    /* nothing to do */
  }
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

// ============================================================================
// core/stategraph.mjs — the platform-independent half of the state graph: the
// persisted graph itself (load/save/tried bookkeeping), tree diffing, and the
// frontier pop. Screen IDENTITY (screenSignature), control enumeration
// (controlsOf), chrome detection (tabs/nav), upsertNode's node shape, and
// pushFrontier's task shape are platform concerns — they live in
// mobile/stategraph.mjs and web/stategraph.mjs, which re-export everything here
// so consumers (including the legacy DFS drivers) keep a single import site.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A data row in a list/feed (e.g. a conversation-history cell) rather than a feature
// control. Long labels or several comma-separated fragments (title, duration, date…).
export const isDataRow = (label) => (String(label).match(/,/g) || []).length >= 2 || String(label).length > 40;

// Element-level before/after diff of two element lists (numbers normalized so a
// ticking value isn't a "change"). The deterministic "did the last action do
// anything" signal.
export function diffTrees(before, after) {
  const norm = (e) => String(e.label).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const b = new Set((before || []).map(norm)), a = new Set((after || []).map(norm));
  const appeared = [...a].filter((x) => !b.has(x)).slice(0, 12);
  const disappeared = [...b].filter((x) => !a.has(x)).slice(0, 12);
  return { appeared, disappeared, changed: appeared.length > 0 || disappeared.length > 0 };
}

// ---- persisted graph (survives across runs) --------------------------------
export function loadGraph(path) {
  if (existsSync(path)) {
    const g = JSON.parse(readFileSync(path, 'utf8'));
    g.visited = new Set(g.visited || []);
    g.queued = new Set(g.queued || []);
    g.nodes ??= {}; g.frontier ??= []; g.flaws ??= 0; g.nextTask ??= 1; // default missing counters
    return g;
  }
  return { nodes: {}, frontier: [], visited: new Set(), queued: new Set(), flaws: 0, nextTask: 1 };
}

export function saveGraph(path, g) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...g, visited: [...g.visited], queued: [...g.queued] }, null, 2));
}

export const isTried = (g, sig, label) => g.visited.has(sig + '::' + label);
export function markTried(g, sig, label) {
  g.visited.add(sig + '::' + label);
  const n = g.nodes[sig];
  if (n && !n.tried.includes(label)) n.tried.push(label);
}

// pop the next untried backtrack task (skip ones tried via another path).
export function popFrontier(g) {
  while (g.frontier.length) {
    const t = g.frontier.pop();
    g.queued.delete(t.expectSig + '::' + t.action.label);
    if (!g.visited.has(t.expectSig + '::' + t.action.label)) return t;
  }
  return null;
}

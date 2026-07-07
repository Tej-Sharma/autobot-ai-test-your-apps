// ============================================================================
// stategraph.mjs — screen identity, control enumeration, and the persisted
// state-graph + backtrack frontier. Tune the heuristics here.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// keyboard keys + chrome that flicker the a11y set — excluded from screen identity.
const KEYS = /^(return|shift|space|delete|done|next|go|search|123|abc|more|emoji|dictate|[a-z])$/i;

// Stable screen signature: identity must NOT change when the keyboard opens, a number
// ticks, or you arrive via a different back-button. So we drop:
//   - the top-left nav back button (its label is the PREVIOUS screen, not this one)
//   - keyboard keys, pure numbers/times, single chars
export function screenSignature(els) {
  const norm = els
    .filter((e) => !(e.y < 110 && e.x < 140)) // top-left nav back button varies by origin
    .map((e) => String(e.label).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.length > 1 && !/^[#:\s]+$/.test(s) && !/#\s*(am|pm)$/.test(s) && !KEYS.test(s));
  return [...new Set(norm)].sort().slice(0, 16).join('|') || 'EMPTY';
}

// Auto-detect a bottom tab bar from the a11y tree, so any app gets proper per-tab
// navigation without a hardcoded label list. A tab bar is a horizontal row of 3–6 short
// button-like items in the bottom ~15% of the screen, spread across most of the width and
// sharing a tight y-band. Returns lowercased labels (what TAB_LABELS used to supply), or
// [] when there's no recognizable tab bar. Element coordinates are CENTERS (see mcp.mjs).
export function detectTabs(els, SW, SH) {
  if (!SW || !SH || SW > 5000 || SH > 5000) return []; // need real point bounds
  const band = SH * 0.85;                              // bottom ~15%
  const seen = new Set(); const cand = [];
  for (const e of els) {
    const l = String(e.label || '').trim();
    const t = String(e.type || '').toLowerCase();
    if (!l || l.length > 16 || /[,:]/.test(l)) continue;   // tab titles: short, no data punctuation
    if (e.y < band) continue;                              // bottom band only
    if (t && t !== 'button' && t !== 'tab') continue;      // tab items are buttons (empty type allowed)
    if (seen.has(l)) continue; seen.add(l); cand.push(e);
  }
  cand.sort((a, b) => a.x - b.x);
  if (cand.length < 3 || cand.length > 6) return [];
  const xs = cand.map((e) => e.x), ys = cand.map((e) => e.y);
  if (Math.max(...xs) - Math.min(...xs) < SW * 0.5) return [];  // must span most of the width
  if (Math.max(...ys) - Math.min(...ys) > SH * 0.05) return []; // a single row, not stacked
  return cand.map((e) => e.label.toLowerCase());
}

// Actionable controls. Excludes: fields, numbers/time/keys, images, value-text ("X: Y"),
// the nav back button (top-left), and the tab bar (those are seeded once, not per-screen).
export function controlsOf(els, tabLabels = []) {
  const tabs = new Set(tabLabels.map((t) => t.toLowerCase()));
  const seen = new Set(); const out = [];
  for (const e of els) {
    const l = e.label; const t = (e.type || '').toLowerCase();
    if (!l || l.length <= 1 || seen.has(l)) continue;
    if (e.y < 110 && e.x < 140) continue;              // nav back button (label = previous screen)
    if (tabs.has(l.toLowerCase())) continue;          // tab bar — seeded once globally
    if (t === 'image') continue;
    if (/field/i.test(l) || /(am|pm)$/i.test(l) || /^[#\d]/.test(l) || KEYS.test(l) || /:/.test(l)) continue;
    seen.add(l); out.push(e);
  }
  return out;
}

// Element-level before/after diff of two a11y trees (numbers normalized so a ticking
// value isn't a "change"). The deterministic "did the last action do anything" signal.
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

export function upsertNode(g, sig, name, els) {
  const n = g.nodes[sig] || (g.nodes[sig] = { name, signature: sig, status: 'unexplored', tried: [], visits: 0 });
  n.name = name || n.name; n.visits++;
  return n;
}

export const isTried = (g, sig, label) => g.visited.has(sig + '::' + label);
export function markTried(g, sig, label) {
  g.visited.add(sig + '::' + label);
  const n = g.nodes[sig];
  if (n && !n.tried.includes(label)) n.tried.push(label);
}

// A data row in a list/feed (e.g. a conversation-history cell) rather than a feature
// control. Long labels or several comma-separated fragments (title, duration, date…).
const isDataRow = (label) => (String(label).match(/,/g) || []).length >= 2 || String(label).length > 40;

// push untried controls of a screen onto the frontier as backtrack tasks.
// Feature controls (buttons/toggles) are queued before data rows, and we cap how many
// a single screen contributes so a long list can't flood the frontier and starve the
// real features behind it (LIFO pop order). `max` rows beyond the cap are dropped.
export function pushFrontier(g, sig, reach, controls, max = 16) {
  const ranked = [...controls].sort((a, b) => (isDataRow(a.label) ? 1 : 0) - (isDataRow(b.label) ? 1 : 0));
  let pushed = 0;
  for (const c of ranked) {
    if (pushed >= max) break;
    const key = sig + '::' + c.label;
    if (g.visited.has(key) || g.queued.has(key)) continue;
    g.frontier.push({ id: g.nextTask++, reach: reach.map((a) => ({ ...a })), action: { label: c.label, x: c.x, y: c.y }, expectSig: sig });
    g.queued.add(key);
    pushed++;
  }
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

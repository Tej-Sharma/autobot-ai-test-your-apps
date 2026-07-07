// ============================================================================
// stategraph.mjs — screen identity, control enumeration, and the persisted
// state-graph + backtrack frontier. Web sibling of v2-mobile-tester's version:
// identity is URL + label-set (not a11y fingerprint alone), nav-bar detection
// uses landmark roles (not pixel bands), and frontier tasks carry {label, role}
// instead of {label, x, y} — refs are never persisted, only resolved fresh.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A data row in a list/feed (e.g. a chat-history sidebar entry with an embedded
// timestamp) rather than a feature control. Long labels or several comma-separated
// fragments (title, date, time…). Declared before screenSignature/pushFrontier —
// both need it.
const isDataRow = (label) => (String(label).match(/,/g) || []).length >= 2 || String(label).length > 40;

// Stable screen signature: URL pathname (query/hash-insensitive noise stripped by
// the caller if desired) plus the normalized, deduped set of visible labels — so a
// ticking counter or timestamp doesn't count as a new screen, but a modal opened
// without a URL change (SPA state) still does. Data-row labels are excluded
// entirely (not just digit-normalized): a live app's list/feed content — chat
// history entries, notification timestamps — churns turn to turn, and unlike a
// simple ticking counter it isn't fixable by normalizing digits alone (verified
// live: it silently changed which 24 labels made the sorted signature's cutoff,
// breaking the verify-before-act check on every subsequent step).
export function screenSignature(pathname, els) {
  const norm = els
    .filter((e) => !isDataRow(e.label))
    .map((e) => String(e.label).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.length > 1 && !/^[#:\s]+$/.test(s));
  const labelSig = [...new Set(norm)].sort().slice(0, 24).join('|') || 'EMPTY';
  return `${pathname || '/'}::${labelSig}`;
}

// Roles that are structural/decorative, never actionable controls.
const INERT_ROLE = /^(generic|paragraph|text|list|listitem|table|row|cell|columnheader|rowheader|img|image|heading|separator|status|group|region|article|document|figure|none)$/;
// Roles worth seeding once as global nav, if found inside a navigation/banner/contentinfo landmark.
const NAV_ROLE = /^(link|button)$/;

// Auto-detect the primary nav (header/nav-landmark links), so any site gets
// per-page-body navigation without a hardcoded label list. Mirrors mobile's
// detectTabs in purpose (seed global nav once, don't re-queue it per screen) but
// keys off ARIA landmarks instead of a pixel band — web has no bottom-tab-bar
// convention to lean on. Returns lowercased labels, or [] when nothing qualifies.
export function detectNav(els) {
  const seen = new Set(); const cand = [];
  for (const e of els) {
    if (!NAV_ROLE.test(e.role) || e.landmark !== 'navigation' && e.landmark !== 'banner' && e.landmark !== 'contentinfo') continue;
    const l = String(e.label || '').trim();
    if (!l || l.length > 24 || seen.has(l)) continue;
    seen.add(l); cand.push(l);
  }
  return cand.length >= 2 && cand.length <= 12 ? cand.map((l) => l.toLowerCase()) : [];
}

// Actionable controls. Excludes: structural/decorative roles, unlabeled nodes,
// and anything already seeded as global nav.
export function controlsOf(els, navLabels = []) {
  const nav = new Set(navLabels.map((t) => t.toLowerCase()));
  const seen = new Set(); const out = [];
  for (const e of els) {
    const l = e.label; if (!l || l.length <= 1 || seen.has(l)) continue;
    if (INERT_ROLE.test(e.role)) continue;
    if (nav.has(l.toLowerCase())) continue; // global nav — seeded once
    seen.add(l); out.push(e);
  }
  return out;
}

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
    g.nodes ??= {}; g.frontier ??= []; g.flaws ??= 0; g.nextTask ??= 1;
    return g;
  }
  return { nodes: {}, frontier: [], visited: new Set(), queued: new Set(), flaws: 0, nextTask: 1 };
}

export function saveGraph(path, g) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...g, visited: [...g.visited], queued: [...g.queued] }, null, 2));
}

export function upsertNode(g, sig, name, url) {
  const n = g.nodes[sig] || (g.nodes[sig] = { name, signature: sig, url, status: 'unexplored', tried: [], visits: 0 });
  n.name = name || n.name; n.url = url || n.url; n.visits++;
  return n;
}

export const isTried = (g, sig, label) => g.visited.has(sig + '::' + label);
export function markTried(g, sig, label) {
  g.visited.add(sig + '::' + label);
  const n = g.nodes[sig];
  if (n && !n.tried.includes(label)) n.tried.push(label);
}

// push untried controls of a screen onto the frontier as backtrack tasks. Tasks
// carry {url, clickPath} as the reach (not a tap-path of coordinates) and
// {label, role} for the target action — never a `ref`, which goes stale the
// moment another snapshot is taken. Feature controls are queued before data
// rows, and a cap keeps a long list from flooding the frontier.
export function pushFrontier(g, sig, url, reach, controls, max = 16) {
  const ranked = [...controls].sort((a, b) => (isDataRow(a.label) ? 1 : 0) - (isDataRow(b.label) ? 1 : 0));
  let pushed = 0;
  for (const c of ranked) {
    if (pushed >= max) break;
    const key = sig + '::' + c.label;
    if (g.visited.has(key) || g.queued.has(key)) continue;
    g.frontier.push({ id: g.nextTask++, url, reach: reach.map((a) => ({ ...a })), action: { label: c.label, role: c.role }, expectSig: sig });
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

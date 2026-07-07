// ============================================================================
// explore.mjs — single-brain, LLM-driven explorer (Vercel AI SDK). Web sibling of
// v2-mobile-tester's explore.mjs: ref-based interaction instead of coordinate taps,
// `navigate(url)` as a first-class action (web's cheap backtracking), browser back,
// and deterministic console/network error signals fed to the model each turn.
// Every turn ONE model call both judges the current page AND picks the next action.
// The full, never-pruned memory trace is fed back as working memory, alongside the
// deterministic state-graph coverage map (screens/controls seen vs. exercised) and
// the flow tracker (whole completed user journeys, rules enforced in code).
//   node explore.mjs [<target>]   MODEL, GLOBAL_STEPS, GOAL, NAV_WAIT, FLOW_MIN_STEPS
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPlaywrightMcp, sleep } from './mcp.mjs';
import { isModal, handleModal, findByLabel } from './interactions.mjs';
import { screenSignature, controlsOf, detectNav, loadGraph, saveGraph, upsertNode, markTried } from './stategraph.mjs';
import { exploreSystem } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2] || 'the-constella-app';
const MODEL = process.env.MODEL || 'google/gemini-3.5-flash';
const GLOBAL_STEPS = Number(process.env.GLOBAL_STEPS || 40);
const NAV_WAIT = Number(process.env.NAV_WAIT || 10000);
const VIEWPORT = process.env.VIEWPORT || '1280x800';
const GOAL = process.env.GOAL || '';
const FOCUS = process.env.FOCUS || '';
const FLOW_MIN_STEPS = Number(process.env.FLOW_MIN_STEPS || 5);

if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY (../../v2-mobile-tester/spike/.env)'); process.exit(1); }
const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(MODEL);
const reasoningOpts = MODEL.includes('gemini') ? { openrouter: { reasoning: { effort: 'minimal' } } } : {};

// INPUTS_DIR lets the desktop app point config at a writable location (userData) —
// packaged, HERE is inside the read-only .app bundle. Falls back to HERE for the CLI.
const inputsPath = join(process.env.INPUTS_DIR || join(HERE, 'inputs'), `${TARGET}.json`);
const INPUTS = existsSync(inputsPath) ? JSON.parse(readFileSync(inputsPath, 'utf8')) : {};
if (!INPUTS.url) { console.error(`Need inputs/${TARGET}.json with a "url" field.`); process.exit(1); }
const START_URL = INPUTS.url;
const credLine = INPUTS.credentials
  ? `Test credentials you may use to sign in — username: "${INPUTS.credentials.username}", password: "${INPUTS.credentials.password}".`
  : 'No credentials provided.';
const ABOUT = INPUTS.about ? String(INPUTS.about).trim() : `No description provided for ${START_URL} — explore the UI to learn what it does and offers.`;
// app-specific test instructions, auto-loaded by target id: instructions/<target>.md
const instrPath = join(HERE, 'instructions', `${TARGET}.md`);
const APP_INSTRUCTIONS = existsSync(instrPath) ? readFileSync(instrPath, 'utf8').trim() : '';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = process.env.RUN_DIR || join(HERE, 'runs', `${TARGET}__explore__${stamp}`);
const JOURNAL = join(RUN, 'journal.jsonl'), FLAWS = join(RUN, 'flaws.jsonl'), MEMORY = join(RUN, 'memory.jsonl');
const FLOWS_FILE = join(RUN, 'flows.jsonl');
// CLEAN SLATE every run: if this RUN_DIR is reused, wipe prior per-state data so journals,
// memory trace, flaws, and screenshots never mix across runs.
rmSync(join(RUN, 'screenshots'), { recursive: true, force: true });
mkdirSync(join(RUN, 'screenshots'), { recursive: true });
for (const f of [JOURNAL, FLAWS, MEMORY, FLOWS_FILE]) writeFileSync(f, '');
const now = () => new Date().toISOString();

// ---- coverage ledger: the deterministic state graph, maintained alongside the LLM ----
// Same design as mobile explore's: the model does its best judgement; the graph is
// ground truth for what exists and what was actually exercised. Web bonus: nodes carry
// URLs, so the "paths you didn't trace" lines are directly navigable via nextAction.
const STATE = process.env.STATE_GRAPH || join(RUN, 'state-graph.json');
const g = loadGraph(STATE);
const navSeen = new Set();   // lowercased global-nav labels ever detected
const navTried = new Set();  // nav labels the model actually clicked
const untriedOf = (n) => (n.controls || []).filter((c) => !n.tried.includes(c));

function renderCoverage(sig, els) {
  const hereTried = g.nodes[sig]?.tried || [];
  const hereUntried = controlsOf(els, [...navSeen]).map((c) => c.label).filter((l) => !hereTried.includes(l));
  const elsewhere = Object.values(g.nodes)
    .filter((n) => n.signature !== sig && untriedOf(n).length)
    .slice(0, 12)
    .map((n) => {
      const u = untriedOf(n);
      return `• ${n.name}${n.url ? ` (${n.url})` : ''}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? ` (+${u.length - 8} more)` : ''}`;
    });
  const navLeft = [...navSeen].filter((t) => !navTried.has(t));
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  return [
    `Pages mapped: ${nodes.length} · controls exercised: ${tried}/${total || '?'}`,
    `Untried on THIS page: ${hereUntried.join(', ') || 'none — everything here was exercised'}`,
    navLeft.length ? `Nav links never opened: ${navLeft.join(', ')}` : null,
    elsewhere.length ? `Untried controls on OTHER pages (paths you didn't trace — you can navigate straight to their URLs):\n${elsewhere.join('\n')}` : 'No other pages with untried controls.',
    flowsDone.length ? `Flows already completed this run (do NOT re-declare these): ${flowsDone.map((f) => `"${f.name}" (steps ${f.startStep}–${f.endStep})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

// ---- flow tracker: model DECLARES a completed flow, code ENFORCES the rules ----
// A flow is one whole contiguous journey of >= FLOW_MIN_STEPS steps. Flows never
// overlap, and a new flow can't be declared by tacking a step or two onto the last
// one — its start must be strictly after the previous flow's end. Declarations that
// break either rule are rejected (logged, not recorded).
let lastFlowEnd = -1; let flowN = 0; const flowsDone = [];
function recordFlow(decl, step, screen) {
  if (!decl) return null;
  const start = decl.startStep, len = step - start + 1;
  const reject = (why) => { console.log(`   ✗ flow rejected ("${decl.name}"): ${why}`); return null; };
  if (start < 0 || start > step) return reject(`startStep ${start} is outside 0..${step}`);
  if (start <= lastFlowEnd) return reject(`overlaps the previous flow (it ended at step ${lastFlowEnd}) — flows must be whole separate sequences`);
  if (len < FLOW_MIN_STEPS) return reject(`only ${len} step(s) — a flow is a large sequence (>= ${FLOW_MIN_STEPS})`);
  const flow = { id: `FL-${String(++flowN).padStart(3, '0')}`, ts: now(), name: decl.name, startStep: start, endStep: step,
    steps: len, evidence: decl.evidence, screen, status: 'done' };
  appendFileSync(FLOWS_FILE, JSON.stringify(flow) + '\n');
  flowsDone.push(flow); lastFlowEnd = step;
  console.log(`   ✓ flow ${flow.id} done: "${flow.name}" (steps ${start}–${step}) — ${flow.evidence}`);
  return flow;
}

// ---- schemas ----
const FLAW = z.object({
  type: z.enum(['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy', 'network', 'console']),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-page issues'),
});
const TURN = z.object({
  screen: z.string(),
  uiDone: z.string(),
  expectationCheck: z.string(),
  reasoning: z.string(),
  goalsSoFar: z.array(z.string()),
  goalsCompleted: z.array(z.string()),
  areasRemaining: z.array(z.string()),
  flaws: z.array(FLAW),
  crashed: z.boolean(),
  flowCompleted: z.object({
    name: z.string().describe('short name of the flow, e.g. "Sign up and reach dashboard"'),
    startStep: z.number().int().describe('the step number where this flow began'),
    evidence: z.string().describe('the on-page evidence proving the flow completed'),
  }).nullable().describe('null on almost every turn — set ONLY when a whole large flow just finished (see rules)'),
  nextAction: z.object({
    kind: z.enum(['click', 'type', 'navigate', 'back', 'stop']),
    elementIndex: z.number().int().nullable(),
    label: z.string().nullable(),
    text: z.string().nullable(),
    url: z.string().nullable().describe('for kind=navigate: an in-app URL to jump to directly'),
    expectation: z.string(),
  }),
  done: z.boolean(),
});

// ---- io helpers ----
const journalStep = (o) => appendFileSync(JOURNAL, JSON.stringify({ ts: now(), ...o }) + '\n');
const seenFlaws = new Set(); let flawCount = 0;
function recordFlaws(flaws, screen, shot) {
  for (const f of flaws || []) {
    const key = `${f.type}::${f.summary.toLowerCase().slice(0, 32)}`;
    if (seenFlaws.has(key)) continue; seenFlaws.add(key);
    const id = `F-${String(++flawCount).padStart(3, '0')}`;
    appendFileSync(FLAWS, JSON.stringify({ id, ts: now(), screen, ...f, screenshots: shot ? [shot] : [], status: 'open' }) + '\n');
    console.log(`   flaw ${id} [${f.severity} ${f.type}] ${f.summary}`);
  }
}

const pathnameOf = (url) => { try { const u = new URL(url); return u.pathname + (u.search || ''); } catch { return url || '/'; } };
const elemText = (els) => els.length ? els.map((e, i) => `[${i}] "${e.label}" (${e.role})`).join('\n') : '(no elements found)';

let mcpc;
async function execute(a, els) {
  if (a.kind === 'stop') return;
  if (a.kind === 'back') { await mcpc.call(mcpc.T.navigateBack, {}).catch(() => null); await sleep(700); return; }
  if (a.kind === 'navigate') { await mcpc.navigateAndWait(a.url || START_URL, NAV_WAIT); return; }
  // click / type — refs from THIS turn's snapshot are current; resolve by index first,
  // falling back to a fresh label lookup (refs go stale across snapshots, labels don't).
  let el = (a.elementIndex != null) ? els[a.elementIndex] : null;
  if (!el && a.label) el = await findByLabel(mcpc, a.label);
  if (!el) { await sleep(700); return; }
  if (a.kind === 'type') await mcpc.typeText(el.ref, el.label, a.text || '');
  else await mcpc.click(el.ref, el.label);
  await sleep(700);
}

// ---- the never-pruned memory trace ----
const trace = [];
const actionStr = (a) => `${a.kind}${a.label ? ` '${a.label}'` : ''}${a.text ? ` "${a.text}"` : ''}${a.url ? ` ${a.url}` : ''}`;
const orDash = (a) => (a && a.length ? a.join('; ') : '—');
function renderMemory() {
  if (!trace.length) return '(empty — this is your first turn)';
  return trace.map((t) => [
    `--- step: ${t.step}  |  time: ${t.time}  |  page: ${t.screen}  |  url: ${t.url}`,
    `  action: ${t.action}`,
    `  expectation: ${t.expectation}`,
    `  result: ${t.expectationCheck}`,
    `  reasoning: ${t.reasoning}`,
    `  uiDone: ${t.uiDone}`,
    `  goalsSoFar: ${orDash(t.goalsSoFar)}`,
    `  goalsCompleted: ${orDash(t.goalsCompleted)}`,
    `  areasRemaining: ${orDash(t.areasRemaining)}`,
    `  flaws: ${orDash(t.flaws)}`,
    `  crashed: ${t.crashed}`,
  ].join('\n')).join('\n\n');
}

// ============================ MAIN ============================
mcpc = await connectPlaywrightMcp(join(RUN, 'screenshots'));
await mcpc.navigateAndWait(START_URL, NAV_WAIT);
console.log(`explore: ${MODEL} · ${TARGET} (${START_URL})\nabout: ${ABOUT}\napp-instructions: ${APP_INSTRUCTIONS ? `loaded (${instrPath})` : 'none'}\n`);

for (let step = 0; step < GLOBAL_STEPS; step++) {
  let els = await mcpc.listElements();
  if (isModal(els)) { const p = await handleModal(mcpc, els); console.log(`   • modal dismissed via '${p}'`); els = await mcpc.listElements(); }
  const url = mcpc.currentUrl();
  const sig = screenSignature(pathnameOf(url), els);
  for (const nl of detectNav(els)) navSeen.add(nl);
  const img = await mcpc.screenshotImage(`step-${step}`);
  const cErr = await mcpc.consoleErrors();
  const cFail = await mcpc.failedRequests();

  const signalLines = [
    `CURRENT PAGE — URL: ${url}`,
    cErr ? `NEW console errors since last action: ${cErr}` : null,
    cFail.length ? `NEW failed network requests: ${cFail.join(' | ')}` : null,
    `ELEMENTS (index in brackets, with ARIA role):\n${elemText(els)}`,
  ].filter(Boolean).join('\n');

  const { object: t } = await generateObject({
    model, schema: TURN, providerOptions: reasoningOpts,
    messages: [
      { role: 'system', content: exploreSystem({ about: ABOUT, size: VIEWPORT, goal: GOAL, focus: FOCUS, credLine, memory: renderMemory(), coverage: renderCoverage(sig, els), appInstructions: APP_INSTRUCTIONS }) },
      { role: 'user', content: [
        { type: 'text', text: signalLines },
        { type: 'image', image: `data:${img.mimeType};base64,${img.data}` },
      ] },
    ],
  });

  // ledger: register this page + its controls, and mark the chosen control tried.
  const node = upsertNode(g, sig, t.screen, url);
  node.controls = [...new Set([...(node.controls || []), ...controlsOf(els, [...navSeen]).map((c) => c.label)])];
  {
    const el = (t.nextAction.elementIndex != null) ? els[t.nextAction.elementIndex] : null;
    const label = el?.label || t.nextAction.label;
    if ((t.nextAction.kind === 'click' || t.nextAction.kind === 'type') && label) {
      markTried(g, sig, label);
      if (navSeen.has(String(label).toLowerCase())) navTried.add(String(label).toLowerCase());
    }
  }
  saveGraph(STATE, g);

  const flow = recordFlow(t.flowCompleted, step, t.screen);

  recordFlaws(t.flaws, t.screen, img.file);
  const aStr = actionStr(t.nextAction);
  const rec = { step, time: now(), screen: t.screen, url, uiDone: t.uiDone, action: aStr, expectation: t.nextAction.expectation,
    expectationCheck: t.expectationCheck, reasoning: t.reasoning, goalsSoFar: t.goalsSoFar, goalsCompleted: t.goalsCompleted,
    areasRemaining: t.areasRemaining, flaws: t.flaws.map((f) => f.summary), crashed: t.crashed };
  trace.push(rec);
  appendFileSync(MEMORY, JSON.stringify(rec) + '\n');
  journalStep({ step, screen: t.screen, url_after: url, action: aStr, description: t.uiDone, expectation: t.nextAction.expectation,
    expectationCheck: t.expectationCheck, console_errors: cErr, failed_requests: cFail, crashed: t.crashed,
    screenshot: img.file, done: t.done, ...(flow ? { flow: flow.id } : {}) });
  console.log(`step ${step}  [${t.screen}]  → ${aStr}\n   ${t.reasoning.slice(0, 100)}`);
  const covTotal = Object.values(g.nodes).reduce((s, n) => s + (n.controls || []).length, 0);
  const covTried = Object.values(g.nodes).reduce((s, n) => s + n.tried.length, 0);
  console.log('@@PROGRESS ' + JSON.stringify({ step, screen: t.screen, action: aStr, reasoning: t.reasoning.slice(0, 120),
    goalsCompleted: t.goalsCompleted.length, areasRemaining: t.areasRemaining.length, flaws: t.flaws.length, crashed: t.crashed, done: t.done,
    coverage: { tried: covTried, total: covTotal, screens: Object.keys(g.nodes).length }, ...(flow ? { flow: flow.name } : {}) }));

  if (t.crashed) { console.log('   ⚠ crash/off-site detected — returning to start URL'); await mcpc.navigateAndWait(START_URL, NAV_WAIT); continue; }
  if (t.done || t.nextAction.kind === 'stop') { console.log(`\nexplorer finished: ${t.uiDone}`); break; }
  await execute(t.nextAction, els);
}

console.log('\n================ EXPLORE SUMMARY ================');
const goals = [...new Set(trace.flatMap((t) => t.goalsCompleted || []))];
console.log(`steps: ${trace.length}/${GLOBAL_STEPS}   flaws: ${flawCount}   page (last): ${trace.slice(-1)[0]?.screen || '—'}`);
console.log(`goals completed: ${goals.join(' · ') || 'none'}`);
{
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  const leftovers = nodes.filter((n) => untriedOf(n).length).map((n) => `${n.name} (${untriedOf(n).length})`);
  console.log(`coverage: ${tried}/${total} controls across ${nodes.length} pages${leftovers.length ? `   UNTRIED: ${leftovers.join(', ')}` : '   — frontier empty'}`);
  console.log(`flows completed: ${flowsDone.length ? flowsDone.map((f) => `"${f.name}" (${f.steps} steps)`).join(' · ') : 'none'}`);
}
console.log(`run: ${RUN}`);
console.log('================================================');
await mcpc.close();
process.exit(0);

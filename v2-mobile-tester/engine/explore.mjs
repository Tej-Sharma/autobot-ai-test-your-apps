// ============================================================================
// explore.mjs — single-brain, LLM-driven explorer (Vercel AI SDK).
// No frontier, no separate judge. Every turn ONE model call both judges the current
// screen AND picks the next action. The full, never-pruned memory trace is fed back in
// as working memory each turn and logged to memory.jsonl.
//   node explore.mjs [<bundle>]   DEVICE, MODEL, GLOBAL_STEPS, GOAL, LAUNCH_WAIT
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMobileMcp, sleep } from './mcp.mjs';
import { isModal, handleModal } from './interactions.mjs';
import { screenSignature, controlsOf, detectTabs, loadGraph, saveGraph, upsertNode, markTried } from './stategraph.mjs';
import { exploreSystem } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = process.argv[2] || 'ai.beemo.fittrack';
const DEVICE = process.env.DEVICE || 'A5C6484B-5346-4BEC-8F4C-FFDDA286D71C';
const MODEL = process.env.MODEL || 'google/gemini-3.5-flash';
const GLOBAL_STEPS = Number(process.env.GLOBAL_STEPS || 40);
const LAUNCH_WAIT = Number(process.env.LAUNCH_WAIT || 10000);
const GOAL = process.env.GOAL || '';
const FOCUS = process.env.FOCUS || '';

if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY (../spike/.env)'); process.exit(1); }
const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(MODEL);
const reasoningOpts = MODEL.includes('gemini') ? { openrouter: { reasoning: { effort: 'minimal' } } } : {};

// INPUTS_DIR lets the desktop app point config at a writable location (userData) —
// packaged, HERE is inside the read-only .app bundle. Falls back to HERE for the CLI.
const inputsPath = join(process.env.INPUTS_DIR || join(HERE, 'inputs'), `${BUNDLE}.json`);
const INPUTS = existsSync(inputsPath) ? JSON.parse(readFileSync(inputsPath, 'utf8')) : {};
// app-specific test instructions, auto-loaded by app id: instructions/<bundle>.md
const instrPath = join(HERE, 'instructions', `${BUNDLE}.md`);
const APP_INSTRUCTIONS = existsSync(instrPath) ? readFileSync(instrPath, 'utf8').trim() : '';
const credLine = INPUTS.credentials
  ? `Test credentials you may use to sign in — username: "${INPUTS.credentials.username}", password: "${INPUTS.credentials.password}".`
  : 'No credentials provided.';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = process.env.RUN_DIR || join(HERE, 'runs', `${BUNDLE}__explore__${stamp}`);
const JOURNAL = join(RUN, 'journal.jsonl'), FLAWS = join(RUN, 'flaws.jsonl'), MEMORY = join(RUN, 'memory.jsonl');
const FLOWS_FILE = join(RUN, 'flows.jsonl');
const FLOW_MIN_STEPS = Number(process.env.FLOW_MIN_STEPS || 5);
// CLEAN SLATE every run: if this RUN_DIR is reused, wipe prior per-state data so journals,
// memory trace, flaws, and screenshots never mix across runs.
rmSync(join(RUN, 'screenshots'), { recursive: true, force: true });
mkdirSync(join(RUN, 'screenshots'), { recursive: true });
for (const f of [JOURNAL, FLAWS, MEMORY, FLOWS_FILE]) writeFileSync(f, '');
const now = () => new Date().toISOString();

// "About the app" — user-provided `about` in inputs, else auto-detected app metadata.
function appAbout() {
  if (INPUTS.about) return String(INPUTS.about).trim();
  const bits = [];
  try {
    const apps = JSON.parse(execSync(`ios apps --udid=${DEVICE}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
    const a = (Array.isArray(apps) ? apps : []).find((x) => x.CFBundleIdentifier === BUNDLE);
    if (a) { if (a.CFBundleDisplayName || a.CFBundleName) bits.push(a.CFBundleDisplayName || a.CFBundleName); if (a.CFBundleShortVersionString) bits.push(`v${a.CFBundleShortVersionString}`); }
  } catch {}
  if (!bits.length) {
    try {
      const app = execSync(`xcrun simctl get_app_container ${DEVICE} ${BUNDLE} app`, { encoding: 'utf8' }).trim();
      const p = JSON.parse(execSync(`plutil -convert json -o - "${app}/Info.plist"`, { encoding: 'utf8' }));
      if (p.CFBundleDisplayName || p.CFBundleName) bits.push(p.CFBundleDisplayName || p.CFBundleName);
      if (p.CFBundleShortVersionString) bits.push(`v${p.CFBundleShortVersionString}`);
      const schemes = (p.CFBundleURLTypes || []).flatMap((t) => t.CFBundleURLSchemes || []);
      if (schemes.length) bits.push(`deep-link schemes: ${schemes.slice(0, 6).join(', ')}`);
      const perms = Object.keys(p).filter((k) => /UsageDescription$/.test(k)).map((k) => k.replace(/^NS|UsageDescription$/g, ''));
      if (perms.length) bits.push(`uses: ${perms.join(', ')}`);
    } catch {}
  }
  return bits.length
    ? `${bits.join(' · ')} · ${BUNDLE}  (auto-detected metadata — no written description, so explore the UI to learn what it does).`
    : `Bundle id ${BUNDLE}. No description or metadata available — explore the UI to learn what the app does.`;
}
const ABOUT = appAbout();

// mobile-mcp's text injection (`mobilecli io text`) is a silent no-op on the iOS Simulator —
// it reports success but nothing lands. Real keystrokes via osascript DO work. So on a
// simulator we type by focusing the field then sending keystrokes to the Simulator window.
const IS_SIM = (() => { try { return execSync('xcrun simctl list devices', { encoding: 'utf8' }).includes(DEVICE); } catch { return false; } })();
function keystroke(text) {
  const esc = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execSync(`osascript -e 'tell application "Simulator" to activate' -e 'delay 0.25' -e 'tell application "System Events" to keystroke "${esc}"'`, { stdio: 'ignore' });
}

// Voice input: shells out to the v1 CLI's `autobot speak` (TTS + play) rather than
// reimplementing it — that's where the SIGABRT-safe Multi-Output routing and the
// meeting-safe device save/restore already live (see AUDIO.md). runner.js resolves
// AUTOBOT_BIN and flips input->BlackHole for the whole run BEFORE this ever fires; this
// call only does the TTS+playback, assuming that routing is already in place.
const AUTOBOT_BIN = process.env.AUTOBOT_BIN || '';
function speak(text) {
  if (!AUTOBOT_BIN) { console.log('audio: AUTOBOT_BIN not configured — skipping speak (no loopback set up; run autobot setup-audio).'); return; }
  try { execFileSync(AUTOBOT_BIN, ['speak', text], { stdio: 'inherit' }); }
  catch (e) { console.log(`audio: speak failed — ${e.message}`); }
}

// ---- schemas ----
const FLAW = z.object({
  type: z.enum(['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy']),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-screen issues'),
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
    name: z.string().describe('short name of the flow, e.g. "Sign up and reach home"'),
    startStep: z.number().int().describe('the step number where this flow began'),
    evidence: z.string().describe('the on-screen evidence proving the flow completed'),
  }).nullable().describe('null on almost every turn — set ONLY when a whole large flow just finished (see rules)'),
  nextAction: z.object({
    kind: z.enum(['tap', 'type', 'swipe', 'back', 'relaunch', 'speak', 'stop']),
    elementIndex: z.number().int().nullable(),
    label: z.string().nullable(),
    x: z.number().int().nullable(), y: z.number().int().nullable(),
    text: z.string().nullable(),
    direction: z.enum(['up', 'down']).nullable(),
    expectation: z.string(),
  }),
  done: z.boolean(),
});

// ---- io helpers ----
let shotN = 0;
const checkpoint = (img, name) => {
  const file = `screenshots/${String(++shotN).padStart(2, '0')}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}.png`;
  writeFileSync(join(RUN, file), Buffer.from(img.data, 'base64')); return file;
};
const journalStep = (o) => appendFileSync(JOURNAL, JSON.stringify({ ts: now(), ...o }) + '\n');
const seenFlaws = new Set(); let flawN = 0;
function recordFlaws(flaws, screen, shot) {
  for (const f of flaws || []) {
    const key = `${f.type}::${f.summary.toLowerCase().slice(0, 32)}`;
    if (seenFlaws.has(key)) continue; seenFlaws.add(key);
    const id = `F-${String(++flawN).padStart(3, '0')}`;
    appendFileSync(FLAWS, JSON.stringify({ id, ts: now(), screen, ...f, screenshots: shot ? [shot] : [], status: 'open' }) + '\n');
    console.log(`   flaw ${id} [${f.severity} ${f.type}] ${f.summary}`);
  }
}

let mcpc, size, SW = 9999, SH = 9999;
const clamp = (x, y) => [Math.max(1, Math.min(SW - 1, x)), Math.max(1, Math.min(SH - 1, y))];
const elemText = (els) => els.length ? els.map((e, i) => `[${i}] "${e.label}"${e.type ? ` (${e.type})` : ''} @${e.x},${e.y}`).join('\n') : '(a11y tree empty)';
async function snapshot() { const img = await mcpc.screenshotImage(); const els = await mcpc.listElements(); return { img, els }; }

async function tapBack() {
  const els = await mcpc.listElements();
  const back = els.find((e) => e.y < 110 && e.x < 140 && e.label && e.label.length > 1);
  if (back) { await mcpc.tap(back.x, back.y); return true; }
  await mcpc.swipe('right'); return false; // edge-swipe back as a fallback
}
async function relaunch() { await mcpc.terminate(BUNDLE); await mcpc.launchAndWait(BUNDLE, LAUNCH_WAIT); }
let _lastTapKey = null, _tapRetries = 0;
async function execute(a, els) {
  if (a.kind === 'stop') return;
  if (a.kind === 'back') { await tapBack(); await sleep(900); return; }
  if (a.kind === 'relaunch') { await relaunch(); await sleep(900); return; }
  if (a.kind === 'swipe') { await mcpc.swipe(a.direction || 'up'); await sleep(900); return; }
  if (a.kind === 'speak') { if (a.text) speak(a.text); await sleep(1500); return; } // let the app react before the next screenshot
  // tap / type
  const el = (a.elementIndex != null) ? els[a.elementIndex] : null;
  let x = el ? el.x : a.x, y = el ? el.y : a.y;
  if (x == null) { await sleep(900); return; }
  // RETRY HARDENING: if we're tapping the same target again (the model thinks the last tap did
  // nothing — often a near-miss on a small control), wait a touch longer and nudge the point to
  // a DIFFERENT spot inside the element. Offset scales with the element's size and grows with
  // each consecutive retry, sweeping the area so a missed hit-target eventually lands.
  const key = el ? `${el.label}@${el.x},${el.y}` : `${x},${y}`;
  if (key === _lastTapKey) _tapRetries++; else { _lastTapKey = key; _tapRetries = 0; }
  if (_tapRetries > 0) {
    await sleep(450 * _tapRetries);                                   // progressive settle delay
    const w = el?.w || 40, h = el?.h || 40, ang = _tapRetries * 2.0;  // rotate the offset direction
    const frac = Math.min(0.4, 0.18 * _tapRetries);                  // step further out each retry
    x = Math.round(x + Math.cos(ang) * (w / 2) * frac);
    y = Math.round(y + Math.sin(ang) * (h / 2) * frac);
  }
  [x, y] = clamp(x, y);
  if (a.kind === 'type') { await mcpc.tap(x, y); await sleep(500); if (a.text) { if (IS_SIM) keystroke(a.text); else await mcpc.typeText(a.text); } }
  else await mcpc.tap(x, y);
  await sleep(900);
}

// ---- coverage ledger: the deterministic state graph, maintained alongside the LLM ----
// The model does its best judgement; the graph is ground truth for what exists and what
// was actually exercised. Rendered into the prompt each turn (renderCoverage) and saved
// to disk every step so a killed run still leaves a complete ledger.
const STATE = process.env.STATE_GRAPH || join(RUN, 'state-graph.json');
const g = loadGraph(STATE);
const tabsSeen = new Set();   // lowercased tab-bar labels ever detected
const tabsTried = new Set();  // tab labels the model actually opened
const untriedOf = (n) => (n.controls || []).filter((c) => !n.tried.includes(c));

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

function renderCoverage(sig, els) {
  const hereTried = g.nodes[sig]?.tried || [];
  const hereUntried = controlsOf(els, [...tabsSeen]).map((c) => c.label).filter((l) => !hereTried.includes(l));
  const elsewhere = Object.values(g.nodes)
    .filter((n) => n.signature !== sig && untriedOf(n).length)
    .slice(0, 12)
    .map((n) => {
      const u = untriedOf(n);
      return `• ${n.name}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? ` (+${u.length - 8} more)` : ''}`;
    });
  const tabsLeft = [...tabsSeen].filter((t) => !tabsTried.has(t));
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  return [
    `Screens mapped: ${nodes.length} · controls exercised: ${tried}/${total || '?'}`,
    `Untried on THIS screen: ${hereUntried.join(', ') || 'none — everything here was exercised'}`,
    tabsLeft.length ? `Tabs never opened: ${tabsLeft.join(', ')}` : null,
    elsewhere.length ? `Untried controls on OTHER screens (paths you didn't trace):\n${elsewhere.join('\n')}` : 'No other screens with untried controls.',
    flowsDone.length ? `Flows already completed this run (do NOT re-declare these): ${flowsDone.map((f) => `"${f.name}" (steps ${f.startStep}–${f.endStep})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

// ---- the never-pruned memory trace ----
const trace = [];
const actionStr = (a) => `${a.kind}${a.label ? ` '${a.label}'` : ''}${a.text ? ` "${a.text}"` : ''}${a.direction ? ` ${a.direction}` : ''}`;
const orDash = (a) => (a && a.length ? a.join('; ') : '—');
function renderMemory() {
  if (!trace.length) return '(empty — this is your first turn)';
  return trace.map((t) => [
    `--- step: ${t.step}  |  time: ${t.time}  |  screen: ${t.screen}`,
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
mcpc = await connectMobileMcp(DEVICE);
await relaunch();
size = await mcpc.screenSize();
const sm = size.match(/(\d{2,4})\D{1,4}(\d{2,4})/); if (sm) { SW = +sm[1]; SH = +sm[2]; }
console.log(`explore: ${MODEL} · ${BUNDLE} (${SW}x${SH})\nabout: ${ABOUT}\napp-instructions: ${APP_INSTRUCTIONS ? `loaded (${instrPath})` : 'none'}\n`);

for (let step = 0; step < GLOBAL_STEPS; step++) {
  let snap = await snapshot();
  if (isModal(snap.els)) { const p = await handleModal(mcpc, snap.els); console.log(`   • modal dismissed via '${p}'`); snap = await snapshot(); }
  const els = snap.els;
  const sig = screenSignature(els);
  for (const tl of detectTabs(els, SW, SH)) tabsSeen.add(tl);

  const { object: t } = await generateObject({
    model, schema: TURN, providerOptions: reasoningOpts,
    messages: [
      { role: 'system', content: exploreSystem({ about: ABOUT, size, goal: GOAL, focus: FOCUS, credLine, memory: renderMemory(), coverage: renderCoverage(sig, els), appInstructions: APP_INSTRUCTIONS }) },
      { role: 'user', content: [
        { type: 'text', text: `CURRENT SCREEN — ELEMENTS (index in brackets):\n${elemText(els)}` },
        { type: 'image', image: `data:${snap.img.mimeType};base64,${snap.img.data}` },
      ] },
    ],
  });

  // ledger: register this screen + its controls, and mark the chosen control tried.
  const node = upsertNode(g, sig, t.screen, els);
  node.controls = [...new Set([...(node.controls || []), ...controlsOf(els, [...tabsSeen]).map((c) => c.label)])];
  {
    const el = (t.nextAction.elementIndex != null) ? els[t.nextAction.elementIndex] : null;
    const label = el?.label || t.nextAction.label;
    if ((t.nextAction.kind === 'tap' || t.nextAction.kind === 'type') && label) {
      markTried(g, sig, label);
      if (tabsSeen.has(String(label).toLowerCase())) tabsTried.add(String(label).toLowerCase());
    }
  }
  saveGraph(STATE, g);

  const flow = recordFlow(t.flowCompleted, step, t.screen);

  const shot = checkpoint(snap.img, t.screen);
  recordFlaws(t.flaws, t.screen, shot);
  const aStr = actionStr(t.nextAction);
  const rec = { step, time: now(), screen: t.screen, uiDone: t.uiDone, action: aStr, expectation: t.nextAction.expectation,
    expectationCheck: t.expectationCheck, reasoning: t.reasoning, goalsSoFar: t.goalsSoFar, goalsCompleted: t.goalsCompleted,
    areasRemaining: t.areasRemaining, flaws: t.flaws.map((f) => f.summary), crashed: t.crashed };
  trace.push(rec);
  appendFileSync(MEMORY, JSON.stringify(rec) + '\n');
  journalStep({ step, screen: t.screen, action: aStr, description: t.uiDone, expectation: t.nextAction.expectation,
    expectationCheck: t.expectationCheck, crashed: t.crashed, screenshot: shot, done: t.done, ...(flow ? { flow: flow.id } : {}) });
  console.log(`step ${step}  [${t.screen}]  → ${aStr}\n   ${t.reasoning.slice(0, 100)}`);
  const covTotal = Object.values(g.nodes).reduce((s, n) => s + (n.controls || []).length, 0);
  const covTried = Object.values(g.nodes).reduce((s, n) => s + n.tried.length, 0);
  console.log('@@PROGRESS ' + JSON.stringify({ step, screen: t.screen, action: aStr, reasoning: t.reasoning.slice(0, 120),
    goalsCompleted: t.goalsCompleted.length, areasRemaining: t.areasRemaining.length, flaws: t.flaws.length, crashed: t.crashed, done: t.done,
    coverage: { tried: covTried, total: covTotal, screens: Object.keys(g.nodes).length }, ...(flow ? { flow: flow.name } : {}) }));

  if (t.crashed) { console.log('   ⚠ crash detected — relaunching'); await relaunch(); continue; }
  if (t.done || t.nextAction.kind === 'stop') { console.log(`\nexplorer finished: ${t.uiDone}`); break; }
  await execute(t.nextAction, els);
}

console.log('\n================ EXPLORE SUMMARY ================');
const goals = [...new Set(trace.flatMap((t) => t.goalsCompleted || []))];
console.log(`steps: ${trace.length}/${GLOBAL_STEPS}   flaws: ${flawN}   screens (last): ${trace.slice(-1)[0]?.screen || '—'}`);
console.log(`goals completed: ${goals.join(' · ') || 'none'}`);
{
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  const leftovers = nodes.filter((n) => untriedOf(n).length).map((n) => `${n.name} (${untriedOf(n).length})`);
  console.log(`coverage: ${tried}/${total} controls across ${nodes.length} screens${leftovers.length ? `   UNTRIED: ${leftovers.join(', ')}` : '   — frontier empty'}`);
  console.log(`flows completed: ${flowsDone.length ? flowsDone.map((f) => `"${f.name}" (${f.steps} steps)`).join(' · ') : 'none'}`);
}
console.log(`run: ${RUN}`);
console.log('================================================');
await mcpc.close();
process.exit(0);

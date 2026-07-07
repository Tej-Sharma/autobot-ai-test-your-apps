// ============================================================================
// alternate-dfs-app-traversal.mjs — LEGACY drive pass (explore.mjs is the default
// brain). Deterministic DFS exploration with a backtrack frontier; the model only
// judges. Rich cause/effect perception: before+after screenshots, deterministic
// tree-diff, a 20-deep action sequence, and a model-generated screen-description trail.
// Prompts: prompts.mjs · identity/frontier/diff: stategraph.mjs
//   npm run drive [-- <bundle>]   MODE=login|signup   GLOBAL_STEPS, PATIENCE…
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMobileMcp, sleep } from './mcp.mjs';
import { screenSignature, controlsOf, diffTrees, detectTabs, loadGraph, saveGraph, upsertNode, markTried, pushFrontier, popFrontier } from './stategraph.mjs';
import { reviewSystem, reviewMemory, reviewUser, bootstrapSystem, bootstrapUser } from './prompts.mjs';
import { findOrScroll, collectScrollable, isModal, handleModal, fillForms } from './interactions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = process.argv[2] || 'ai.beemo.fittrack';
const DEVICE = process.env.DEVICE || 'A5C6484B-5346-4BEC-8F4C-FFDDA286D71C';
const MODEL = process.env.MODEL || 'google/gemini-3.5-flash';
const MODE = process.env.MODE || 'login';
const GLOBAL_STEPS = Number(process.env.GLOBAL_STEPS || 40);
const LAUNCH_WAIT = Number(process.env.LAUNCH_WAIT || 10000);
const MEM = Number(process.env.MEM || 20);            // how many recent actions / screens to feed
const GOAL = process.env.GOAL || 'Exercise every feature: visit every screen/tab, tap every button, follow each flow, and report anything broken.';
// Tab bar: auto-detected at runtime (detectTabs) so any app works out of the box.
// TAB_LABELS env, if set, is an explicit override.
const TAB_OVERRIDE = process.env.TAB_LABELS ? process.env.TAB_LABELS.split(',').map((s) => s.trim().toLowerCase()) : null;
let tabLabels = TAB_OVERRIDE || [];

if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY (../spike/.env)'); process.exit(1); }
const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(MODEL);
const reasoningOpts = MODEL.includes('gemini') ? { openrouter: { reasoning: { effort: 'minimal' } } } : {};

const inputsPath = join(HERE, 'inputs', `${BUNDLE}.json`);
const INPUTS = existsSync(inputsPath) ? JSON.parse(readFileSync(inputsPath, 'utf8')) : {};
const credLine = INPUTS.credentials
  ? `Test credentials — username: "${INPUTS.credentials.username}", password: "${INPUTS.credentials.password}".` : 'No credentials provided.';
const TEST_DATA = INPUTS.testData || {}; // for general form-fill (#7)

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = process.env.RUN_DIR || join(HERE, 'runs', `${BUNDLE}__${stamp}`); // #10: bin/autobot can point this at its report dir
mkdirSync(join(RUN, 'screenshots'), { recursive: true });

// #12 framework detection (deterministic, from the .app bundle) — routing decision is logged.
function detectFramework() {
  try {
    const app = execSync(`xcrun simctl get_app_container ${DEVICE} ${BUNDLE} app`, { encoding: 'utf8' }).trim();
    if (existsSync(`${app}/Frameworks/Flutter.framework`)) return 'flutter';
    if (existsSync(`${app}/Frameworks/hermes.framework`) || existsSync(`${app}/main.jsbundle`)) return 'react-native';
    return 'native';
  } catch { return 'unknown'; }
}

// "About the app" — good-to-know context handed to the QA agent. Priority: a user-provided
// `about` in inputs/<bundle>.json, else auto-built from installed-app metadata: go-ios on a
// real device, the app's Info.plist on a simulator (richer — url schemes + permission strings).
function appAbout() {
  if (INPUTS.about) return String(INPUTS.about).trim();
  const bits = [];
  try { // real device: lockdown-exposed app metadata
    const apps = JSON.parse(execSync(`ios apps --udid=${DEVICE}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
    const a = (Array.isArray(apps) ? apps : []).find((x) => x.CFBundleIdentifier === BUNDLE);
    if (a) { if (a.CFBundleDisplayName || a.CFBundleName) bits.push(a.CFBundleDisplayName || a.CFBundleName); if (a.CFBundleShortVersionString) bits.push(`v${a.CFBundleShortVersionString}`); }
  } catch {}
  if (!bits.length) { // simulator: read the app's Info.plist
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
    ? `${bits.join(' · ')} · ${BUNDLE}  (auto-detected metadata — no written description was provided, so explore the UI to learn what it does).`
    : `Bundle id ${BUNDLE}. No description or metadata available — explore the UI to learn what the app does and offers.`;
}
const ABOUT = appAbout();

// #13 retry transient model/MCP failures.
async function withRetry(fn, label, n = 2) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= n) throw e; console.log(`   retry ${label} (${i + 1}/${n}): ${String(e.message).slice(0, 80)}`); await sleep(800 * (i + 1)); }
  }
}
const JOURNAL = join(RUN, 'journal.jsonl'), FLAWS = join(RUN, 'flaws.jsonl');
const STATE = process.env.STATE_GRAPH || join(RUN, 'state-graph.json'); // per-run (fresh) unless overridden
const now = () => new Date().toISOString();
const g = loadGraph(STATE);

// ---- schemas ----
const FLAW = z.object({
  type: z.enum(['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy']),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-screen issues'),
});
const REVIEW = z.object({
  screenName: z.string(),
  description: z.string().describe('one-line description of the CURRENT screen for the trail'),
  visibleText: z.array(z.string()),
  leftApp: z.boolean(), loginGate: z.boolean(),
  flaws: z.array(FLAW),
});
const ACTION = z.object({
  kind: z.enum(['tap', 'type']), label: z.string(),
  elementIndex: z.number().int().nullable(), x: z.number().int().nullable(), y: z.number().int().nullable(),
  text: z.string().nullable(), reason: z.string(),
});

// ---- journal / flaws / screenshots ----
let shotN = 0;
const checkpoint = (img, name) => {
  const file = `screenshots/${String(++shotN).padStart(2, '0')}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}.png`;
  writeFileSync(join(RUN, file), Buffer.from(img.data, 'base64')); return file;
};
const journalStep = (o) => appendFileSync(JOURNAL, JSON.stringify({ ts: now(), ...o }) + '\n');
const seenFlaws = new Set(); const flawsBySig = {};
function recordFlaws(flaws, screen, shot, sig) {
  for (const f of flaws || []) {
    const key = `${sig}::${f.type}::${f.summary.toLowerCase().slice(0, 24)}`;
    if (seenFlaws.has(key)) continue; seenFlaws.add(key);
    (flawsBySig[sig] ||= []).push(f.summary);
    const id = `F-${String(++g.flaws).padStart(3, '0')}`;
    appendFileSync(FLAWS, JSON.stringify({ id, ts: now(), screen, ...f, screenshots: shot ? [shot] : [], status: 'open' }) + '\n');
    console.log(`   flaw ${id} [${f.severity} ${f.type}] ${f.summary}`);
  }
}

let mcpc, size, SW = 9999, SH = 9999;        // screen bounds for coordinate clamping (#13)
const clamp = (x, y) => [Math.max(1, Math.min(SW - 1, x)), Math.max(1, Math.min(SH - 1, y))];
const recent = [];  // action sequence (we feed the last MEM)
const trail = [];   // model-generated screen descriptions (we feed the last MEM)

// ---- loop guard: rolling window of the last N state signatures ----
// Lets the agent notice it's churning (toggle loops, dead controls, scroll walls)
// and bail to a different branch instead of re-poking the same control forever.
const HISTORY = Number(process.env.HISTORY || 10);
const ring = [];                                   // [{sig,label}] last HISTORY interactions
function recordState(sig, label) { ring.push({ sig, label }); if (ring.length > HISTORY) ring.shift(); }
// 'stall' = same screen 3 taps running (no-effect control / end of a scroll);
// 'cycle' = last 6 interactions bounce between ≤2 screens (e.g. Start↔Pause).
function stuckSignal() {
  if (ring.length < 3) return null;
  const last3 = ring.slice(-3).map((s) => s.sig);
  if (new Set(last3).size === 1) return 'stall';
  const last6 = ring.slice(-6).map((s) => s.sig);
  if (last6.length >= 6 && new Set(last6).size <= 2) return 'cycle';
  return null;
}
// Shared blacklist-on-stuck — used by BOTH the main DFS loop and bootstrap, so a
// churning control gets blacklisted the same way no matter which loop hit it.
// Blacklists only the REPEATING controls (tapped ≥2x in the window) — the actual
// toggle/no-op culprits — never a feature that's only incidentally in the window.
function handleChurn(fallbackLabel) {
  const churn = stuckSignal();
  if (!churn) return null;
  const win = ring.slice(-6);
  const freq = {}; for (const s of win) freq[s.label] = (freq[s.label] || 0) + 1;
  const culprits = [...new Set(win.map((s) => s.label))].filter((l) => freq[l] >= 2);
  const drop = culprits.length ? culprits : [fallbackLabel];
  const sigs = new Set(win.map((s) => s.sig));
  for (const s of sigs) for (const l of drop) markTried(g, s, l);
  console.log(`   ⟲ ${churn}: blacklisted [${drop.join(', ')}] across ${sigs.size} screen(s) — backtracking`);
  saveGraph(STATE, g);
  return churn;
}

const elemText = (els) => els.length ? els.map((e, i) => `[${i}] "${e.label}"${e.type ? ` (${e.type})` : ''} @${e.x},${e.y}`).join('\n') : '(a11y tree empty)';
async function snapshot() { const img = await mcpc.screenshotImage(); const els = await mcpc.listElements(); return { img, els, sig: screenSignature(els) }; }
async function execute(a) {
  const [x, y] = a.x != null ? clamp(a.x, a.y) : [null, null]; // #13: clamp out-of-bounds coords (model drift)
  if (a.kind === 'type') { if (x != null) await mcpc.tap(x, y); await sleep(350); if (a.text) await mcpc.typeText(a.text); }
  else if (x != null) await mcpc.tap(x, y);
  await sleep(900);
}

// Shared memory builder — EVERY caller that talks to the model (the main DFS review
// loop, and bootstrap below) gets the exact same context: what was just tried and
// whether it changed anything, the full recent action/screen trail, untried controls
// on this exact screen, known flaws here, and every screen name seen so far. Bootstrap
// used to skip all of this and call the model with nothing but the current screen —
// which is why it could repeat an already-failed tap turn after turn.
function buildMemory(sig, els, lastAction, diff) {
  const triedHere = g.nodes[sig]?.tried || [];
  const untried = controlsOf(els, tabLabels).filter((c) => !triedHere.includes(c.label)).map((c) => c.label);
  return reviewMemory({
    lastAction, diff, recent: recent.slice(-MEM), trail: trail.slice(-MEM), untried,
    knownFlaws: (flawsBySig[sig] || []).slice(-10),
    seen: [...new Set(Object.values(g.nodes).map((n) => n.name))],
  });
}

// The cause/effect review: TWO images (before + after) + tree-diff + sequence memory.
async function reviewScreen(before, after, lastAction, diff) {
  const mem = buildMemory(after.sig, after.els, lastAction, diff);
  const content = [{ type: 'text', text: reviewUser({ mem, elemText: elemText(after.els) }) }];
  if (before) {
    content.push({ type: 'text', text: 'IMAGE 1 — BEFORE the last action:' }, { type: 'image', image: `data:${before.img.mimeType};base64,${before.img.data}` });
    content.push({ type: 'text', text: 'IMAGE 2 — NOW (after the last action):' });
  }
  content.push({ type: 'image', image: `data:${after.img.mimeType};base64,${after.img.data}` });
  const { object } = await withRetry(() => generateObject({ model, schema: REVIEW, providerOptions: reasoningOpts,
    messages: [{ role: 'system', content: reviewSystem({ about: ABOUT, size, goal: GOAL }) }, { role: 'user', content }] }), 'review');
  return object;
}

// ---- bootstrap into the app (login or signup) ----
const fieldish = (e) => /field/i.test(e.label), loginish = (e) => /log\s*in|sign\s*in|continue/i.test(e.label);
const createish = (e) => /create account|sign ?up|get started/i.test(e.label);
// "in the app": either the override tabs are all present, or we can see a real tab bar.
const inApp = (els) => {
  if (TAB_OVERRIDE) { const L = els.map((e) => e.label.toLowerCase()); return TAB_OVERRIDE.every((t) => L.includes(t)); }
  return detectTabs(els, SW, SH).length >= 3;
};
const isLoginGate = (els) => els.filter(fieldish).length >= 2 && els.some(loginish);

async function fillLogin(creds) {
  let els = await mcpc.listElements(); let f = els.filter(fieldish).sort((p, q) => p.y - q.y);
  if (f.length < 2) return false;
  await mcpc.tap(f[0].x, f[0].y); await sleep(700); await mcpc.typeText(creds.username); await sleep(500);
  els = await mcpc.listElements(); f = els.filter(fieldish).sort((p, q) => p.y - q.y);
  await mcpc.tap((f[1] || f[0]).x, (f[1] || f[0]).y); await sleep(700); await mcpc.typeText(creds.password); await sleep(500);
  await mcpc.tap(f[0].x, Math.max(60, f[0].y - 140)); await sleep(600); // dismiss keyboard
  els = await mcpc.listElements(); const b = els.find(loginish);
  if (b) { await mcpc.tap(b.x, b.y); await sleep(1400); } return !!b;
}
async function pickAction(snap, lastAction, diff) {
  const memory = buildMemory(snap.sig, snap.els, lastAction, diff);
  const { object } = await withRetry(() => generateObject({ model, schema: ACTION, providerOptions: reasoningOpts,
    messages: [{ role: 'system', content: bootstrapSystem({ about: ABOUT, credLine, size }) },
      { role: 'user', content: [{ type: 'text', text: bootstrapUser({ elemText: elemText(snap.els), memory }) }, { type: 'image', image: `data:${snap.img.mimeType};base64,${snap.img.data}` }] }] }), 'bootstrap');
  if (object.elementIndex != null && snap.els[object.elementIndex]) { object.x = snap.els[object.elementIndex].x; object.y = snap.els[object.elementIndex].y; object.label = snap.els[object.elementIndex].label; }
  return object;
}
// Bootstrap runs the SAME per-turn pipeline as the main DFS loop below (review →
// trail/graph/journal/flaw-recording → shared churn/blacklist → frontier growth) —
// the only real difference is how the NEXT action gets picked: the main loop pops a
// known frontier task, bootstrap asks the model (pickAction) because there's no
// predetermined task list telling it "the way out" of a login/crash/unknown screen.
// Because reviewScreen + all the bookkeeping run FIRST, pickAction's own memory
// (buildMemory) already reflects this turn's analysis — the trail/flaws/graph are one
// connected feed, not two disconnected mechanisms.
async function enterApp() {
  let bootPath = [];              // local nav-path (mirrors currentPath) — starts fresh from Home
  let prevSnap = null, lastAction = null, lastLabel = null, lastActionObj = null;
  for (let b = 0; b < 16; b++) {
    const snap = await snapshot();
    if (isModal(snap.els)) { await handleModal(mcpc, snap.els); continue; } // #6 permission prompts during onboarding
    if (inApp(snap.els)) return snap;

    if (isLoginGate(snap.els)) {
      if (MODE === 'signup') { const cta = snap.els.find(createish); if (cta) { console.log('  ⮕ signup: Create account'); await mcpc.tap(cta.x, cta.y); await sleep(900); prevSnap = null; lastAction = lastLabel = null; continue; } }
      else if (INPUTS.credentials) { console.log('  ⮕ login (demo/demo)'); await fillLogin(INPUTS.credentials); prevSnap = null; lastAction = lastLabel = null; continue; }
    }

    // ---- full analysis, identical to the main loop's per-step review ----
    const diff = prevSnap ? diffTrees(prevSnap.els, snap.els) : null;
    const r = await reviewScreen(prevSnap, snap, lastAction, diff);
    trail.push({ name: r.screenName, desc: r.description });
    const node = upsertNode(g, snap.sig, r.screenName, snap.els);
    const newScreen = node.visits === 1;
    const shot = (newScreen || r.flaws.length || (diff && !diff.changed)) ? checkpoint(snap.img, r.screenName) : null;
    journalStep({ step: 'boot', screen_before: prevSnap ? g.nodes[prevSnap.sig]?.name : undefined, screen: r.screenName,
      signature: snap.sig, action: lastAction || '(enter app)', description: r.description, changed: diff ? diff.changed : true,
      appeared: diff?.appeared, disappeared: diff?.disappeared, new_screen: newScreen, screenshot: shot,
      crashed: r.leftApp, verdict: r.leftApp ? 'crashed' : (diff && !diff.changed ? 'no-effect' : 'ok') });
    console.log(`boot   [${r.screenName}] ${lastAction || '(enter)'} → ${!diff ? 'n/a' : diff.changed ? 'changed' : 'NO CHANGE'}${newScreen ? ' *NEW*' : ''}`);
    console.log('@@PROGRESS ' + JSON.stringify({ step: 'boot', screen: r.screenName, action: lastAction || '(enter)', changed: diff ? diff.changed : true, newScreen, flaws: r.flaws.length }));
    recordFlaws(r.flaws, r.screenName, shot, snap.sig);

    if (r.leftApp) {
      recordFlaws([{ type: 'crash', severity: 'high', summary: `left app during bootstrap after '${lastAction}'`, detail: 'returned to home / different app' }], r.screenName, shot, snap.sig);
      await mcpc.launchAndWait(BUNDLE, LAUNCH_WAIT);
      prevSnap = null; lastAction = lastLabel = null; bootPath = []; saveGraph(STATE, g); continue;
    }

    if (lastLabel) recordState(snap.sig, lastLabel); // shared ring — same cycle detector the main loop uses
    if (diff?.changed && lastActionObj) bootPath.push(lastActionObj);

    // tab bar may only appear after onboarding/login — detect it the first time we see one.
    if (!TAB_OVERRIDE && !tabLabels.length && newScreen) {
      const t = detectTabs(snap.els, SW, SH);
      if (t.length) { tabLabels = t; console.log(`   • tab bar detected: [${t.join(', ')}]`); }
    }
    pushFrontier(g, snap.sig, bootPath, controlsOf(snap.els, tabLabels)); // queue this screen for later real exploration
    saveGraph(STATE, g);

    if (handleChurn(lastLabel)) { // blacklisted the churning control(s) — break the cycle with a relaunch
      await mcpc.launchAndWait(BUNDLE, LAUNCH_WAIT);
      prevSnap = null; lastAction = lastLabel = null; bootPath = []; continue;
    }

    const a = await pickAction(snap, lastAction, diff); // benefits from the trail/flaws/graph just updated above
    console.log(`  bootstrap: ${a.kind} '${a.label}' — ${a.reason}`);
    await execute(a);
    lastAction = `${a.kind} '${a.label}'`; lastLabel = a.label; lastActionObj = { label: a.label, x: a.x, y: a.y };
    recent.push(`bootstrap: ${lastAction}`); // so the NEXT turn (or the main loop, via shared `recent`) sees this attempt
    prevSnap = snap;
  }
  return await snapshot();
}
async function relaunchToApp() { await mcpc.launchAndWait(BUNDLE, LAUNCH_WAIT); return enterApp(); }
const labelsOf = (p) => p.map((a) => a.label).join(' > ');
async function rewalk(reach) {
  for (const action of reach) {
    const hit = await findOrScroll(mcpc, action.label);
    await execute({ kind: 'tap', x: (hit || action).x, y: (hit || action).y });
  }
}

// #15: reach a target screen by IN-APP navigation (back button + tabs + forward taps).
// Pop back to the common ancestor, then tap forward. Returns false if it gets stuck.
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i].label === b[i].label) i++; return i; };
async function tapBack() {
  const els = await mcpc.listElements();
  const back = els.find((e) => e.y < 110 && e.x < 140 && e.label && e.label.length > 1); // top-left nav back
  if (!back) return false;
  await mcpc.tap(back.x, back.y); await sleep(700); return true;
}
async function reachInApp(target) {
  const cp = commonPrefix(currentPath, target);
  for (let i = currentPath.length; i > cp; i--) { if (!await tapBack()) return false; }
  currentPath = currentPath.slice(0, cp);
  for (let i = cp; i < target.length; i++) {
    const hit = await findOrScroll(mcpc, target[i].label);
    if (!hit) return false;
    await execute({ kind: 'tap', x: hit.x, y: hit.y });
    currentPath.push(target[i]);
  }
  return true;
}

// ============================ MAIN ============================
mcpc = await connectMobileMcp(DEVICE);
const FRAMEWORK = detectFramework();                       // #12
await mcpc.terminate(BUNDLE);                               // #13 state reset: fresh app state each run
await mcpc.launchAndWait(BUNDLE, LAUNCH_WAIT);
size = await mcpc.screenSize();
const sm = size.match(/(\d{2,4})\D{1,4}(\d{2,4})/); if (sm) { SW = +sm[1]; SH = +sm[2]; } // #13 bounds for clamping
console.log(`drive: ${MODEL} · mode=${MODE} · framework=${FRAMEWORK} · ${BUNDLE} (${SW}x${SH})\n`);

let after = await enterApp();
let currentPath = [];
let step = 0;

// auto-detect the tab bar from the entry screen (unless explicitly overridden).
if (!TAB_OVERRIDE) {
  tabLabels = detectTabs(after.els, SW, SH);
  console.log(tabLabels.length ? `tab bar detected: [${tabLabels.join(', ')}]` : 'no tab bar detected (single-surface app)');
}

// step 0 — review the entry screen (no "before")
{
  const r = await reviewScreen(null, after, null, null);
  trail.push({ name: r.screenName, desc: r.description });
  upsertNode(g, after.sig, r.screenName, after.els);
  const shot = checkpoint(after.img, r.screenName);
  journalStep({ step: 0, screen: r.screenName, signature: after.sig, action: '(enter app)', description: r.description, new_screen: true, screenshot: shot, verdict: 'ok' });
  console.log(`step 0  [${r.screenName}]  ${r.description}`);
  console.log('@@PROGRESS ' + JSON.stringify({ step: 0, screen: r.screenName, action: '(enter app)', changed: true, newScreen: true, flaws: r.flaws.length }));
  recordFlaws(r.flaws, r.screenName, shot, after.sig);
  // seed: this screen's controls + the tab bar (once)
  const tabs = after.els.filter((e) => tabLabels.includes(e.label.toLowerCase()));
  pushFrontier(g, after.sig, currentPath, [...controlsOf(after.els, tabLabels), ...tabs]);
  saveGraph(STATE, g);
}

while (g.frontier.length && step < GLOBAL_STEPS) {
  const task = popFrontier(g);
  if (!task) break;

  if (labelsOf(currentPath) !== labelsOf(task.reach)) {
    let ok = await reachInApp(task.reach);                  // #15: in-app nav first (back/tabs/forward)
    if (ok) { const s = await snapshot(); ok = (s.sig === task.expectSig); }
    if (ok) console.log(`  ↳ in-app nav → [${labelsOf(task.reach) || '(home)'}]`);
    else { console.log(`  ↩ relaunch fallback → [${labelsOf(task.reach) || '(home)'}]`); await relaunchToApp(); await rewalk(task.reach); }
    currentPath = task.reach.map((a) => ({ ...a }));
  }

  // verify-before-act: the path may say we're here, but a transient overlay (a menu/sheet)
  // can auto-dismiss — leaving taps landing on the wrong screen (all NO-CHANGE). Confirm the
  // on-screen signature matches; if it drifted, re-walk the reach (light), then relaunch
  // (heavy). If it still won't load, drop the task instead of burning steps on dead taps.
  {
    let cur = await snapshot();
    if (cur.sig !== task.expectSig) {
      await rewalk(task.reach); cur = await snapshot();
      if (cur.sig !== task.expectSig) { await relaunchToApp(); await rewalk(task.reach); cur = await snapshot(); }
      currentPath = task.reach.map((a) => ({ ...a }));
      if (cur.sig !== task.expectSig) {
        console.log(`   ✗ unreachable: '${task.action.label}' (screen drift) — skipping`);
        markTried(g, task.expectSig, task.action.label); saveGraph(STATE, g); continue;
      }
    }
  }

  const tgt = await findOrScroll(mcpc, task.action.label); // #5: scroll to it if below the fold / drifted
  const before = await snapshot();                 // screen we're acting on
  markTried(g, task.expectSig, task.action.label);
  const lastAction = `tap '${task.action.label}'`;
  await execute({ kind: 'tap', x: (tgt || task.action).x, y: (tgt || task.action).y });
  recent.push(lastAction); step++;

  after = await snapshot();                         // resulting screen
  if (isModal(after.els)) { const p = await handleModal(mcpc, after.els); console.log(`   • modal dismissed via '${p}'`); after = await snapshot(); } // #6
  const diff = diffTrees(before.els, after.els);
  recordState(after.sig, task.action.label);        // loop-guard: remember where this tap landed
  if (diff.changed) currentPath.push(task.action);  // only extend the nav path when we actually moved (no-ops don't inflate it)
  const r = await reviewScreen(before, after, lastAction, diff);
  trail.push({ name: r.screenName, desc: r.description });

  const node = upsertNode(g, after.sig, r.screenName, after.els);
  const newScreen = node.visits === 1;
  const shot = (newScreen || r.flaws.length || !diff.changed) ? checkpoint(after.img, r.screenName) : null;
  journalStep({ step, branch: task.id, screen_before: g.nodes[task.expectSig]?.name, screen: r.screenName, signature: after.sig,
    action: lastAction, description: r.description, changed: diff.changed, appeared: diff.appeared, disappeared: diff.disappeared,
    new_screen: newScreen, screenshot: shot, crashed: r.leftApp, verdict: r.leftApp ? 'crashed' : (diff.changed ? 'ok' : 'no-effect') });
  console.log(`step ${step}  [${r.screenName}] ${lastAction} → ${diff.changed ? 'changed' : 'NO CHANGE'}${newScreen ? ' *NEW*' : ''}  (frontier ${g.frontier.length})`);
  console.log('@@PROGRESS ' + JSON.stringify({ step, screen: r.screenName, action: lastAction, changed: diff.changed, newScreen, flaws: r.flaws.length }));
  recordFlaws(r.flaws, r.screenName, shot, after.sig);

  if (r.leftApp) {
    recordFlaws([{ type: 'crash', severity: 'high', summary: `left app after '${task.action.label}'`, detail: 'returned to home / different app' }], r.screenName, shot, task.expectSig);
    after = await relaunchToApp(); currentPath = []; saveGraph(STATE, g); continue;
  }
  if (r.loginGate) { after = await enterApp(); currentPath = []; }
  // loop guard: recent taps are cycling/stalling → blacklist the churning controls
  // across the cycling screens and pop a different frontier branch (backtrack / move on).
  if (handleChurn(task.action.label)) continue;
  if (newScreen && !r.loginGate) { const n = await fillForms(mcpc, TEST_DATA); if (n) console.log(`   • filled ${n} form field(s)`); } // #7
  // tab bar may only appear after onboarding/login — detect it the first time we see one.
  if (!TAB_OVERRIDE && !tabLabels.length && newScreen) {
    const t = detectTabs(after.els, SW, SH);
    if (t.length) {
      tabLabels = t; console.log(`   • tab bar detected: [${t.join(', ')}]`);
      pushFrontier(g, after.sig, currentPath, after.els.filter((e) => tabLabels.includes(e.label.toLowerCase())));
    }
  }
  const ctl = newScreen ? await collectScrollable(mcpc, controlsOf, tabLabels) : controlsOf(after.els, tabLabels); // #5 below-the-fold
  pushFrontier(g, after.sig, currentPath, ctl);
  saveGraph(STATE, g);
}

const nodes = Object.values(g.nodes);
console.log('\n================ DRIVE SUMMARY ================');
console.log(`screens: ${nodes.length}  (${nodes.map((n) => n.name).join(', ')})`);
console.log(`steps: ${step}/${GLOBAL_STEPS}   pending: ${g.frontier.length}   flaws: ${g.flaws}`);
console.log(`run: ${RUN}`);
console.log(`next: npm run critique -- ${RUN}  &&  npm run report -- ${RUN}`);
console.log('===============================================');
saveGraph(STATE, g);
await mcpc.close();
process.exit(0);

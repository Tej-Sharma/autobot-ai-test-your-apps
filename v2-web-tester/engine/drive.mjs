// ============================================================================
// drive.mjs — DRIVE pass. DFS exploration with a backtrack frontier, and rich
// cause/effect perception: before+after screenshots, deterministic tree-diff,
// a 20-deep action sequence, and a model-generated screen-description trail.
// Web sibling of v2-mobile-tester's alternate-dfs-app-traversal.mjs: ref-based interaction instead of
// coordinate taps, backtrack is `navigate(url)` instead of tap-path replay +
// relaunch, journal adds url_before/url_after/console_errors/failed_requests.
// Prompts: prompts.mjs · identity/frontier/diff: stategraph.mjs
//   npm run drive [-- <target>]   MODE=login|signup   GLOBAL_STEPS, MEM…
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPlaywrightMcp, sleep } from './mcp.mjs';
import { screenSignature, controlsOf, diffTrees, detectNav, loadGraph, saveGraph, upsertNode, markTried, pushFrontier, popFrontier } from './stategraph.mjs';
import { reviewSystem, reviewMemory, reviewUser, bootstrapSystem, bootstrapUser } from './prompts.mjs';
import { findByLabel, isModal, handleModal, fillForms } from './interactions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2] || 'the-constella-app';
const MODEL = process.env.MODEL || 'google/gemini-3.5-flash';
const MODE = process.env.MODE || 'login';
const GLOBAL_STEPS = Number(process.env.GLOBAL_STEPS || 40);
const NAV_WAIT = Number(process.env.NAV_WAIT || 10000);
const MEM = Number(process.env.MEM || 20);            // how many recent actions / screens to feed
const GOAL = process.env.GOAL || 'Exercise every feature: visit every page, click every button, follow each flow, and report anything broken.';
const VIEWPORT = process.env.VIEWPORT || '1280x800';
// Primary nav: auto-detected at runtime (detectNav) so any site works out of the box.
// NAV_LABELS env, if set, is an explicit override.
const NAV_OVERRIDE = process.env.NAV_LABELS ? process.env.NAV_LABELS.split(',').map((s) => s.trim().toLowerCase()) : null;
let navLabels = NAV_OVERRIDE || [];

if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY (../../v2-mobile-tester/spike/.env)'); process.exit(1); }
const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(MODEL);
const reasoningOpts = MODEL.includes('gemini') ? { openrouter: { reasoning: { effort: 'minimal' } } } : {};

const inputsPath = join(HERE, 'inputs', `${TARGET}.json`);
const INPUTS = existsSync(inputsPath) ? JSON.parse(readFileSync(inputsPath, 'utf8')) : {};
if (!INPUTS.url) { console.error(`Need inputs/${TARGET}.json with a "url" field.`); process.exit(1); }
const START_URL = INPUTS.url;
const credLine = INPUTS.credentials
  ? `Test credentials — username: "${INPUTS.credentials.username}", password: "${INPUTS.credentials.password}".` : 'No credentials provided.';
const TEST_DATA = INPUTS.testData || {};
const ABOUT = INPUTS.about ? String(INPUTS.about).trim() : `No description provided for ${START_URL} — explore the UI to learn what it does and offers.`;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = process.env.RUN_DIR || join(HERE, 'runs', `${TARGET}__${stamp}`);
mkdirSync(join(RUN, 'screenshots'), { recursive: true });

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
  type: z.enum(['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy', 'network', 'console']),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-page issues'),
});
const REVIEW = z.object({
  screenName: z.string(),
  description: z.string().describe('one-line description of the CURRENT page for the trail'),
  visibleText: z.array(z.string()),
  leftApp: z.boolean(), loginGate: z.boolean(),
  flaws: z.array(FLAW),
});
const ACTION = z.object({
  kind: z.enum(['click', 'type']), label: z.string(),
  elementIndex: z.number().int().nullable(), ref: z.string().nullable(),
  text: z.string().nullable(), reason: z.string(),
});

// ---- journal / flaws / screenshots ----
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

let mcpc;
const recent = [];  // action sequence (we feed the last MEM)
const trail = [];   // model-generated screen descriptions (we feed the last MEM)

// ---- loop guard: rolling window of the last N state signatures ----
const HISTORY = Number(process.env.HISTORY || 10);
const ring = [];
function recordState(sig, label) { ring.push({ sig, label }); if (ring.length > HISTORY) ring.shift(); }
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
function handleChurn(fallbackLabel) {
  const churn = stuckSignal();
  if (!churn) return null;
  const win = ring.slice(-6);
  const freq = {}; for (const s of win) freq[s.label] = (freq[s.label] || 0) + 1;
  const culprits = [...new Set(win.map((s) => s.label))].filter((l) => freq[l] >= 2);
  const drop = culprits.length ? culprits : [fallbackLabel];
  const sigs = new Set(win.map((s) => s.sig));
  for (const s of sigs) for (const l of drop) markTried(g, s, l);
  console.log(`   ⟲ ${churn}: blacklisted [${drop.join(', ')}] across ${sigs.size} page(s) — backtracking`);
  saveGraph(STATE, g);
  return churn;
}

const pathnameOf = (url) => { try { const u = new URL(url); return u.pathname + (u.search || ''); } catch { return url || '/'; } };
const elemText = (els) => els.length ? els.map((e, i) => `[${i}] "${e.label}" (${e.role})`).join('\n') : '(no elements found)';

// element list + signature only — no screenshot. Cheap; used for signature checks.
async function peek() {
  const els = await mcpc.listElements();
  const url = mcpc.currentUrl();
  return { els, url, sig: screenSignature(pathnameOf(url), els) };
}

async function execute(a) {
  if (a.kind === 'type') await mcpc.typeText(a.ref, a.label, a.text || '');
  else await mcpc.click(a.ref, a.label);
  await sleep(700);
}

// Shared memory builder — EVERY caller that talks to the model (the main DFS review
// loop, and bootstrap below) gets the exact same context: what was just tried and
// whether it changed anything, the full recent action/screen trail, untried controls
// on this exact page, known flaws here, and every page name seen so far. Bootstrap
// used to skip all of this and call the model with nothing but the current page —
// which is why it could repeat an already-failed action turn after turn.
function buildMemory(sig, els, lastAction, diff, consoleErrorCount, failedReqs) {
  const triedHere = g.nodes[sig]?.tried || [];
  const untried = controlsOf(els, navLabels).filter((c) => !triedHere.includes(c.label)).map((c) => c.label);
  return reviewMemory({
    lastAction, diff, recent: recent.slice(-MEM), trail: trail.slice(-MEM), untried,
    knownFlaws: (flawsBySig[sig] || []).slice(-10),
    seen: [...new Set(Object.values(g.nodes).map((n) => n.name))],
    consoleErrors: consoleErrorCount, failedRequests: failedReqs,
  });
}

// The cause/effect review: TWO images (before + after) + tree-diff + sequence memory + deterministic console/network signal.
async function reviewScreen(before, after, lastAction, diff, consoleErrorCount, failedReqs) {
  const mem = buildMemory(after.sig, after.els, lastAction, diff, consoleErrorCount, failedReqs);
  const content = [{ type: 'text', text: reviewUser({ mem, elemText: elemText(after.els) }) }];
  if (before) {
    content.push({ type: 'text', text: 'IMAGE 1 — BEFORE the last action:' }, { type: 'image', image: `data:${before.img.mimeType};base64,${before.img.data}` });
    content.push({ type: 'text', text: 'IMAGE 2 — NOW (after the last action):' });
  }
  content.push({ type: 'image', image: `data:${after.img.mimeType};base64,${after.img.data}` });
  const { object } = await withRetry(() => generateObject({ model, schema: REVIEW, providerOptions: reasoningOpts,
    messages: [{ role: 'system', content: reviewSystem({ about: ABOUT, goal: GOAL, size: VIEWPORT }) }, { role: 'user', content }] }), 'review');
  return object;
}

// ---- bootstrap into the app (login or signup) ----
const FIELD_ROLE = /^(textbox|searchbox|combobox)$/;
const fieldish = (e) => FIELD_ROLE.test(e.role), loginish = (e) => /log\s*in|sign\s*in|continue/i.test(e.label);
const createish = (e) => /create account|sign ?up|get started/i.test(e.label);
const isLoginGate = (els) => els.filter(fieldish).length >= 2 && els.some(loginish);
// "in the app": either the override nav is all present, or the page has cleared the
// login gate and shows substantive content. Weaker signal than mobile's tab-bar
// check (no universal web convention to lean on) — tune via NAV_LABELS if needed.
const inApp = (els) => {
  if (NAV_OVERRIDE) { const L = els.map((e) => e.label.toLowerCase()); return NAV_OVERRIDE.every((t) => L.includes(t)); }
  return !isLoginGate(els) && els.length >= 5;
};

async function fillLogin(creds) {
  let els = await mcpc.listElements(); let f = els.filter(fieldish);
  if (f.length < 2) return false;
  const user = f.find((e) => /email|user/i.test(e.label)) || f[0];
  const pass = f.find((e) => /pass/i.test(e.label)) || f[1];
  await mcpc.typeText(user.ref, user.label, creds.username); await sleep(300);
  els = await mcpc.listElements(); f = els.filter(fieldish);
  const pass2 = f.find((e) => /pass/i.test(e.label)) || pass;
  await mcpc.typeText(pass2.ref, pass2.label, creds.password); await sleep(300);
  els = await mcpc.listElements(); const b = els.find(loginish);
  if (b) { await mcpc.click(b.ref, b.label); await sleep(1200); } return !!b;
}
async function pickAction(snap, lastAction, diff) {
  const memory = buildMemory(snap.sig, snap.els, lastAction, diff, snap.cErr, snap.cFail);
  const { object } = await withRetry(() => generateObject({ model, schema: ACTION, providerOptions: reasoningOpts,
    messages: [{ role: 'system', content: bootstrapSystem({ about: ABOUT, credLine, size: VIEWPORT }) },
      { role: 'user', content: bootstrapUser({ elemText: elemText(snap.els), memory }) }] }), 'bootstrap');
  if (object.elementIndex != null && snap.els[object.elementIndex]) { object.ref = snap.els[object.elementIndex].ref; object.label = snap.els[object.elementIndex].label; }
  return object;
}
// Bootstrap runs the SAME per-turn pipeline as the main DFS loop below (review →
// trail/graph/journal/flaw-recording → shared churn/blacklist → frontier growth) —
// the only real difference is how the NEXT action gets picked: the main loop pops a
// known frontier task, bootstrap asks the model (pickAction) because there's no
// predetermined task list telling it "the way out" of a login/crash/unknown page.
async function enterApp() {
  let bootPath = [];              // local click-path (mirrors currentClickPath) — resets on URL change
  let prevSnap = null, lastAction = null, lastLabel = null, lastActionObj = null;
  for (let b = 0; b < 16; b++) {
    const p = await peek();
    if (isModal(p.els)) { await handleModal(mcpc, p.els); continue; } // permission/cookie prompts during onboarding
    if (inApp(p.els)) return p;

    if (isLoginGate(p.els)) {
      if (MODE === 'signup') { const cta = p.els.find(createish); if (cta) { console.log('  ⮕ signup: Create account'); await mcpc.click(cta.ref, cta.label); await sleep(900); prevSnap = null; lastAction = lastLabel = null; continue; } }
      else if (INPUTS.credentials) { console.log('  ⮕ login'); await fillLogin(INPUTS.credentials); prevSnap = null; lastAction = lastLabel = null; continue; }
    }

    // ---- full analysis, identical to the main loop's per-step review ----
    const img = await mcpc.screenshotImage('boot');
    const snap = { ...p, img };
    const diff = prevSnap ? diffTrees(prevSnap.els, snap.els) : null;
    const cErr = await mcpc.consoleErrors();
    const cFail = await mcpc.failedRequests();
    snap.cErr = cErr; snap.cFail = cFail;
    const r = await reviewScreen(prevSnap, snap, lastAction, diff, cErr, cFail);
    trail.push({ name: r.screenName, desc: r.description });
    const node = upsertNode(g, snap.sig, r.screenName, snap.url);
    const newScreen = node.visits === 1;
    const shot = (newScreen || r.flaws.length || (diff && !diff.changed)) ? snap.img.file : null;
    journalStep({ step: 'boot', screen_before: prevSnap ? g.nodes[prevSnap.sig]?.name : undefined, screen: r.screenName,
      signature: snap.sig, url_before: prevSnap?.url || '', url_after: snap.url, new_url: prevSnap ? snap.url !== prevSnap.url : true,
      action: lastAction || '(load app)', description: r.description, changed: diff ? diff.changed : true,
      appeared: diff?.appeared, disappeared: diff?.disappeared, new_screen: newScreen, screenshot: shot,
      console_errors: cErr, failed_requests: cFail, crashed: r.leftApp, verdict: r.leftApp ? 'crashed' : (diff && !diff.changed ? 'no-effect' : 'ok') });
    console.log(`boot   [${r.screenName}] ${lastAction || '(load app)'} → ${!diff ? 'n/a' : diff.changed ? 'changed' : 'NO CHANGE'}${newScreen ? ' *NEW*' : ''}`);
    console.log('@@PROGRESS ' + JSON.stringify({ step: 'boot', screen: r.screenName, action: lastAction || '(load app)', changed: diff ? diff.changed : true, newScreen, flaws: r.flaws.length }));
    recordFlaws(r.flaws, r.screenName, shot, snap.sig);

    if (r.leftApp) {
      recordFlaws([{ type: 'crash', severity: 'high', summary: `left target site during bootstrap after '${lastAction}'`, detail: 'navigated to a different origin, or hit a browser network-error page' }], r.screenName, shot, snap.sig);
      await mcpc.navigateAndWait(START_URL, NAV_WAIT);
      prevSnap = null; lastAction = lastLabel = null; bootPath = []; saveGraph(STATE, g); continue;
    }

    if (lastLabel) recordState(snap.sig, lastLabel); // shared ring — same cycle detector the main loop uses
    if (prevSnap && snap.url !== prevSnap.url) bootPath = [];               // URL changed — path resets to (url, [])
    else if (diff?.changed && lastActionObj) bootPath.push(lastActionObj); // SPA state changed at the same URL — extend it

    // nav may only appear after onboarding/login — detect it the first time we see one.
    if (!NAV_OVERRIDE && !navLabels.length && newScreen) {
      const t = detectNav(snap.els);
      if (t.length) { navLabels = t; console.log(`   • nav detected: [${t.join(', ')}]`); }
    }
    pushFrontier(g, snap.sig, snap.url, bootPath, controlsOf(snap.els, navLabels)); // queue this page for later real exploration
    saveGraph(STATE, g);

    if (handleChurn(lastLabel)) { // blacklisted the churning control(s) — break the cycle with a fresh reload
      await mcpc.navigateAndWait(START_URL, NAV_WAIT);
      prevSnap = null; lastAction = lastLabel = null; bootPath = []; continue;
    }

    const a = await pickAction(snap, lastAction, diff); // benefits from the trail/flaws/graph just updated above
    console.log(`  bootstrap: ${a.kind} '${a.label}' — ${a.reason}`);
    await execute(a);
    lastAction = `${a.kind} '${a.label}'`; lastLabel = a.label; lastActionObj = { label: a.label, ref: a.ref };
    recent.push(`bootstrap: ${lastAction}`); // so the NEXT turn (or the main loop, via shared `recent`) sees this attempt
    prevSnap = snap;
  }
  return await peek();
}
const labelsOf = (p) => p.map((a) => a.label).join(' > ');

// Reach a target screen: navigate to its URL if we're elsewhere, then replay the
// short click-path recorded for any SPA state that isn't URL-distinct. Web's
// answer to mobile's tap-path-replay + relaunch — direct and much shorter.
// `force` reloads even when the URL string is already correct: for a single-URL
// SPA, "same URL" doesn't mean "same client state" — other actions (a filled
// form field echoed back as new content, an in-page toggle) can drift the live
// page away from a target's expected signature with no URL change at all, so
// checking currentUrl() alone can never trigger the reset that recovers it.
async function gotoReach(task, force = false) {
  if (force || mcpc.currentUrl() !== task.url) await mcpc.navigateAndWait(task.url, NAV_WAIT);
  for (const step of task.reach) {
    const hit = await findByLabel(mcpc, step.label);
    if (!hit) return false;
    await execute({ kind: 'click', ref: hit.ref, label: hit.label });
  }
  return true;
}

// ============================ MAIN ============================
mcpc = await connectPlaywrightMcp(join(RUN, 'screenshots'));
await mcpc.navigateAndWait(START_URL, NAV_WAIT);
console.log(`drive: ${MODEL} · mode=${MODE} · ${TARGET} (${START_URL})\n`);

let after = await enterApp();
let currentClickPath = [];
let step = 0;

if (!NAV_OVERRIDE) {
  navLabels = detectNav(after.els);
  console.log(navLabels.length ? `nav detected: [${navLabels.join(', ')}]` : 'no nav detected (single-surface app)');
}

// step 0 — review the entry screen (no "before")
{
  const shotImg = await mcpc.screenshotImage('entry');
  const withImg = { ...after, img: shotImg };
  const cErr = await mcpc.consoleErrors();
  const cFail = await mcpc.failedRequests();
  const r = await reviewScreen(null, withImg, null, null, cErr, cFail);
  trail.push({ name: r.screenName, desc: r.description });
  upsertNode(g, after.sig, r.screenName, after.url);
  journalStep({ step: 0, screen: r.screenName, signature: after.sig, url_before: '', url_after: after.url, new_url: true,
    action: '(load app)', description: r.description, new_screen: true, screenshot: shotImg.file,
    console_errors: cErr, failed_requests: cFail, verdict: 'ok' });
  console.log(`step 0  [${r.screenName}]  ${r.description}`);
  console.log('@@PROGRESS ' + JSON.stringify({ step: 0, screen: r.screenName, action: '(load app)', changed: true, newScreen: true, flaws: r.flaws.length }));
  recordFlaws(r.flaws, r.screenName, shotImg.file, after.sig);
  // seed: this screen's controls + the nav (once)
  const navEls = after.els.filter((e) => navLabels.includes(e.label.toLowerCase()));
  pushFrontier(g, after.sig, after.url, currentClickPath, [...controlsOf(after.els, navLabels), ...navEls]);
  saveGraph(STATE, g);
}

while (g.frontier.length && step < GLOBAL_STEPS) {
  const task = popFrontier(g);
  if (!task) break;

  if (mcpc.currentUrl() !== task.url || labelsOf(currentClickPath) !== labelsOf(task.reach)) {
    let ok = await gotoReach(task);
    if (ok) { const s = await peek(); ok = (s.sig === task.expectSig); }
    console.log(ok ? `  ↳ reach → [${task.url}${task.reach.length ? ' > ' + labelsOf(task.reach) : ''}]`
                    : `  ↩ reach drifted → [${task.url}]`);
    currentClickPath = task.reach.map((a) => ({ ...a }));
  }

  // verify-before-act: confirm the page actually matches what this task expects
  // before spending a step on it. First retry replays the reach as-is; if that
  // still doesn't match, force a hard reload (see gotoReach's `force` doc) before
  // giving up on the task.
  {
    let cur = await peek();
    if (cur.sig !== task.expectSig) {
      await gotoReach(task); cur = await peek();
      currentClickPath = task.reach.map((a) => ({ ...a }));
      if (cur.sig !== task.expectSig) {
        await gotoReach(task, true); cur = await peek();
        currentClickPath = task.reach.map((a) => ({ ...a }));
        if (cur.sig !== task.expectSig) {
          console.log(`   ✗ unreachable: '${task.action.label}' (page drift) — skipping`);
          markTried(g, task.expectSig, task.action.label); saveGraph(STATE, g); continue;
        }
      }
    }
  }

  const tgt = await findByLabel(mcpc, task.action.label);
  if (!tgt) {
    console.log(`   ✗ '${task.action.label}' not found on page — skipping`);
    markTried(g, task.expectSig, task.action.label); saveGraph(STATE, g); continue;
  }
  const beforeShot = await mcpc.screenshotImage(task.action.label);
  const before = { ...(await peek()), img: beforeShot };
  markTried(g, task.expectSig, task.action.label);
  const urlBefore = before.url;
  const lastAction = `click '${task.action.label}'`;
  await execute({ kind: 'click', ref: tgt.ref, label: tgt.label });
  recent.push(lastAction); step++;

  let afterPeek = await peek();
  if (isModal(afterPeek.els)) { const p = await handleModal(mcpc, afterPeek.els); console.log(`   • modal dismissed via '${p}'`); afterPeek = await peek(); }
  const afterShot = await mcpc.screenshotImage(task.action.label + '-after');
  after = { ...afterPeek, img: afterShot };
  const diff = diffTrees(before.els, after.els);
  recordState(after.sig, task.action.label);
  if (after.url !== urlBefore) currentClickPath = [];               // URL changed — reach resets to (url, [])
  else if (diff.changed) currentClickPath.push(task.action);        // SPA state changed at the same URL — extend the click-path
  const cErr = await mcpc.consoleErrors();
  const cFail = await mcpc.failedRequests();
  const r = await reviewScreen(before, after, lastAction, diff, cErr, cFail);
  trail.push({ name: r.screenName, desc: r.description });

  const node = upsertNode(g, after.sig, r.screenName, after.url);
  const newScreen = node.visits === 1;
  const shot = (newScreen || r.flaws.length || !diff.changed) ? after.img.file : null;
  journalStep({ step, branch: task.id, screen_before: g.nodes[task.expectSig]?.name, screen: r.screenName, signature: after.sig,
    url_before: urlBefore, url_after: after.url, new_url: after.url !== urlBefore,
    action: lastAction, description: r.description, changed: diff.changed, appeared: diff.appeared, disappeared: diff.disappeared,
    new_screen: newScreen, screenshot: shot, console_errors: cErr, failed_requests: cFail,
    crashed: r.leftApp, verdict: r.leftApp ? 'crashed' : (diff.changed ? 'ok' : 'no-effect') });
  console.log(`step ${step}  [${r.screenName}] ${lastAction} → ${diff.changed ? 'changed' : 'NO CHANGE'}${newScreen ? ' *NEW*' : ''}  (frontier ${g.frontier.length})`);
  console.log('@@PROGRESS ' + JSON.stringify({ step, screen: r.screenName, action: lastAction, changed: diff.changed, newScreen, flaws: r.flaws.length }));
  recordFlaws(r.flaws, r.screenName, shot, after.sig);

  if (r.leftApp) {
    recordFlaws([{ type: 'crash', severity: 'high', summary: `left target site after '${task.action.label}'`, detail: 'navigated to a different origin, or hit a browser network-error page' }], r.screenName, shot, task.expectSig);
    await mcpc.navigateAndWait(START_URL, NAV_WAIT); after = await enterApp(); currentClickPath = []; saveGraph(STATE, g); continue;
  }
  if (r.loginGate) { after = await enterApp(); currentClickPath = []; }

  // loop guard: recent actions are cycling/stalling → blacklist the churning
  // controls across the cycling pages and pop a different frontier branch.
  if (handleChurn(task.action.label)) continue;
  if (newScreen && !r.loginGate) {
    const n = await fillForms(mcpc, TEST_DATA);
    if (n) {
      console.log(`   • filled ${n} form field(s)`);
      // fillForms can mutate the live a11y tree (a typed value echoed as new
      // content, not just the field itself) — re-anchor `after`/the node's
      // identity to what's actually on screen now, so the frontier tasks we're
      // about to push are keyed to a signature we can still verify later
      // (verified live: pushing under the pre-fill signature made every task
      // for this screen permanently "unreachable").
      after = await peek();
      upsertNode(g, after.sig, r.screenName, after.url);
    }
  }
  // nav may only appear after onboarding/login — detect it the first time we see one.
  if (!NAV_OVERRIDE && !navLabels.length && newScreen) {
    const t = detectNav(after.els);
    if (t.length) {
      navLabels = t; console.log(`   • nav detected: [${t.join(', ')}]`);
      pushFrontier(g, after.sig, after.url, currentClickPath, after.els.filter((e) => navLabels.includes(e.label.toLowerCase())));
    }
  }
  const ctl = controlsOf(after.els, navLabels);
  pushFrontier(g, after.sig, after.url, currentClickPath, ctl);
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

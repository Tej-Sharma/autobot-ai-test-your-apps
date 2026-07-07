// ============================================================================
// core/explore.mjs — the shared single-brain explore loop. One model call per
// turn both judges the previous action's outcome AND picks the next action,
// with the full never-pruned memory trace fed back as working memory, the
// deterministic state-graph coverage map, and the flow tracker (whole completed
// user journeys, rules enforced in code).
//
// Everything platform-shaped goes through the DRIVER, injected by the platform
// entrypoint (mobile/explore.mjs, web/explore.mjs). Driver contract:
//   start()                → connect + launch/navigate; sets internal state
//   headerDesc()           → the `explore: MODEL · <desc>` suffix
//   promptSize()           → the SCREEN SIZE / VIEWPORT value for the prompt
//   observe(step)          → one turn's observation:
//       { img: {data, mimeType}, els, sig, chromeLabels, userText,
//         journalHead: {}, journalSignals: {}, recExtras: {}, upsertExtra }
//     (does its own modal dismissal + platform signal collection)
//   persistShot(obs, name) → journal-relative screenshot path for this turn
//   execute(action, els)   → perform nextAction (owns its own waits/retries)
//   recover()              → crash recovery (relaunch / navigate home)
//   crashMessage           → the exact console line to print on crash
//   actionStr(a)           → one-line action rendering for memory/journal
//   markableKinds          → action kinds that mark a control tried
//   graph: { upsertNode, controlsOf }  → platform node/control semantics
//   voc: { memHeader(t), mapped, noun, chromeNever, elsewhereHeader,
//          noElsewhere, nodeLine(n, untried), lastLabel, plural }
//   close()
//
// The loop body, artifact formats (journal/flaws/memory/flows JSONL), console
// output, and @@PROGRESS lines are byte-compatible with the two engines this
// replaces — the platform-specific bits arrive as driver values, spread into
// the same positions the old code wrote them.
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadGraph, saveGraph, markTried } from './stategraph.mjs';

export const credLineOf = (INPUTS) => INPUTS.credentials
  ? `Test credentials you may use to sign in — username: "${INPUTS.credentials.username}", password: "${INPUTS.credentials.password}".`
  : 'No credentials provided.';

const now = () => new Date().toISOString();
const untriedOf = (n) => (n.controls || []).filter((c) => !n.tried.includes(c));
const orDash = (a) => (a && a.length ? a.join('; ') : '—');

// ---- the never-pruned memory trace (pure renderer — parity-checked) ----
export function renderMemory(trace, voc) {
  if (!trace.length) return '(empty — this is your first turn)';
  return trace.map((t) => [
    voc.memHeader(t),
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

// ---- coverage ledger rendering (pure renderer — parity-checked) ----
export function renderCoverage({ g, sig, els, chromeSeen, chromeTried, flowsDone, controlsOf, voc }) {
  const hereTried = g.nodes[sig]?.tried || [];
  const hereUntried = controlsOf(els, [...chromeSeen]).map((c) => c.label).filter((l) => !hereTried.includes(l));
  const elsewhere = Object.values(g.nodes)
    .filter((n) => n.signature !== sig && untriedOf(n).length)
    .slice(0, 12)
    .map((n) => voc.nodeLine(n, untriedOf(n)));
  const chromeLeft = [...chromeSeen].filter((t) => !chromeTried.has(t));
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  return [
    `${voc.mapped} mapped: ${nodes.length} · controls exercised: ${tried}/${total || '?'}`,
    `Untried on THIS ${voc.noun}: ${hereUntried.join(', ') || 'none — everything here was exercised'}`,
    chromeLeft.length ? `${voc.chromeNever} ${chromeLeft.join(', ')}` : null,
    elsewhere.length ? `${voc.elsewhereHeader}\n${elsewhere.join('\n')}` : voc.noElsewhere,
    flowsDone.length ? `Flows already completed this run (do NOT re-declare these): ${flowsDone.map((f) => `"${f.name}" (steps ${f.startStep}–${f.endStep})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

// ============================ MAIN LOOP ============================
export async function runExplore({ driver, cfg }) {
  const { MODEL, GLOBAL_STEPS, GOAL, FOCUS, FLOW_MIN_STEPS, RUN, STATE, ABOUT, credLine,
    APP_INSTRUCTIONS, instrPath, exploreSystem, TURN } = cfg;
  const voc = driver.voc;

  const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(MODEL);
  const reasoningOpts = MODEL.includes('gemini') ? { openrouter: { reasoning: { effort: 'minimal' } } } : {};

  const JOURNAL = join(RUN, 'journal.jsonl'), FLAWS = join(RUN, 'flaws.jsonl'), MEMORY = join(RUN, 'memory.jsonl');
  const FLOWS_FILE = join(RUN, 'flows.jsonl'), ELEMENTS = join(RUN, 'elements.jsonl');
  // CLEAN SLATE every run: if this RUN_DIR is reused, wipe prior per-state data so journals,
  // memory trace, flaws, and screenshots never mix across runs.
  rmSync(join(RUN, 'screenshots'), { recursive: true, force: true });
  mkdirSync(join(RUN, 'screenshots'), { recursive: true });
  for (const f of [JOURNAL, FLAWS, MEMORY, FLOWS_FILE, ELEMENTS]) writeFileSync(f, '');

  // ---- io helpers ----
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

  // ---- coverage ledger: the deterministic state graph, maintained alongside the LLM ----
  // The model does its best judgement; the graph is ground truth for what exists and what
  // was actually exercised. Rendered into the prompt each turn and saved to disk every
  // step so a killed run still leaves a complete ledger.
  const g = loadGraph(STATE);
  const chromeSeen = new Set();   // lowercased tab-bar / global-nav labels ever detected
  const chromeTried = new Set();  // chrome labels the model actually opened

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

  const trace = [];

  await driver.start();
  console.log(`explore: ${MODEL} · ${driver.headerDesc()}\nabout: ${ABOUT}\napp-instructions: ${APP_INSTRUCTIONS ? `loaded (${instrPath})` : 'none'}\n`);

  for (let step = 0; step < GLOBAL_STEPS; step++) {
    const obs = await driver.observe(step);
    const els = obs.els;
    for (const cl of obs.chromeLabels) chromeSeen.add(cl);

    const { object: t } = await generateObject({
      model, schema: TURN, providerOptions: reasoningOpts,
      messages: [
        { role: 'system', content: exploreSystem({ about: ABOUT, size: driver.promptSize(), goal: GOAL, focus: FOCUS, credLine,
          memory: renderMemory(trace, voc),
          coverage: renderCoverage({ g, sig: obs.sig, els, chromeSeen, chromeTried, flowsDone, controlsOf: driver.graph.controlsOf, voc }),
          appInstructions: APP_INSTRUCTIONS }) },
        { role: 'user', content: [
          { type: 'text', text: obs.userText },
          { type: 'image', image: `data:${obs.img.mimeType};base64,${obs.img.data}` },
        ] },
      ],
    });

    // ledger: register this screen + its controls, and mark the chosen control tried.
    const node = driver.graph.upsertNode(g, obs.sig, t.screen, obs.upsertExtra);
    node.controls = [...new Set([...(node.controls || []), ...driver.graph.controlsOf(els, [...chromeSeen]).map((c) => c.label)])];
    {
      const el = (t.nextAction.elementIndex != null) ? els[t.nextAction.elementIndex] : null;
      const label = el?.label || t.nextAction.label;
      if (driver.markableKinds.includes(t.nextAction.kind) && label) {
        markTried(g, obs.sig, label);
        if (chromeSeen.has(String(label).toLowerCase())) chromeTried.add(String(label).toLowerCase());
      }
    }
    saveGraph(STATE, g);

    const flow = recordFlow(t.flowCompleted, step, t.screen);

    const shot = driver.persistShot(obs, t.screen);
    // per-screen element snapshot — the design pass, the critique pass (bbox
    // grounding), and future structured checks need each screenshot's element
    // list, which the journal drops. `space` is the coordinate space the els
    // live in (device points on mobile; absent when the driver has no coords).
    appendFileSync(ELEMENTS, JSON.stringify({ step, screenshot: shot, screen: t.screen, sig: obs.sig, space: obs.elSpace || null, els }) + '\n');
    recordFlaws(t.flaws, t.screen, shot);
    const aStr = driver.actionStr(t.nextAction);
    const rec = { step, time: now(), screen: t.screen, ...obs.recExtras, uiDone: t.uiDone, action: aStr, expectation: t.nextAction.expectation,
      expectationCheck: t.expectationCheck, reasoning: t.reasoning, goalsSoFar: t.goalsSoFar, goalsCompleted: t.goalsCompleted,
      areasRemaining: t.areasRemaining, flaws: t.flaws.map((f) => f.summary), crashed: t.crashed };
    trace.push(rec);
    appendFileSync(MEMORY, JSON.stringify(rec) + '\n');
    journalStep({ step, screen: t.screen, ...obs.journalHead, action: aStr, description: t.uiDone, expectation: t.nextAction.expectation,
      expectationCheck: t.expectationCheck, ...obs.journalSignals, crashed: t.crashed, screenshot: shot, done: t.done, ...(flow ? { flow: flow.id } : {}) });
    console.log(`step ${step}  [${t.screen}]  → ${aStr}\n   ${t.reasoning.slice(0, 100)}`);
    const covTotal = Object.values(g.nodes).reduce((s, n) => s + (n.controls || []).length, 0);
    const covTried = Object.values(g.nodes).reduce((s, n) => s + n.tried.length, 0);
    console.log('@@PROGRESS ' + JSON.stringify({ step, screen: t.screen, action: aStr, reasoning: t.reasoning.slice(0, 120),
      goalsCompleted: t.goalsCompleted.length, areasRemaining: t.areasRemaining.length, flaws: t.flaws.length, crashed: t.crashed, done: t.done,
      coverage: { tried: covTried, total: covTotal, screens: Object.keys(g.nodes).length }, ...(flow ? { flow: flow.name } : {}) }));

    if (t.crashed) { console.log(driver.crashMessage); await driver.recover(); continue; }
    if (t.done || t.nextAction.kind === 'stop') { console.log(`\nexplorer finished: ${t.uiDone}`); break; }
    await driver.execute(t.nextAction, els);
  }

  console.log('\n================ EXPLORE SUMMARY ================');
  const goals = [...new Set(trace.flatMap((t) => t.goalsCompleted || []))];
  console.log(`steps: ${trace.length}/${GLOBAL_STEPS}   flaws: ${flawN}   ${voc.lastLabel}: ${trace.slice(-1)[0]?.screen || '—'}`);
  console.log(`goals completed: ${goals.join(' · ') || 'none'}`);
  {
    const nodes = Object.values(g.nodes);
    const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
    const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
    const leftovers = nodes.filter((n) => untriedOf(n).length).map((n) => `${n.name} (${untriedOf(n).length})`);
    console.log(`coverage: ${tried}/${total} controls across ${nodes.length} ${voc.plural}${leftovers.length ? `   UNTRIED: ${leftovers.join(', ')}` : '   — frontier empty'}`);
    console.log(`flows completed: ${flowsDone.length ? flowsDone.map((f) => `"${f.name}" (${f.steps} steps)`).join(' · ') : 'none'}`);
  }
  console.log(`run: ${RUN}`);
  console.log('================================================');
  await driver.close();
}

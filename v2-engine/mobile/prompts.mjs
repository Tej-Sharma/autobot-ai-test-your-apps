// ============================================================================
// mobile/prompts.mjs — the iOS-shaped prompt layer. The exploration doctrine and
// the prompt skeletons live in core/prompts.mjs; this file supplies only the
// mobile-specific slot text (tap/swipe/speak action catalog, voice-input rules,
// iOS crash definition, screen wording). Slot values reproduce the old
// v2-mobile-tester/engine/prompts.mjs byte-for-byte — parity/check.mjs verifies.
// The legacy DFS driver's review/bootstrap prompts are kept verbatim below.
// ============================================================================
import { explorationDoctrine, makeExploreSystem, makeCritiqueSystem, makeCritiqueUser } from '../core/prompts.mjs';

export { explorationDoctrine };

// ---- LLM-DRIVEN EXPLORER (the single brain): judge + pick the next action every turn,
// with the FULL never-pruned memory trace fed back in as working memory. ----
export const exploreSystem = makeExploreSystem({
  noun: 'screen',
  coverageSource: 'the accessibility tree',
  currentIntro: `You are shown the CURRENT screen — one screenshot plus its ELEMENTS list (indexed). The screen
reflects the RESULT of your previous action, so first judge whether that action did what you
expected, then decide and emit your NEXT action.`,
  screenBullet: `- screen: a short, specific name for the CURRENT screen ("Workout summary: 0:00, 0 cal").`,
  uiDoneBullet: `- uiDone: what this screen shows / what you just accomplished or observed here.`,
  flawsBullet: `- flaws: anything broken/confusing/off you can SEE or INFER (report visible text/typos exactly;
  a toggle/switch/segmented control can flip WITHOUT changing page text — that is NOT a bug).`,
  crashedBullet: `- crashed: true if the screen is the iOS home screen or a different app.`,
  flowBullet: `- flowCompleted: null on almost every turn. Set it ONLY when you have JUST finished one whole
  user flow — a complete journey spanning a LARGE contiguous sequence of steps (never fewer
  than 5), e.g. "sign up start-to-finish and land on home", "start a workout, exercise, finish
  it, and verify it appears in history". Give the step it started at and the on-screen evidence
  proving completion. HARD RULES (violations are rejected): flows never overlap — the start
  must be strictly AFTER the previous flow's last step; you cannot declare a flow right after
  another by adding a step or two — each flow is its own whole fresh sequence; single
  interactions (tap a tab, toggle a switch) are steps, never flows.`,
  nextActionBullet: `- nextAction: kind = tap | type | swipe | back | relaunch | speak | stop. Give elementIndex
  (preferred) or x/y for tap/type, text for type, direction for swipe, and an 'expectation' of
  what it will do (you verify it next turn). Use 'back' to leave a dead end, 'relaunch' to reset
  when stuck, 'stop' when finished.`,
  extraSections: `
VOICE INPUT — only when a screen clearly expects it (a mic icon, "Hold to talk", "Start
conversation", a waveform, a dictation field): 1) find the entry point first; 2) verify the app
is ACTUALLY listening before you speak — look for "Listening…", an animated waveform, a glowing
mic, or "Speak now" in the CURRENT screenshot; never speak before that, the audio is discarded
and the test looks falsely broken; 3) use nextAction kind='speak' with text = the phrase to say
(plain, natural — e.g. "add a note about groceries"); 4) your NEXT turn's screenshot is the
reaction — verify a transcript / response / navigation actually happened. If a screen doesn't
mention voice, never use 'speak'. If you use 'speak' and the next screen shows no reaction at
all (no transcript, nothing changed), report a functional flaw: "audio loopback not configured
or app did not react to spoken input" — don't just retry it forever.
`,
  escapeVerb: 'back out',
  sizeLabel: 'SCREEN SIZE',
});

// ---- CRITIQUE pass: deep UX review of one saved screenshot ------------------
export const critiqueSystem = makeCritiqueSystem({ reviewer: 'mobile-UX', shot: 'iOS' });
export const critiqueUser = makeCritiqueUser({ noun: 'screen' });

// ============================================================================
// LEGACY prompts below — used only by alternate-dfs-app-traversal.mjs (the old
// deterministic DFS drive pass). Kept verbatim from the old engine; the shared
// doctrine above is the only piece they draw from core.
// ============================================================================

// ---- DRIVE / REVIEW (legacy frontier judge): describe the screen + judge the last action ----
export const reviewSystem = ({ about, size, goal }) => `
${explorationDoctrine({ about, goal })}

You are given TWO screenshots: IMAGE 1 = the screen BEFORE the last action, IMAGE 2 = the
screen NOW (after that action). The text "RESULT" tells you, deterministically, whether the
screen changed. Use all of this to reason about cause and effect.

Each turn you must:
1. Give a ONE-LINE description of the CURRENT screen (IMAGE 2) — this is appended to the
   exploration trail, so make it specific ("Workout summary: 0:00 time, 0 calories").
2. Report visible text EXACTLY (keep any typos / placeholder text — never correct them).
3. Flag flaws you can SEE or INFER from the before→after change. In particular:
   - a control that produced NO change when it clearly should have → a dead/inert control
     (functional flaw) — e.g. a "Pause"/"Start"/"Delete" button that did nothing. ONLY flag
     this for elements that are clearly meant to be interactive (buttons, links, list rows);
     do NOT flag static labels, titles, headers, or version strings as "inert".
     IMPORTANT: a toggle / switch / stepper / segmented control often flips WITHOUT changing
     the page text — so "screen UNCHANGED" does NOT mean it's broken. Compare the two IMAGES:
     if the control visibly changed state (a switch moved, a segment highlighted), it works.
   - a crash / unexpected return to the iOS home screen.
   - broken or empty states, wrong values, truncation, contrast, copy/layout issues.
4. Set leftApp if IMAGE 2 is the iOS home screen or a different app.
5. Set loginGate if IMAGE 2 is a login / sign-in screen.
6. For each flaw, also give a bbox: a tight box around the exact element (in IMAGE 2) the flaw
   is about, as FRACTIONS of the image width/height (0.0-1.0, x0<x1, y0<y1, origin top-left).
   Set bbox to null only when the flaw is about the whole screen, not one specific element.

SCREEN SIZE: ${size}`.trim();

export const reviewMemory = ({ lastAction, diff, recent, trail, untried, knownFlaws, seen }) => `
LAST ACTION: ${lastAction || '(none — this is the first screen)'}
RESULT: ${!diff ? 'n/a' : diff.changed
  ? `screen CHANGED  (appeared: [${diff.appeared.join(', ') || '—'}]  disappeared: [${diff.disappeared.join(', ') || '—'}])`
  : 'screen UNCHANGED — the last action had NO visible effect'}

ACTION SEQUENCE (this run, oldest → newest; the last line is the most recent action):
${recent.length ? recent.map((a, i) => `${i + 1}. ${a}`).join('\n') : '(none yet)'}

SCREEN TRAIL (recent screens, newest last):
${trail.length ? trail.map((t) => `• ${t.name} — ${t.desc}`).join('\n') : '(none yet)'}

Screens seen: ${seen.join(', ') || 'none'}.
Untried controls on THIS screen: ${untried.join(', ') || 'none'}.
Known flaws here (do NOT report again): ${knownFlaws.join(' | ') || 'none'}.`.trim();

export const reviewUser = ({ mem, elemText }) => `
${mem}

ELEMENTS on the current screen:
${elemText}

Describe the current screen, judge what the last action did, and flag any flaws.`.trim();

// ---- ACTION picker: used only to traverse a login/onboarding bootstrap -------
export const bootstrapSystem = ({ about, credLine, size }) => `
You are a QA tester getting an iOS app past its sign-up / onboarding / permission flow to reach
the main app, so you can test it in depth.

ABOUT THE APP (just to guide you):
${about}

${credLine}
Pick the SINGLE next action to advance toward the main app (type into a field, tap Continue,
grant a permission, pick an option). Head for the app's main features — don't get stuck poking
one control. PREFER an ELEMENTS index for exact coords. screen=${size}.`.trim();

export const bootstrapUser = ({ elemText, memory }) => `${memory ? memory + '\n\n' : ''}ELEMENTS:\n${elemText}\n\nPick the next action to advance. If your recent actions show you already tried something here (same label / same screen) with no effect, do NOT repeat it — pick a different element, or use 'back'/'relaunch'.`;

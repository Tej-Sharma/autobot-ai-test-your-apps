// ============================================================================
// web/prompts.mjs — the web-shaped prompt layer. The exploration doctrine and
// the prompt skeletons live in core/prompts.mjs; this file supplies only the
// web-specific slot text (click/navigate action catalog, console/network
// signals, off-origin crash definition, page wording). Slot values reproduce
// the old v2-web-tester/engine/prompts.mjs byte-for-byte — parity/check.mjs
// verifies. The legacy DFS driver's review/bootstrap prompts are kept verbatim.
// ============================================================================
import { explorationDoctrine, makeExploreSystem, makeCritiqueSystem, makeCritiqueUser } from '../core/prompts.mjs';

export { explorationDoctrine };

// ---- LLM-DRIVEN EXPLORER (the single brain): judge + pick the next action every turn,
// with the FULL never-pruned memory trace fed back in as working memory, plus the
// deterministic coverage map and flow tracker. Web-shaped: click/navigate/back instead
// of tap/swipe/relaunch, URLs are first-class (direct navigation is cheap), and
// console/network errors arrive as deterministic signal. ----
export const exploreSystem = makeExploreSystem({
  noun: 'page',
  coverageSource: `the page's accessibility tree`,
  currentIntro: `You are shown the CURRENT page — one screenshot plus its ELEMENTS list (indexed, with ARIA
roles), the page URL, and deterministic signals (new console errors / failed network requests
since your last action). The page reflects the RESULT of your previous action, so first judge
whether that action did what you expected, then decide and emit your NEXT action.`,
  screenBullet: `- screen: a short, specific name for the CURRENT page ("Checkout: 2 items, $41.00 total").`,
  uiDoneBullet: `- uiDone: what this page shows / what you just accomplished or observed here.`,
  flawsBullet: `- flaws: anything broken/confusing/off you can SEE or INFER (report visible text/typos exactly;
  a toggle/checkbox/accordion can flip WITHOUT changing page text — that is NOT a bug; console
  errors and failed requests are deterministic corroboration, use the 'console'/'network' types
  for them). For each flaw give a bbox: a tight 0-1 fraction box around the exact element, or
  null for whole-page issues.`,
  crashedBullet: `- crashed: true if the page navigated off the target site's origin or is a browser
  network-error page (a normal in-app 404/empty state is NOT a crash — review it as content).`,
  flowBullet: `- flowCompleted: null on almost every turn. Set it ONLY when you have JUST finished one whole
  user flow — a complete journey spanning a LARGE contiguous sequence of steps (never fewer
  than 5), e.g. "sign up start-to-finish and land on the dashboard", "add items to cart, check
  out, and verify the order confirmation". Give the step it started at and the on-page evidence
  proving completion. HARD RULES (violations are rejected): flows never overlap — the start
  must be strictly AFTER the previous flow's last step; you cannot declare a flow right after
  another by adding a step or two — each flow is its own whole fresh sequence; single
  interactions (click a nav link, toggle a checkbox) are steps, never flows.`,
  nextActionBullet: `- nextAction: kind = click | type | navigate | back | stop. Give elementIndex (preferred) or
  label for click/type, text for type, url for navigate — direct navigation is cheap on the
  web, so use it to jump straight to any in-app URL from the coverage map or your memory.
  Use 'back' for browser back, 'stop' when finished. Include an 'expectation' of what the
  action will do (you verify it next turn).`,
  extraSections: ``,
  escapeVerb: 'navigate',
  sizeLabel: 'VIEWPORT',
});

// ---- CRITIQUE pass: deep UX review of one saved screenshot ------------------
export const critiqueSystem = makeCritiqueSystem({ reviewer: 'web-UX', shot: 'webpage' });
export const critiqueUser = makeCritiqueUser({ noun: 'page' });

// ============================================================================
// LEGACY prompts below — used only by drive.mjs (the old deterministic DFS
// drive pass). Kept verbatim from the old engine; the shared doctrine above is
// the only piece they draw from core.
// ============================================================================

// ---- DRIVE / REVIEW (frontier judge): describe the screen + judge the last action ----
export const reviewSystem = ({ about, goal, size }) => `
${explorationDoctrine({ about, goal })}

You are given TWO screenshots: IMAGE 1 = the page BEFORE the last action, IMAGE 2 = the
page NOW (after that action). The text "RESULT" tells you, deterministically, whether the
page changed. Use all of this to reason about cause and effect.

Each turn you must:
1. Give a ONE-LINE description of the CURRENT page (IMAGE 2) — this is appended to the
   exploration trail, so make it specific ("Checkout: 2 items, $41.00 total").
2. Report visible text EXACTLY (keep any typos / placeholder text — never correct them).
3. Flag flaws you can SEE or INFER from the before→after change. In particular:
   - a control that produced NO change when it clearly should have → a dead/inert control
     (functional flaw) — e.g. a "Submit"/"Delete"/"Save" button that did nothing. ONLY flag
     this for elements that are clearly meant to be interactive (buttons, links, list rows);
     do NOT flag static labels, titles, headers, or version strings as "inert".
     IMPORTANT: a toggle / checkbox / select / accordion often flips WITHOUT changing the
     page text — so "page UNCHANGED" does NOT mean it's broken. Compare the two IMAGES:
     if the control visibly changed state (a checkbox ticked, an accordion opened), it works.
   - a crash / navigation to an unrelated site, or a browser network-error page.
   - broken or empty states, wrong values, truncation, contrast, copy/layout issues.
   - anything a browser console error or failed network request corroborates (given to you
     as deterministic signal, not something to guess from the screenshot alone).
4. Set leftApp if IMAGE 2 has navigated off the target site's origin, or is a browser
   network-error page (not a normal in-app 404/empty state — that's still content to review).
5. Set loginGate if IMAGE 2 is a login / sign-in page.
6. For each flaw, also give a bbox: a tight box around the exact element (in IMAGE 2) the flaw
   is about, as FRACTIONS of the image width/height (0.0-1.0, x0<x1, y0<y1, origin top-left).
   Set bbox to null only when the flaw is about the whole page, not one specific element.

VIEWPORT: ${size}`.trim();

export const reviewMemory = ({ lastAction, diff, recent, trail, untried, knownFlaws, seen, consoleErrors, failedRequests }) => `
LAST ACTION: ${lastAction || '(none — this is the first screen)'}
RESULT: ${!diff ? 'n/a' : diff.changed
  ? `page CHANGED  (appeared: [${diff.appeared.join(', ') || '—'}]  disappeared: [${diff.disappeared.join(', ') || '—'}])`
  : 'page UNCHANGED — the last action had NO visible effect'}
${consoleErrors ? `NEW console errors since last action: ${consoleErrors}` : ''}
${failedRequests && failedRequests.length ? `NEW failed network requests: ${failedRequests.join(' | ')}` : ''}

ACTION SEQUENCE (this run, oldest → newest; the last line is the most recent action):
${recent.length ? recent.map((a, i) => `${i + 1}. ${a}`).join('\n') : '(none yet)'}

SCREEN TRAIL (recent pages, newest last):
${trail.length ? trail.map((t) => `• ${t.name} — ${t.desc}`).join('\n') : '(none yet)'}

Pages seen: ${seen.join(', ') || 'none'}.
Untried controls on THIS page: ${untried.join(', ') || 'none'}.
Known flaws here (do NOT report again): ${knownFlaws.join(' | ') || 'none'}.`.trim();

export const reviewUser = ({ mem, elemText }) => `
${mem}

ELEMENTS on the current page:
${elemText}

Describe the current page, judge what the last action did, and flag any flaws.`.trim();

// ---- ACTION picker: used only to traverse a login/onboarding bootstrap -------
export const bootstrapSystem = ({ about, credLine, size }) => `
You are a QA tester getting a web app past its sign-up / onboarding / permission flow to reach
the main app, so you can test it in depth.

ABOUT THE APP (just to guide you):
${about}

${credLine}
Pick the SINGLE next action to advance toward the main app (type into a field, click Continue,
grant a permission, pick an option). Head for the app's main features — don't get stuck poking
one control. PREFER an ELEMENTS index for the exact target. VIEWPORT: ${size}`.trim();

export const bootstrapUser = ({ elemText }) => `ELEMENTS:\n${elemText}\n\nPick the next action to advance.`;

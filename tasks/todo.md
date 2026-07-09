# autobot — v1 todo

## v1 — done

- [x] Scaffold project structure (`bin/`, `src/lib/`, `src/templates/`, `tasks/`)
- [x] Write README + project CLAUDE.md
- [x] `src/lib/sim.sh` — simctl wrappers (ensure/boot/install/launch/screenshot)
- [x] `src/lib/build.sh` — xcodebuild wrappers
- [x] `src/lib/claude.sh` — spawn `claude --print` with mobile-mcp config
- [x] `src/templates/critique-rubric.md` — UX rubric
- [x] `src/templates/discover-prompt.md` — first-time discovery system prompt
- [x] `src/templates/run-prompt.md` — drive + critique + report system prompt
- [x] `src/templates/app-CLAUDE.md` — template for target's `.autobot/CLAUDE.md`
- [x] `bin/autobot` CLI with `init`, `run`, `doctor`

## v1 — next (smoke test the CLI end-to-end)

- [ ] Pick a guinea-pig iOS app (open-source preferred — e.g. Wikipedia iOS, ProtonMail iOS, or a minimal SwiftUI sample app)
- [ ] Run `autobot doctor` — fix any missing deps
- [ ] Run `autobot init <app>` and watch Claude explore
- [ ] Inspect `.autobot/CLAUDE.md` — does the discovery output look useful?
- [ ] Refine the discovery prompt based on first-run output
- [ ] Run `autobot run` and inspect `report.html`
- [ ] Refine the run prompt + rubric based on first-run output

## v1 — known gaps (acceptable for v1)

- No flow drift auto-healing — drift is just logged, not fixed
- No parallel flow execution — flows run serially
- Critique re-reads every PNG; could batch
- No CI integration — local-only
- mobile-mcp installed lazily via `npx -y`; first run is slow

## v2 — candidates

- [ ] GitHub Actions on macos-14 runner (notes in `CLAUDE.md`)
- [ ] `.ipa` + real device support (provisioning, install via `ideviceinstaller` or `xcrun devicectl`)
- [ ] `autobot heal` subcommand — propose flow CLAUDE.md edits when UI drifts
- [ ] Baseline comparison (`autobot run --vs main`)
- [ ] Parallel flows (one sim per flow)
- [ ] Slack/PR-comment integration

## Review

After first smoke-test run, fill in:
- What worked
- What surprised us
- What to change before showing the client

## Manual Hirello web QA pass (2026-07-08)

Spec: manually run `https://www.hirello.ai/` using the v2 web-driver logic without
invoking the driver: observe current page, inspect accessible controls, capture
screenshots, note console/network signals where available, choose exploratory actions,
stop at the first major bug/UI error, and save both raw and annotated evidence under
`output/playwright/`.

- [x] Review v2 web observe/action/flaw rules
- [x] Open Hirello and capture the landing page state
- [x] Explore primary user paths until the first major bug/UI error
- [x] Save raw screenshot evidence
- [x] Annotate the bug screenshot
- [x] Record findings and artifact paths

### Review

- Found first major functional/content bug in the landing-page footer Contact section.
- Visible email text: `firstcontact@hirello.com`.
- Actual link href: `mailto: hello@plateform.com`.
- Impact: clicking the displayed contact email opens a composer to the wrong address,
  and the target domain appears misspelled.
- Raw screenshot:
  `output/playwright/hirello-manual/screenshots/hirello-contact-email-bug-raw.png`
- Annotated screenshot:
  `output/playwright/hirello-manual/annotated/hirello-contact-email-bug-annotated.png`
- Browser signals: Hirello loaded with 0 console errors and 6 warnings.

## Manual product-site QA pass from founding designers CSV (2026-07-08)

Spec: process `/Users/tejas1/Downloads/design-qa-teams-founding-designers-2026-07-08.csv`
one person at a time. For each row, visit the company/product website, follow the
v2 web-driver observe-act-record logic manually in Codex/Playwright, use the provided
test credentials only when a product login/signup blocks meaningful exploration, stop
at the first major bug/UI error, save raw and annotated screenshots under
`output/playwright/founding-designers-2026-07-08/`, and write a consolidated report.

- [x] Parse the CSV and normalize product URLs
- [x] Create the run folder and report files
- [x] QA each unique product site one by one
- [x] Map duplicate people to already-tested product evidence
- [x] Verify annotated screenshots and report paths
- [x] Record review summary

### Review

- Processed 17 people from the CSV, covering 15 unique product URLs.
- Accepted 4 major user-visible bugs with annotated evidence:
  Warmstealth HTTPS certificate failure, Musubi dead demo CTA + giant blank gap,
  Tempo giant blank page gap, and MoolAI blank/placeholder page sections.
- Duplicate Claimbrite rows were mapped to the same tested product evidence.
- Used the provided email/password for MeritFirst candidate signup; the flow reached
  an email-verification gate, so I could not continue without mailbox access.
- Wrote consolidated outputs:
  `output/playwright/founding-designers-2026-07-08/report.md` and
  `output/playwright/founding-designers-2026-07-08/report.csv`.

## LinkedIn DM draft prep from product QA findings (2026-07-08)

Spec: use the CSV LinkedIn profile URLs and accepted QA findings to prepare
review-only LinkedIn DM copy. Only draft outreach for rows with real accepted major
bugs; mark rows with no major bug as skipped instead of inventing findings. If using
Dia/LinkedIn UI, do not send messages; stop at reviewable drafts/tabs.

- [x] Generate per-person message copy
- [x] Save review artifact with one tab/section per person
- [x] Use Dia browser via screen control for review-only LinkedIn tabs/drafts
- [x] Stop before any send action

### Review

- Drafted outreach only for the 4 contacts with accepted major bugs; skipped rows
  where the QA pass found no major issue.
- Saved review artifacts:
  `output/playwright/founding-designers-2026-07-08/linkedin-dm-drafts.md`,
  `output/playwright/founding-designers-2026-07-08/linkedin-dm-drafts.csv`,
  `output/playwright/founding-designers-2026-07-08/linkedin-dm-drafts.json`, and
  `output/playwright/founding-designers-2026-07-08/linkedin-dm-drafts-tabs.html`.
- Opened the 4 LinkedIn profile tabs in Dia and confirmed the account is logged in.
- Did not send any messages. I stopped before creating in-LinkedIn drafts because
  the Dia/LinkedIn profile menu hit-testing selected adjacent actions while trying
  to choose `Message`; status captured in
  `output/playwright/founding-designers-2026-07-08/linkedin-dm-dia-status.md`.

## Manual Eli web QA pass (2026-07-08)

Spec: manually run `https://www.eli.build/` using the v2 web-driver logic without
invoking the driver: observe URL, controls, screenshots, console/network signals,
choose exploratory actions from the current page, stop at the first major bug or UI
error, then save raw and annotated screenshot evidence under `output/playwright/`.

- [x] Review v2 web observe/action/flaw rules
- [x] Open Eli and capture the landing page state
- [x] Explore primary user paths until the first major bug/UI error
- [x] Save raw screenshot evidence
- [x] Annotate the bug screenshot
- [x] Record findings and artifact paths

### Review

- Found first conversion-path issue in the `Get in touch` HubSpot form.
- Repro: open `https://www.eli.build/`, click `Get in touch`, fill required fields
  with `test@example.com` for email, choose `Other`, then submit.
- Result: form rejects the syntactically valid email with
  `Please enter a valid email address`; the submit request returns HTTP 400.
- Raw screenshot:
  `output/playwright/eli-contact-submitted-locator.png`
- Annotated screenshot:
  `output/playwright/eli-contact-submitted-annotated.png`
- Extra signals checked before stopping: landing, Contractors, Programs, Capital
  Partners, Company, Blog, newest Blog article, Careers, and Login loaded without a
  major visible error. Capital Partners/mobile emitted a non-blocking document-policy
  console error for `js-profiling`.

## v2 drive engine — backlog (Tier 3: #11, #14)
- [ ] **Discovery pass** (#11): before driving, auto-propose the app's key flows and
      auto-write `v2-mobile-tester/engine/inputs/<bundle>.json` (credentials + test data +
      flow notes), instead of hand-authoring it. Could reuse the drive model to do a short
      reconnaissance launch and emit the inputs file.
- [ ] **Verdict + baseline diff** (#14): at run end, roll up flaws by severity and emit a
      PASS/FAIL verdict against a threshold (e.g. fail on any high) for CI gating. Plus a
      baseline-diff mode: save the main-branch run's flaws as a baseline, then on a new run
      report only NEW flaws (regressions) + which prior ones are now fixed — so CI flags
      regressions, not the whole standing backlog.
- [ ] **Audio / voice-input** (v2): see `v2-mobile-tester/engine/AUDIO.md` — bring in v1's
      bug-fixed audio (BlackHole Multi-Output / SIGABRT fix, meeting-safe save+restore) via a
      `speak` action that shells out to `autobot speak`. Knowledge captured; logic not built.

## Desktop app deployment & signing (2026-07-02) — DONE

Mirrored the Constella desktop-electron-app release setup in `v2-mobile-tester/app`:

- [x] Packager: kept electron-builder (still the right tool in 2026 for dmg+zip +
      Developer ID + notarytool + S3/electron-updater), upgraded 25 → ^26
- [x] Signing: Developer ID Application: Beemo AI Inc (86SK3K6AM6), hardened runtime,
      `resources/entitlements.mac.plist` (JIT, library-validation off for native modules,
      mic/audio-input for the BlackHole pipeline, network, user-files)
- [x] Notarization: `mac.notarize: true` (v26 style — env-var driven, no afterSign hook)
- [x] App icon: `resources/icon.icns` + `icon.png` rendered at 1024px from the autobot
      logo SVG (landing page `public/favicon.svg`, same mark as the sidebar icon)
- [x] Publish: S3 `aicc-bucket` (us-east-2) path `autobot/publish` (Constella pattern,
      autobot slug); electron-updater wired in main process (checks on launch, packaged only)
- [x] Creds: `v2-mobile-tester/app/env_vars.sh` (gitignored) — Apple ID + AWS keys
- [x] Verified: full `npm run package` build — codesign valid, spctl "Notarized Developer
      ID accepted", stapler validated, app boots and quits cleanly

Ship a release: `cd v2-mobile-tester/app && source env_vars.sh && npm run release`
(bump `version` in package.json first; updater 404s on latest-mac.yml until first publish)

## AI key routing + monetization scaffolding (2026-07-03)

- [x] Hosted relay live: `fastfind.app/autobot-relay/api/v1` (Constella backend, blue/green
      deployed). Passthrough to OpenRouter, streams, gzip-safe.
- [x] Global Settings in sidebar (gear at bottom) — separate from per-app settings. BYOK
      field: user's `sk-or-…` key rides through the relay upstream, unmetered.
- [x] Key priority (app/src/main/openrouter.js): user Settings key → dev spike/.env key
      (direct) → relay secret (our key).
- [x] Mongo `autobot_subscriptions` (backend db/models/constella/autobot_subscription.py):
      free grant AUTOBOT_FREE_CREDITS (default 300 model calls), atomic consume, Stripe
      apply helper ready.
- [x] Credit enforcement in relay behind AUTOBOT_ENFORCE_CREDITS env (OFF in prod until
      login ships). 402 markers: AUTOBOT_CREDITS_EXHAUSTED / AUTOBOT_LOGIN_REQUIRED.
- [x] Out-of-credits amber alert on the run card → "Open Settings" (runner.js detects the
      402 marker in engine output).
- [ ] Login via autobot-landing-page (autobot.sh, Next.js/Vercel — no auth exists yet) +
      desktop handoff; then x-autobot-user header from runner, flip enforcement on.
- [ ] Stripe checkout + webhook → AutobotSubscription.apply_stripe_subscription. Needs
      pricing decision.

## BBox annotation/display bug investigation (2026-07-09)

Spec: determine whether the invisible/misaligned flaw annotation bug from the pasted
context is fixed in the current tree by tracing the complete path from test execution
and flaw bbox generation, through annotation drawing, to report/desktop display.

- [x] Identify the bug signature and intended fix from pasted context
- [x] Trace bbox generation during explore/critique for mobile and web
- [x] Trace annotation drawing and bbox sanitization
- [x] Trace report/app display of annotated screenshots
- [x] Run focused verification for module imports/tests and any existing run artifacts
- [x] Record review conclusion and remaining risk

### Review

- The core invisible-annotation bug is fixed for critique output and for draw-time
  recovery. `core/bbox.mjs` now centralizes element grounding, style-sweep web
  grounding, pixel/fraction bbox sanitization, and PNG dimension reads.
- Critique now grounds mobile flaws from `elements.jsonl`; when mobile a11y boxes
  are absent, web critique falls back to `styles/<shot>.json` and normalizes those
  real page-pixel boxes against the PNG size. Freehand bboxes are sanitized before
  being persisted.
- Annotate now sanitizes every source bbox against the actual image metadata before
  drawing, so old critique artifacts with pixel coordinates can be re-annotated
  without re-running the model.
- Desktop display is wired: `buildReportData()` attaches
  `screenshots/annotated/<id>.png` when it exists, `RunBlock` opens/reveals
  `flaw.annotated || flaw.screenshot`, and fix prompts prefer the annotated path.
- Static `report.html` is not wired to annotated images; both mobile and web static
  reports still render the raw screenshot thumbnail. The desktop "View bug" path is
  fixed, but static HTML will still look unannotated unless report rendering is
  updated separately.
- Existing artifacts support the diagnosis: older web critique output still contains
  pixel bboxes, while annotate generated overlays for those flaws after the draw-time
  sanitizer was added.
- Verification run: bbox helper assertions passed, core modules imported, and a
  synthetic pixel-coordinate bbox produced a visible annotated PNG with 2056 red-ish
  overlay pixels. `npm run parity` still fails with the existing 35 prompt/schema
  mismatches (`elementIndex` schema + prompt prose), matching the pasted note.
- Remaining gap: web explore-time flaws still do not get style-sweep grounding in
  `core/explore.mjs`; they rely on sanitized freehand bboxes because only mobile
  supplies `obs.elSpace`. Critique + annotate cover the main reported issue, but
  explore-only web flaws can still lack an annotation if their freehand bbox is
  rejected.

## Unified v2 engine tree (2026-07-03)

Goal: one `v2-engine/` tree — shared core (loop/prompts/critique/annotate/graph ops) +
platform "hands" (mobile/web drivers, mcp, interactions) — with byte-identical prompts,
schemas, and artifacts vs. the two old engines, provable via a parity harness.

- [x] Scaffold `v2-engine/` (package.json union deps, .gitignore)
- [x] `core/`: prompts skeleton+doctrine, schema builder, shared graph ops,
      runExplore loop, critiqueRun, annotateRun
- [x] `mobile/`: driver + entry stubs + platform prompts/stategraph + verbatim
      copies (mcp, interactions, report, legacy DFS, rubric, inputs, instructions)
- [x] `web/`: same shape
- [x] Parity harness: old-vs-new byte-diff of every prompt export, structural diff
      of TURN/FLAW schemas, renderer goldens — all green
- [x] Electron app: engineDir/spikeEnvPath → v2-engine/<platform>, electron-builder
      extraResources → one engine tree (userData layout unchanged!)
- [x] npm install + node --check all files + web smoke run (smoke-example, 2 steps)
- [x] Old engine dirs left untouched as reference (untracked — they are the backup)

### Review (done 2026-07-03)
- `v2-engine/` built: core (explore loop, prompts skeleton+doctrine, schemas,
  graph ops, critique, annotate) + mobile/ + web/ (drivers, slot prompts,
  schemas, verbatim mcp/interactions/report/legacy/rubric).
- Parity: 117/117 checks green (prompts byte-identical over 65-combo fixture
  grid, schemas structurally identical, renderers + stategraph identical).
- Live smoke: web full pipeline (explore→critique→annotate→report) on
  smoke-example ✓; mobile explore on booted sim ✓ (loop/model/artifacts fine;
  osascript keystroke blocked by session Accessibility permission — code is
  verbatim-old, works from user terminal/app).
- Journal key order verified identical to real old-engine runs (both platforms).
- App: engineDir(platform)→v2-engine/<platform>, spikeEnvPath fixed,
  electron-builder ships ONE engine/ tree; unsigned --dir build audited clean
  (no inputs, no parity, no logs). userData layout untouched (old runs survive).
- NOT copied: old dev runs/ history (old dirs remain on disk as frozen backup).

## Figma design-QA pass (2026-07-06) — PLAN

Spec: `docs/figma-design-qa.md` (research synthesis + architecture) and
`docs/figma-visual-difference.md` (screen↔frame mapping). Pipeline becomes
`explore → critique → design (NEW, gated) → annotate`. The judge is the same
OpenRouter `generateObject` path critique uses (`DESIGN_MODEL` env, default
`anthropic/claude-sonnet-4.5`; `claude-haiku-4-5` ≈ 1/3 cost). No local models,
no Figma MCP — plain REST with a user PAT. New files only, except two small
touches (explore artifact + runner spawn), so the parity grid stays green.

### Phase 0 — plumbing & gate — DONE (2026-07-06)

- [x] Global Settings: "Figma personal access token" field (stored in the same
      globalSettings JSON blob as the OpenRouter key; `GlobalSettings.jsx`)
- [x] `runner.js`: read `figmaUrl` from app config; `FIGMA_URL` + `FIGMA_TOKEN`
      + `FIGMA_CACHE_DIR` (userData figma-cache) in `baseEnv`
- [x] `runner.js`: gated `design.mjs` spawn between critique and annotate;
      token missing → loud skip line; best-effort try/catch (cancel still
      aborts); progress forwarded as phase `design`
- [x] `design.mjs` self-gate: exits 0 with a skip line when `FIGMA_URL` unset
      (verified: exit 0 no-op; missing-token → clear error, exit 1)

### Phase 1 — manifest + mapping + VLM judge — DONE (2026-07-06)

- [x] `core/explore.mjs`: `elements.jsonl` per step `{step, screenshot, screen,
      sig, els}` (clean-slate list included) — parity 117/117 green; verified
      in a live 2-step web smoke run
- [x] `core/figma.mjs`: URL parse (file/design/proto/board + node-id scope),
      version probe → **cache by file version** (hit = 1 API call total),
      frames via depth=3 (+SECTION descend) or scoped /nodes, per-frame
      normalized element JSON (frame-relative box, fills→hex, text+style,
      auto-layout gap/pad, radius, componentId), batched /images PNG downloads,
      pseudo-palette, 429 Retry-After backoff + explicit Starter-plan-file
      error, 403/404 with actionable messages
- [x] `core/design.mjs`: Stage A (TF-IDF asymmetric containment, digit→`#`,
      font-size weighting + box-LCS layout score when geometry exists;
      τ_hi 0.6 / margin 0.15 / τ_lo 0.3; text-sparse screens go to tie-break) →
      vision tie-break (top-3 candidates) → Stage C judge (screenshot + frame
      PNG + element-spec JSON + acceptable-differences rules); outputs
      `design-map.json` + `design-diffs.jsonl` (critique-style normalized bbox)
      + `design/` frame copies; `DESIGN_MODEL` env (default sonnet-4.5)
- [x] `mobile/design.mjs` + `web/design.mjs` entrypoints; npm scripts
      `design:mobile|web`; `test-app:*` now include the (self-gating) pass
- [x] `core/annotate.mjs` draws design-diff bboxes (D-xxx overlays);
      report.mjs (both platforms) "Design fidelity" section: design|impl
      side-by-side, expected→actual, coverage gaps both directions; app
      `report.js` merges design diffs (src `design`) + design summary;
      `RunBlock.jsx` phase label + progress lines
- [x] E2E verified with a faked Figma REST API + REAL model calls: 2 synthetic
      screens vs 3 frames → both mapped deterministically (no tie-break
      needed), planted red-vs-blue button caught citing the node JSON hex
      (`expected #2563eb`), Onboarding reported designed-but-never-reached,
      cache-hit rerun made exactly 1 Figma call, annotate overlays
      pixel-accurate, report section renders. App `npm run build` green.
- [ ] Live verification with a real Figma file + PAT via the desktop app
      (needs the user's token — everything up to the real API is covered)

Plan deviations (deliberate): no cross-run `design_ref` cache — v2's state
graph is per-run and Stage A is free; the manifest cache is where the money
is. Variant grouping folded into the tie-break path (same call, less code).
Judge prompt hardened against runtime-data noise ("numeric value differences
are runtime data").

### Phase 2 — web structured diff (Stage B) — DONE (2026-07-07)

- [x] `web/mcp.mjs` `styleSweep()`: one `browser_evaluate` per step — visible
      elements (shadow-root recursion, 500 cap) → `{tag, text, bbox (doc
      coords), ~19 computed props}`; graceful null when the tool is absent;
      "### Result"-scoped JSON parsing. `web/driver.mjs` writes
      `styles/<shot>.json` paired 1:1 with each screenshot (best-effort)
- [x] `core/evidence.mjs` `webEvidence()`: unique-text anchor matching →
      per-pair diffs (text color ΔE>8, font-size ±1.5px, weight ±100, family
      loose-match, line-height ±2px) + button/container resolution (smallest
      design fill enclosing the text ↔ smallest rendered bg enclosing the row:
      background ΔE + radius ±1.5px) + off-palette sweep (rendered colors used
      3+ times vs the manifest pseudo-palette, no matching needed) + missing
      design-text detection
- [x] Evidence lines injected into the judge call as MEASURED EVIDENCE; judge
      instructed to carry the exact values and drop runtime-data lines;
      per-screen evidence persisted in `design-map.json`

### Phase 3 — mobile structured diff — DONE (2026-07-07)

- [x] `core/evidence.mjs` `mobileEvidence()` from `elements.jsonl`: unique-text
      anchors, missing design text, position drift on anchored text (relative
      coords absorb device-size mismatch, reported in pt), sub-44pt touch
      targets, and pixel-sampled control colors — `sharp` crop at the a11y rect
      (scale recovered from the element envelope), modal quantized color vs the
      design container fill, flagged `[pixel-sampled]` so the judge verifies
      against the images
- [x] Branch selection is data-driven in `core/design.mjs`: `styles/<shot>.json`
      present → web evidence; els carry boxes → mobile evidence; neither →
      Phase-1 behavior (images + spec only). Evidence failures never block the
      judge.
- [x] Verified: webEvidence unit-tested (6 diff types incl. off-palette, all
      exact-value lines); full e2e with faked Figma + real judge — Home took
      the mobile branch (sampled `~#e11c48` vs `#2563eb` ΔE 110, 30×30pt touch
      target flagged), Settings took the web branch (`font-size 14px` vs 16px,
      `#e11d48` vs `#111827`), judge carried the exact values into diffs; live
      example.com run wrote real `styles/*.json` via browser_evaluate; parity
      117/117 both before and after
- [ ] Deferred (unchanged): Apple `performAccessibilityAudit` bolt-on (needs a
      WDA execute path mobile-mcp lacks), Flutter thin-tree OCR fallback (Apple
      Vision shim), dark-mode/Dynamic-Type variant sweep, pHash skip-unchanged
      rerun optimization, full geometry-assignment matching beyond text anchors
      (Hungarian/consensus — text anchors + container resolution cover the
      high-precision cases; revisit if real runs show gaps)

### Phase independence + incremental report (2026-07-07) — DONE

- [x] `runner.js`: explore is the only fatal phase; critique / design / annotate
      are independent best-effort passes (each in its own try/catch via
      `tryPhase`) — one failing pass records a per-phase error and the rest
      still run. `run:done` carries `phaseErrors` + `creditsExhausted` even on
      ok runs. Cancellation still aborts everything.
- [x] `run:phase-done` event after every finished phase → App.jsx refreshes the
      run's report cache, so flaws stream into the live run card phase by phase
      (explore flaws right after explore, critique flaws after critique, design
      diffs after design) instead of appearing only at run end. The live card
      already rendered `reports[key]`, so no card rendering changes needed.
- [x] `RunBlock`: amber per-phase warning ("<phase> failed — the other phases'
      results below are unaffected"), "Done (partial)" status; partial state
      rides the cached report entry after run end (in-memory).
- [x] CLI parity: `test-app:*` now `explore && { critique; design; annotate;
      report; }` — post-explore phases independent there too.

### Non-goals (evidence-backed, see docs/figma-design-qa.md "Don'ts")

- No pixel-diff verdicts, no CLIP embeddings as the mapping key, no Figma MCP
  dependency, no Code Connect, never force a match ("no design counterpart" is
  a valid answer).

Cost: Sonnet judge ≈ $0.03/screen → ~$0.20/run on fittrack-class apps (+one
critique-pass-worth); `DESIGN_MODEL=anthropic/claude-haiku-4.5` cuts it ~3×.

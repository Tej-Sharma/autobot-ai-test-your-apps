# Design-fidelity pass — implementation vs Figma

You are checking whether a web app's screens match their **Figma designs**. The browser is
configured (`playwright` MCP), the app is reachable at the base URL in the run context, and
the **Figma MCP** (`figma`) is wired in — use it to read the design's truth (rendered frame
+ exact tokens + layer geometry), not your eyes alone.

The global rules above (journals, budgets, no-loop, quit-when-done, error handling) apply.
This is NOT the UX-critique pass — you are not asking "is this good UX?", you are asking
"does the implementation match what the designer specified?" Cite **exact expected-vs-actual
values** wherever you can (color, spacing, font, size) — that precision is the whole point.

Read first: `.webbot/design-map.json`, `.webbot/state-graph.json`, `.webbot/CLAUDE.md`
(flows give you the `reach` paths to each screen), `.webbot/critique-rubric.md` (the
"Design fidelity" section lists the deviation categories).

## Why this beats naive screenshot-diffing

A picture-vs-picture compare misaligns and misses subtle drift. You have better data:
- **Figma side**: `mcp__figma__get_metadata` (layer ids/names/types and **x/y/w/h**),
  `mcp__figma__get_screenshot` (rendered frame), `mcp__figma__get_variable_defs` (the exact
  tokens — hex, spacing, type — used in the selection).
- **Live side**: `browser_evaluate` → `getComputedStyle` + `getBoundingClientRect` gives the
  real rendered values and pixel boxes.
Reconcile **values**, and anchor every finding to a **real element box** — never guess pixel
coordinates off the image.

## Pass 0 — Pair frames to screens (skip if `design-map.json` already has `screens`)

If `design-map.json` already lists `screens`, trust it (re-pairing is wasteful) and go to
Pass 1. Otherwise build it:

1. Enumerate Figma frames. `mcp__figma__get_metadata` with no node-id lists the file's pages;
   drill into each page id to get its top-level frames (id, name, x/y/w/h). If a `Figma
   source` link is in the run context, scope to it; if none, the user has a frame selected in
   the desktop app — work with the current selection and say so in the report.
2. For each frame, `mcp__figma__get_screenshot` and save it to `<run>/design/<frame-slug>__figma.png`.
3. Match each frame to an implemented screen using `state-graph.json` (named nodes + URLs)
   and any prior screenshots — by **name** (frame "Sign in" ↔ route `/login`) **and visual
   content**. Reach the live screen if unsure (navigate + screenshot) to confirm.
4. Write `design-map.json`: one `screens[]` entry per confident pair with `name`,
   `figma_node`, `url`, `reach` (steps to arrive), `viewport` (the frame's w/h),
   `state` (what the frame depicts, e.g. "empty form", "3 cards"), `paired_by: "auto"`,
   `confidence: "high"|"low"`. Leave unmatched frames out but list them in the final report
   so the user can map them. Write the file before driving — it persists across runs.

## Pass 1 — Capture each screen, both sides aligned

For each paired screen in `design-map.json`:

1. **Match the design's conditions.** `browser_resize` the viewport to the frame's
   `viewport` (e.g. 1440×1024) so the screenshot lines up 1:1 with the frame — this is what
   kills the alignment drift that breaks naive tools. Navigate via `url`/`reach` and put the
   screen in the frame's depicted `state` (don't fill a form the frame shows empty).
2. **Live screenshot** → `browser_take_screenshot` to `<screen-slug>__impl.png` (journal it
   in `journal.jsonl` like any checkpoint).
3. Make sure the Figma render for this screen is saved under `<run>/design/` (from Pass 0,
   or pull it now).

## Pass 2 — Reconcile → `design-diffs.jsonl`

For each screen, compare the design's key layers to the implementation. Pull the design's
tokens/geometry (`get_variable_defs`, `get_metadata` on the frame's node) as the **expected**;
read the live **actual** with `browser_evaluate`. Check, per element: presence (missing /
extra), position & size, spacing/padding, color (fill, text, border), typography (family,
weight, size, line-height), corner radius, icon/asset, and copy/text content.

For every **real** deviation, append one line to `design-diffs.jsonl`:

```json
{
  "n": 1,
  "screen": "onboarding-step2",
  "screenshot": "screenshots/onboarding-step2__impl.png",
  "figma_image": "design/onboarding-step2__figma.png",
  "figma_node": "123:456",
  "category": "spacing|color|typography|copy|layout|missing|extra|radius|icon|size",
  "severity": "high|medium|low",
  "rect": { "x": 0, "y": 0, "w": 0, "h": 0 },
  "expected": "16px gap (token spacing/md)",
  "actual": "8px gap (computed margin-top)",
  "description": "Card vertical padding is half the spec"
}
```

- `rect` is in **implementation-screenshot pixel space** (the box the marker is drawn over).
  Get it from the offending element's `getBoundingClientRect` at the capture viewport — DPR
  is 1 at standard viewport, so client px == screenshot px; if the screenshot is scaled,
  multiply by the scale factor. Number `n` sequentially across the whole run (1, 2, 3…).
- **Calibrated / spec-grounded**: flag deviations a designer would log in review. Ignore
  sub-pixel rounding, antialiasing, and *intentional* responsive reflow. If the
  implementation is clearly a deliberate, reasonable improvement, note it as `low` rather
  than `high`. A faithful screen should produce few or zero diffs — don't manufacture noise.
- Severity: `high` = obvious to any viewer (wrong color/layout, missing element);
  `medium` = a designer notices (spacing/type drift); `low` = nitpick.

## Pass 3 — `design-report.html`

One self-contained HTML file in the run dir (dark mode, minimal CSS, no external deps, no
base64 — relative `<img>` paths). Per screen, in `design-map.json` order:

- **Side-by-side**: the Figma frame (`design/<…>__figma.png`) on the left, the implementation
  on the right. Over the implementation `<img>`, draw a **numbered overlay**: for each diff on
  that screen, an absolutely-positioned box at its `rect` (scaled to the rendered img size via
  a wrapping `position:relative` container and percentage coords) with the number `n` in a
  badge at its corner. Color the box by severity (high/med/low).
- **Numbered issue list** under the pair: each `n` → category badge, severity, `expected`
  → `actual`, and `description`. Make each list item link/anchor to its marker.
- Header: app name, base URL, run timestamp, screen count, diff counts by severity.
- Footnote: any Figma frames that couldn't be paired (so the user can map them), and any
  `low`-confidence pairs to double-check.
- Footer: run command + model + the Figma source used.

Refresh `reports/latest` to symlink this run's dir.

## Final message

Under 250 words:
- Screens compared / paired / unpaired.
- Top 3–5 high-severity deviations (one line each: screen, what's off, expected→actual).
- Any low-confidence pairings or unpaired frames the user should map.
- Path to `design-report.html`.

Then stop.

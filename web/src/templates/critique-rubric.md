# Visual UX critique rubric — web

When critiquing a screenshot, evaluate it as a thoughtful first-time user would. You
are looking for things a *sensible person would side-eye* — not pixel-level
perfection. A screenshot can be ugly and still pass; pretty and still fail.

For each screenshot, flag any of the following:

## Layout
- **Truncated text** — labels cut off, ellipses where the full text should fit
- **Overflow** — content escaping its container, horizontal scrollbars on a page that shouldn't have them, elements bleeding off-viewport
- **Misalignment** — buttons/labels visibly off-grid, inconsistent margins between repeating elements
- **Collision** — overlapping elements that shouldn't overlap (sticky headers over content, FABs over text)
- **Empty space** — vast unused area that feels unfinished, content jammed into one corner of a wide viewport
- **Crowding** — elements with no breathing room
- **Unstyled flash artifacts** — half-hydrated UI, skeletons mixed with real content, FOUC remnants

## Content
- **Placeholder content** — `Lorem ipsum`, `TODO`, `{{ name }}`, `undefined`, `null`, `NaN`, `[object Object]`, "Untitled", debug strings
- **Broken images** — alt-text boxes, broken thumbnail icons, missing avatars
- **Default scaffolding** — framework default pages (Vite/Next/CRA welcome screens), default favicons, "React App" page titles
- **Wrong locale** — mixed languages, untranslated keys (`home.title`)
- **Stale data** — dates from 1970, `Invalid Date`, "0 results" where content should exist

## Affordance
- **Unclear primary action** — multiple buttons of equal visual weight; no obvious next step
- **Tiny click targets** — controls too small to hit reliably (worse on touch)
- **Hidden interactions** — important controls below the fold with no scroll cue
- **Disabled-looking enabled elements** — gray buttons that are actually clickable, and vice versa
- **Links that don't look like links** — plain text that's secretly the only way forward

## Copy
- **Confusing labels** — jargon, ambiguous CTAs ("Submit" for what?)
- **Tone mismatch** — overly formal in a casual app, or vice versa
- **Error messages a user can't act on** — "Error 500" with no recovery hint, raw exception text shown to the user
- **Typos / grammar**

## State
- **Empty state weirdness** — "0 items" with no call to action, blank panels
- **Loading state weirdness** — spinner stuck, skeleton that never resolves, layout jumping as content lands
- **Error state weirdness** — generic "Something went wrong" with no retry, error boundaries showing stack traces

## Accessibility (light pass)
- **Low contrast** — light gray text on white, white on yellow
- **Tiny text** — body copy that looks under ~13px
- **Focus/keyboard hostility visible in the shot** — custom controls with no visible focus state, div-buttons

## Brand consistency (cross-screen — compare across the run's screenshots)
- **Inconsistent fonts** — multiple typefaces with no clear hierarchy
- **Inconsistent colors** — accent colors that drift between screens
- **Inconsistent components** — pill, rounded-rect, and square buttons across screens; two different modal styles; nav that changes shape between pages

## Design fidelity (only when a Figma frame is provided — the `webbot design` pass)

This section is NOT used by the normal run/flow critique (which judges UX in the abstract).
It applies only when comparing a screen against its Figma frame. Judge against the **design's
own spec**, citing exact expected-vs-actual values (the Figma side comes from
`get_variable_defs` / `get_metadata`; the live side from computed styles). Categories:

- **layout** — element repositioned, reordered, or differently aligned vs the frame
- **spacing** — padding/margin/gap drift (e.g. design 16px, built 8px)
- **size** — element width/height materially off the frame
- **color** — fill / text / border / background hex differs from the design token
- **typography** — font family, weight, size, or line-height mismatch
- **radius** — corner radius differs (sharp where the design is rounded, etc.)
- **copy** — text content differs from the frame (wording, casing, label)
- **icon** — wrong, missing, or restyled icon/asset vs the design
- **missing** — a layer present in the frame is absent in the build
- **extra** — an element in the build that the frame doesn't have

Be calibrated: ignore sub-pixel rounding, antialiasing, and intentional responsive reflow.
A faithful screen should yield few or zero deviations. Each deviation becomes a
`design-diffs.jsonl` entry (schema in the design-prompt), anchored to the offending
element's real bounding box.

---

## Output format

For each screenshot, output a JSON line to `critique.jsonl`:

```json
{
  "file": "screenshots/signup__03_create-account.png",
  "verdict": "pass" | "warn" | "fail",
  "issues": [
    {
      "category": "layout",
      "severity": "high" | "medium" | "low",
      "description": "Email field label is truncated to 'Email addres…'",
      "where": "top of form, under header"
    }
  ],
  "notes": "Otherwise clean. Good visual hierarchy."
}
```

- **pass** = nothing meaningful to flag
- **warn** = something a designer would want to know but doesn't block ship
- **fail** = a real user would notice and complain

Every warn/fail issue ALSO becomes a `flaws.jsonl` entry (see global rules) unless an
equivalent flaw was already recorded during the drive.

Be specific. "Looks weird" is not useful. "The 'Continue' button is centered but the
form is left-aligned, which makes the button feel detached" is useful.

Be calibrated. If you flag everything, the report is noise. Most screens in a
well-designed app should pass.

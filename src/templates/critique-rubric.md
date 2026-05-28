# Visual UX critique rubric

When critiquing a screenshot, evaluate it as a thoughtful first-time user would. You are looking for things that *a sensible person would side-eye* — not pixel-level perfection. A screenshot can be ugly and still pass; a screenshot can be pretty and still fail.

For each screenshot, flag any of the following:

## Layout
- **Truncated text** — labels cut off, ellipses where the full text should fit
- **Overflow** — text or images extending beyond their container, off-screen elements
- **Misalignment** — buttons/labels visibly off-grid, inconsistent margins between repeating elements
- **Collision** — overlapping elements that shouldn't overlap
- **Empty space** — vast unused area on a screen that feels unfinished
- **Crowding** — elements jammed together with no breathing room

## Content
- **Placeholder content** — `Lorem ipsum`, `TODO`, `{{ name }}`, `nil`, `undefined`, `null`, "Untitled", debug strings
- **Broken images** — missing image placeholders, broken thumbnail icons
- **Wrong locale** — mixed languages, untranslated strings
- **Stale data** — dates from 1970, "0 results" where there should be content

## Affordance
- **Unclear primary action** — multiple buttons of equal visual weight; no obvious next step
- **Tiny tap targets** — buttons that look too small to hit reliably
- **Hidden interactions** — important controls below the fold with no scroll indicator
- **Disabled-looking enabled elements** — gray buttons that are actually tappable

## Copy
- **Confusing labels** — jargon, ambiguous CTAs ("Submit" for what?)
- **Tone mismatch** — overly formal in a casual app, or vice versa
- **Error messages a user can't act on** — "Error -1009" with no recovery hint
- **Typos / grammar**

## State
- **Empty state weirdness** — "0 items" with no call to action, blank screens
- **Loading state weirdness** — spinner stuck, skeleton that never resolves
- **Error state weirdness** — generic "Something went wrong" with no retry

## Accessibility (light pass)
- **Low contrast** — light gray text on white, white on yellow
- **Tiny text** — body copy that looks under ~12pt
- **Tap targets** that appear under ~44pt

## Brand consistency
- **Inconsistent fonts** — multiple fonts on one screen with no clear hierarchy
- **Inconsistent colors** — accent colors that drift between screens
- **Inconsistent button styles** — pill, rounded-rect, and square buttons on the same screen

---

## Output format

For each screenshot, output a JSON object:

```json
{
  "file": "flows/signup/03_tap-continue.png",
  "verdict": "pass" | "warn" | "fail",
  "issues": [
    {
      "category": "layout",
      "severity": "high" | "medium" | "low",
      "description": "Email field label is truncated to 'Email addres…'",
      "where": "top of screen, under header"
    }
  ],
  "notes": "Otherwise clean. Good visual hierarchy."
}
```

- **pass** = nothing meaningful to flag
- **warn** = something a designer would want to know but doesn't block ship
- **fail** = a real user would notice and complain

Be specific. "Looks weird" is not useful. "The 'Continue' button is centered but the rest of the form is left-aligned, which makes the button feel detached from the form" is useful.

Be calibrated. If you flag everything, the report is noise. Most screens in a well-designed app should pass.

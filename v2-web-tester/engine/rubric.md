# UX critique rubric

Edit this freely — the critique pass loads it verbatim. Judge each screenshot against these.

## Copy & content
- Spelling / grammar / typos in any visible text.
- Placeholder or developer text shipped to users ("TODO", "lorem", "test", raw keys).
- Truncated / clipped text ("Welcome back, Alexand…"), or text overflowing its container.
- Inconsistent terminology or capitalization.

## Visual & layout
- Overlapping or colliding elements; misaligned items; cramped or uneven spacing.
- Low-contrast text (light gray on white) that's hard to read.
- Inconsistent styling for the same kind of control (e.g. one rounded button, one square).
- Content overflowing the viewport width (horizontal scrollbars that shouldn't exist), or
  layout that visibly breaks/collides at the captured viewport size.
- Elements cut off by the viewport edge or hidden behind fixed headers/footers.

## Affordance & hierarchy
- No clear primary action, or multiple equal-weight "primary" buttons.
- Controls that don't look clickable, or static text that looks clickable.
- Missing or unclear hover/focus states on interactive elements (if visible in the capture).
- Destructive actions (Delete, Log Out) without confirmation or visual distinction.

## Accessibility
- Click targets that look too small/cramped to hit reliably.
- Color used as the only signal; insufficient contrast.
- Important text too small to read.
- Missing visible labels on form fields (placeholder-only labels that vanish on input).

## State & correctness (only what's visible)
- Empty states shown as broken/blank instead of a helpful message.
- Obviously wrong values, broken images, or error text on screen.
- Forms with unmasked passwords, or fields with no labels.

Note: this pass is vision-only — it doesn't see console errors or failed network requests
(the drive pass catches those live, with real signal, and logs them under `network`/`console`
flaw types). Don't guess at unseen backend behavior here.

Severity: **high** = a user would complain · **medium** = a designer would flag · **low** = polish.
Report only what is visible in the image.

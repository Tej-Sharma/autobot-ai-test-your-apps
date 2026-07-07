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
- Elements cut off by the screen edge, a notch, or the keyboard.

## Affordance & hierarchy
- No clear primary action, or multiple equal-weight "primary" buttons.
- Controls that don't look tappable, or static text that looks tappable.
- Destructive actions (Delete, Log Out) without confirmation or visual distinction.

## Accessibility
- Tap targets visibly smaller than ~44pt.
- Color used as the only signal; insufficient contrast.
- Important text too small to read.

## State & correctness (only what's visible)
- Empty states shown as broken/blank instead of a helpful message.
- Obviously wrong values, broken images, or error text on screen.
- Forms with unmasked passwords, or fields with no labels.

Severity: **high** = a user would complain · **medium** = a designer would flag · **low** = polish.
Report only what is visible in the image.

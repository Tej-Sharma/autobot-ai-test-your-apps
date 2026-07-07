# v2-mobile-tester

The v2 rebuild of the iOS DRIVE pass: run a **fast model** on the drive loop (behind an
`AUTOBOT_DRIVE_ENGINE` flag) instead of Claude Sonnet, while keeping the CRITIQUE pass on
Claude. Goal: cut per-step latency ~2× on native apps without losing screenshot-based
bug-finding.

> **Status: research complete, not yet built.** This folder holds the plan + the go/no-go
> spike. Nothing here changes v1 behavior.

## The decision (settled)

```
DRIVE (native app)  → custom Vercel AI SDK loop, model = Gemini 3.5 Flash (thinking_level: minimal)
DRIVE (Flutter)     → Claude (coordinate grounding; a fast model can't, a VL specialist is no faster)
CRITIQUE (all)      → Claude (vision + judgment, unchanged)
```

Why these, in one line each:
- **Gemini 3.5 Flash (minimal):** ~1.6s/step vs Claude's ~3.5s, 1M ctx, and it's on
  opencode's image-embed allowlist (`gemini-3`). TTFT — not decode tok/s — is what governs
  this loop, so the reasoning/"thinking" variants (17–137s TTFT) are banned.
- **Custom AI SDK loop, not opencode, for production:** loop quality is ≈ equal (the model
  dominates), but opencode's auto-compaction *strips screenshots* and fights autobot's
  "externalize state to disk every step, keep context lean, deterministic recovery" design.
  The AI SDK's `onStepEnd` / `stopWhen` / `prepareStep` make journaling, budgets, and
  screenshot-pruning **code-enforced** instead of prompt-hoped.
- **Flutter → Claude:** Flutter's thin a11y tree forces tap-by-coordinate; Qwen3-VL's GUI
  grounding is ~3.2s/step (≈ Claude) and needs a coordinate adapter — no speed win, so not
  worth it in v1.

What got ruled out: Groq/SambaNova "fast hosts" (faster on decode, slower end-to-end for
short outputs; SambaNova's Llama 4 is dead); MiniMax/Chinese models via Claude Code (their
Anthropic endpoints are blind to screenshots); Gemini CLI & Codex CLI (drop MCP images).

## The plan (staged, gated)

1. **Measure** where a real run's time goes (instrument `bin/autobot`) — confirm the agent
   loop, not infra (xcodebuild / sim boot / WDA cold-start), is the bottleneck.
2. **Spike (go/no-go)** — `spike/`: screenshot-survival + image-prefill latency on a real
   1290×2796 PNG, using opencode + Gemini 3.5 Flash (zero code). Two questions:
   does the screenshot reach the model, and is it actually fast with a full-res image in
   the prompt? **This gates everything.**
3. **Build** the custom Vercel AI SDK loop as the production drive engine (only if step 2
   passes). Native → Gemini 3.5 Flash. Journaling/budgets/pruning code-enforced.
4. **Defer:** Qwen3-VL `mobile_use` for Flutter (only if volume + grounding need justify an
   adapter); the Figma design-diff pass (separate workstream).

## Full research

The detailed findings, comparison tables, sources, and the Figma design-diff spec live in
the **private** `autobot-docs` repo (kept out of this public repo on purpose):

- `fast-drive-engine.md` — harness + model comparison, host/VL analysis, loop-quality verdict
- `figma-visual-difference.md` — screen↔Figma-frame mapping (prefilter → vision-confirm → cache)

(Locally: `../docs/` · remote: `github.com/Constella-OS/autobot-docs`, private.)

## Layout

```
v2-mobile-tester/
  README.md          ← you are here
  spike/             ← the go/no-go validation harness (opencode + Gemini 3.5 Flash)
```

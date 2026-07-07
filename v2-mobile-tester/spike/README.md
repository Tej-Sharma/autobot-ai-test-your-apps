# Spike: fast drive-engine go/no-go (Vercel AI SDK loop)

The cheapest experiment that validates (or kills) the v2 plan, built on the **production
path** (custom AI SDK loop + mobile-mcp) — not opencode. The ~80 lines in `spike.mjs` are
the seed of the real drive engine.

## What it answers

1. **Screenshot survival** — does the model actually SEE the simulator screenshot? The PNG
   is fed as an explicit image message part (the universally-supported path); we check
   whether the model reads on-screen text verbatim.
2. **Image-prefill latency** — wall-clock per step with a real full-res PNG in the prompt.
   This is the unmeasured risk that could erase the speed win.

## Setup

1. **API key** — put one line in `.env` (gitignored):
   `OPENROUTER_API_KEY=...` (recommended — A/Bs many models) or `GEMINI_API_KEY=...`.
2. **Booted simulator with the app** — e.g. iPhone 17 with `ai.beemo.fittrack` (FitTrack).
3. `npm install` (in this dir).

## Run

```bash
cd v2-mobile-tester/spike
npm install
npm run spike                 # defaults to ai.beemo.fittrack
npm run spike -- <bundleId>   # other app
MODEL=openai/gpt-5.4-mini npm run spike   # A/B another model (OpenRouter)
```

## Reading the result

The script prints, per step, the model's latency + the text it claims to see, then a verdict:

| Outcome | Meaning | Next |
|---|---|---|
| Reads real labels ("FitTrack", "Username", "Log In"), step ≈ model TTFT | ✅ both gates pass | Grow this into the production drive engine |
| `visibleText: []` / hallucinated text | ❌ screenshot blind | Try another model/provider; if all blind, stay on Claude |
| Reads text but step ≫ TTFT | ⚠️ image prefill dominates | Record the real per-step cost; reassess the speedup |

## Notes

- First run may need a tweak: the `gemini-3.5-flash` OpenRouter slug and the exact
  mobile-mcp tool/arg names are verified at runtime (the script prints discovered tools).
- This spike does NOT touch v1; nothing is wired into `bin/autobot`.
- Once vision + latency check out, add minimal-thinking config + native tool-calling.

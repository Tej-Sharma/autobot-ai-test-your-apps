# Loop-guard: rolling last-N state memory + stuck detection

## Problem
- `enterApp()` bootstrap loop has no memory → toggles Start/Pause/Resume on CoeFont
  because `inApp()` checks hardcoded fittrack tabs (`home,workouts,profile`) that never match.
- DFS loop re-queues toggling controls (each toggle yields a slightly different signature
  that looks like "changed"), so even after entering it can churn.
- No mechanism to notice "we've seen these same few screens for the last several taps."

## Fix — a rolling ring of the last N (=10) state signatures after every interaction
Add to `alternate-dfs-app-traversal.mjs` (formerly `drive.mjs`):
1. `ring[]` of `{sig,label}`, `recordState()`, capped at `HISTORY` (env, default 10).
2. `stuckSignal()` → `'stall'` (same sig 3x = dead control / scroll wall) | `'cycle'`
   (last 6 interactions cover ≤2 distinct screens = A↔B toggle) | `null`.
3. **Bootstrap**: record sig each iteration; on stuck, break out into the DFS instead of
   spinning to 16. (Generalizes "am I in?" — no per-app tab list needed.)
4. **DFS loop**: record sig after each tap; on stuck, mark the churning labels tried across
   all recently-cycling signatures and `continue` (pop a different frontier branch =
   backtrack/move-on) instead of expanding the churning screen.
5. Infinite scroll already bounded (`collectScrollable` breaks on no-new-content, max 4) —
   leave as is; the ring covers tap-level cycles.

## Verify
Re-run CoeFont on the real device; confirm it leaves the Start/Pause screen, opens
Grid View → menu/settings/history, and the log shows `⟲ cycle/stall … moving on`
instead of endless `tap 'Pause'/'Resume'`.

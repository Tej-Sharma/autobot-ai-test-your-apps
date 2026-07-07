// ============================================================================
// core/schemas.mjs — builders for the explorer's structured-output schemas.
// The shared field set (screen/uiDone/goals/flows/done…) is defined ONCE here;
// each platform injects only what genuinely differs: its flaw-type enum, its
// nextAction schema (tap/swipe/speak vs click/navigate), and the handful of
// platform-worded describe() strings. parity/check.mjs asserts the built
// schemas are structurally identical to the old per-engine definitions.
// ============================================================================
import { z } from 'zod';

export const makeFlawSchema = ({ types, bboxNote }) => z.object({
  type: z.enum(types),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe(bboxNote),
});

export const makeTurnSchema = ({ flaw, flowNameNote, flowEvidenceNote, nextAction }) => z.object({
  screen: z.string(),
  uiDone: z.string(),
  expectationCheck: z.string(),
  reasoning: z.string(),
  goalsSoFar: z.array(z.string()),
  goalsCompleted: z.array(z.string()),
  areasRemaining: z.array(z.string()),
  flaws: z.array(flaw),
  crashed: z.boolean(),
  flowCompleted: z.object({
    name: z.string().describe(flowNameNote),
    startStep: z.number().int().describe('the step number where this flow began'),
    evidence: z.string().describe(flowEvidenceNote),
  }).nullable().describe('null on almost every turn — set ONLY when a whole large flow just finished (see rules)'),
  nextAction,
  done: z.boolean(),
});

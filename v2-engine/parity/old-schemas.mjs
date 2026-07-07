// ============================================================================
// parity/old-schemas.mjs — VERBATIM transcriptions of the FLAW/TURN zod schemas
// from the OLD engines' explore.mjs files (which execute their main loop on
// import, so they can't be imported directly). Do not edit — these exist only
// so parity/check.mjs can prove the new composed schemas are structurally
// identical to what the old engines sent the model.
//   mobile source: v2-mobile-tester/engine/explore.mjs (lines ~105-136)
//   web source:    v2-web-tester/engine/explore.mjs   (lines ~117-147)
// ============================================================================
import { z } from 'zod';

// ---- OLD MOBILE ----
const MOBILE_FLAW = z.object({
  type: z.enum(['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy']),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-screen issues'),
});
export const MOBILE_TURN = z.object({
  screen: z.string(),
  uiDone: z.string(),
  expectationCheck: z.string(),
  reasoning: z.string(),
  goalsSoFar: z.array(z.string()),
  goalsCompleted: z.array(z.string()),
  areasRemaining: z.array(z.string()),
  flaws: z.array(MOBILE_FLAW),
  crashed: z.boolean(),
  flowCompleted: z.object({
    name: z.string().describe('short name of the flow, e.g. "Sign up and reach home"'),
    startStep: z.number().int().describe('the step number where this flow began'),
    evidence: z.string().describe('the on-screen evidence proving the flow completed'),
  }).nullable().describe('null on almost every turn — set ONLY when a whole large flow just finished (see rules)'),
  nextAction: z.object({
    kind: z.enum(['tap', 'type', 'swipe', 'back', 'relaunch', 'speak', 'stop']),
    elementIndex: z.number().int().nullable(),
    label: z.string().nullable(),
    x: z.number().int().nullable(), y: z.number().int().nullable(),
    text: z.string().nullable(),
    direction: z.enum(['up', 'down']).nullable(),
    expectation: z.string(),
  }),
  done: z.boolean(),
});

// ---- OLD WEB ----
const WEB_FLAW = z.object({
  type: z.enum(['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy', 'network', 'console']),
  severity: z.enum(['high', 'medium', 'low']), summary: z.string(), detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-page issues'),
});
export const WEB_TURN = z.object({
  screen: z.string(),
  uiDone: z.string(),
  expectationCheck: z.string(),
  reasoning: z.string(),
  goalsSoFar: z.array(z.string()),
  goalsCompleted: z.array(z.string()),
  areasRemaining: z.array(z.string()),
  flaws: z.array(WEB_FLAW),
  crashed: z.boolean(),
  flowCompleted: z.object({
    name: z.string().describe('short name of the flow, e.g. "Sign up and reach dashboard"'),
    startStep: z.number().int().describe('the step number where this flow began'),
    evidence: z.string().describe('the on-page evidence proving the flow completed'),
  }).nullable().describe('null on almost every turn — set ONLY when a whole large flow just finished (see rules)'),
  nextAction: z.object({
    kind: z.enum(['click', 'type', 'navigate', 'back', 'stop']),
    elementIndex: z.number().int().nullable(),
    label: z.string().nullable(),
    text: z.string().nullable(),
    url: z.string().nullable().describe('for kind=navigate: an in-app URL to jump to directly'),
    expectation: z.string(),
  }),
  done: z.boolean(),
});

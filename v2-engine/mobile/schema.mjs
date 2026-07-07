// ============================================================================
// mobile/schema.mjs — the iOS explorer's structured-output schema: mobile flaw
// types + the tap/type/swipe/back/relaunch/speak/stop action vocabulary,
// assembled on the shared field set in core/schemas.mjs. Structurally identical
// to the old v2-mobile-tester/engine/explore.mjs definitions (parity-checked).
// ============================================================================
import { z } from 'zod';
import { makeFlawSchema, makeTurnSchema } from '../core/schemas.mjs';

export const FLAW = makeFlawSchema({
  types: ['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy'],
  bboxNote: 'normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-screen issues',
});

export const TURN = makeTurnSchema({
  flaw: FLAW,
  flowNameNote: 'short name of the flow, e.g. "Sign up and reach home"',
  flowEvidenceNote: 'the on-screen evidence proving the flow completed',
  nextAction: z.object({
    kind: z.enum(['tap', 'type', 'swipe', 'back', 'relaunch', 'speak', 'stop']),
    elementIndex: z.number().int().nullable(),
    label: z.string().nullable(),
    x: z.number().int().nullable(), y: z.number().int().nullable(),
    text: z.string().nullable(),
    direction: z.enum(['up', 'down']).nullable(),
    expectation: z.string(),
  }),
});

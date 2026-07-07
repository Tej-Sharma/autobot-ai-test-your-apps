// ============================================================================
// web/schema.mjs — the web explorer's structured-output schema: web flaw types
// (adds console/network) + the click/type/navigate/back/stop action vocabulary,
// assembled on the shared field set in core/schemas.mjs. Structurally identical
// to the old v2-web-tester/engine/explore.mjs definitions (parity-checked).
// ============================================================================
import { z } from 'zod';
import { makeFlawSchema, makeTurnSchema } from '../core/schemas.mjs';

export const FLAW = makeFlawSchema({
  types: ['visual', 'content', 'functional', 'crash', 'performance', 'a11y', 'copy', 'network', 'console'],
  bboxNote: 'normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-page issues',
});

export const TURN = makeTurnSchema({
  flaw: FLAW,
  flowNameNote: 'short name of the flow, e.g. "Sign up and reach dashboard"',
  flowEvidenceNote: 'the on-page evidence proving the flow completed',
  nextAction: z.object({
    kind: z.enum(['click', 'type', 'navigate', 'back', 'stop']),
    elementIndex: z.number().int().nullable(),
    label: z.string().nullable(),
    text: z.string().nullable(),
    url: z.string().nullable().describe('for kind=navigate: an in-app URL to jump to directly'),
    expectation: z.string(),
  }),
});

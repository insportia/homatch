/*
 * WHO HOMATCH AI SAYS IT IS — now kept in src/lib/ai/identity.ts.
 *
 * It moved because it was unreachable from half the surfaces it governs. The
 * Ask panel inside a verification builds its prompt in src/dealroom/domain,
 * which is bundled INTO an edge function at deploy time but cannot import
 * from supabase/functions — so the one module that says how Homatch AI
 * introduces itself could only be used by edge functions, and exactly one of
 * them used it.
 *
 * This file stays, re-exporting, so nothing that imported it had to change
 * and nobody has to remember two names for one policy. The prose explaining
 * each decision is in the module itself.
 */

export {
  AI_HONESTY_FLOOR,
  HOMATCH_AI_IDENTITY,
  MODEL_QUESTION_POLICY,
} from '../../../src/lib/ai/identity.ts';

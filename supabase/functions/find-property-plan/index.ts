// HOMATCH — FIND PROPERTY: the planner.
//
// A customer describes what they are looking for, in their own words, in any of six
// languages. This turns that into a SEARCH PLAN they can read and correct, and then
// into the row the deterministic matcher already reads.
//
// THE DIVISION OF LABOUR, WHICH IS THE WHOLE DESIGN
//
//   THE MODEL INTERPRETS. It reads prose and proposes a draft of one fixed shape. That
//   is a real and hard job -- "2 bedrooms in Vake or Saburtalo, up to 150k, ideally a
//   balcony" in Georgian, Russian or Hebrew -- and a model is the right tool for it.
//
//   NOTHING ELSE. The draft arrives as untrusted JSON and passes through
//   normalisePlan(), which recognises values out of closed sets or discards them. The
//   model cannot introduce a field, cannot widen a vocabulary, cannot emit a rule, and
//   cannot emit anything that is executed. There is no generated code anywhere in this
//   function and no path by which a model's output becomes one.
//
//   THE CUSTOMER DECIDES. The draft is returned, not run. Every field is editable and
//   what executes is the plan they confirm -- because a model's reading of somebody's
//   requirements is a suggestion about their own life, and they are the authority.
//
//   THE MATCHER MATCHES. Confirming writes an intent_profiles row and an
//   active_search_subscriptions row, and stops. supply-matching -- deterministic,
//   cron-driven, already proven -- does the comparing, and find-property reads the
//   results back. This function never scores anything.
//
// WHAT IT COSTS: NOTHING, AND THAT IS NOT AN OVERSIGHT.
//
// There is no reservation, no capture and no wallet read in this file. Writing down
// what somebody is looking for is not a billable event, and the matching runs against
// supply_observations, which carries no campaign_id and was funded by whoever triggered
// the sweep. Expand Search -- going outside what Homatch already holds -- is the PAYG
// action, and it is not here.
//
// AND IF THE MODEL IS UNAVAILABLE, IT SAYS SO.
//
// No silent keyword fallback dressed as a reading, and no spinner that never resolves.
// `interpreted: false` comes back with the customer's text intact, and the interface
// puts them in the plan editor with empty fields. A planner that pretends to have
// understood is worse than one that admits it has not.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  type PlanDraft,
  normalisePlan,
  planReadiness,
  planToIntentProfile,
} from '../../../src/research-core/discovery/search-plan.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/**
 * The instruction given to the model.
 *
 * It describes a SHAPE and nothing else. No rule about matching, no scoring, no
 * thresholds, no query construction -- because every one of those lives in code that
 * is tested, and a prompt is not a place to keep a rule you rely on.
 *
 * The strengths are explained rather than listed, because the distinction between
 * "must" and "would prefer" is the one judgement the reading genuinely has to make and
 * getting it wrong changes what the customer is shown.
 */
const SYSTEM_PROMPT = `You read a person's description of the property they are looking for and return STRICT JSON. You do not search, score, rank or advise. You only structure what they said.

Return exactly this shape, omitting any field they did not mention:
{
  "goal": "BUY" | "RENT" | "SHORT_STAY" | "INVEST" | "COMMERCIAL" | "LAND",
  "countryCode": two-letter code,
  "city": string,
  "cityStrength": "REQUIRED" | "PREFERRED" | "FLEXIBLE",
  "districts": string[],
  "districtsStrength": "REQUIRED" | "PREFERRED" | "FLEXIBLE",
  "propertyTypes": ("APARTMENT"|"HOUSE"|"LAND"|"COMMERCIAL"|"OFFICE"|"HOTEL"|"OTHER")[],
  "propertyTypesStrength": "REQUIRED" | "PREFERRED" | "FLEXIBLE",
  "budgetMin": number, "budgetMax": number, "currency": "USD"|"GEL"|"EUR",
  "budgetStrength": "REQUIRED" | "PREFERRED" | "FLEXIBLE",
  "bedroomsMin": number, "bedroomsMax": number,
  "bedroomsStrength": "REQUIRED" | "PREFERRED" | "FLEXIBLE",
  "areaMin": number, "areaMax": number,
  "areaStrength": "REQUIRED" | "PREFERRED" | "FLEXIBLE",
  "languages": ("en"|"ka"|"ru"|"tr"|"ar"|"he")[],
  "originalLanguage": "en"|"ka"|"ru"|"tr"|"ar"|"he"
}

STRENGTH is the most important judgement you make:
- REQUIRED: they said it must be so. "only in Vake", "no more than 150k", "must have 2 bedrooms".
- PREFERRED: they would rather have it. "ideally", "I'd prefer", "hopefully", "around".
- FLEXIBLE: they explicitly do not mind. "any district is fine", "whatever floor".
Omit the strength when they gave no indication; do not guess REQUIRED for emphasis that is not there.

A PLACE IS A NAME. Put one city in "city" and separate districts in the "districts" array. Never put a list, a comma, a conjunction or a wildcard in a single name field.

Do not invent a budget, a city or a room count they did not mention. An omitted field is a correct answer and is far better than a plausible guess: the person will be shown this and asked to correct it, and a number they never said is the hardest kind of mistake for them to notice.`;

interface Interpretation {
  draft: PlanDraft;
  interpreted: boolean;
  model: string | null;
  note: string | null;
}

/** Ask the model for a draft. Never throws; failure is a reported state. */
async function interpret(text: string, apiKey: string | undefined): Promise<Interpretation> {
  if (!apiKey) {
    return {
      draft: { originalText: text },
      interpreted: false,
      model: null,
      note: 'no_model_configured',
    };
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        /* Zero, because the same sentence should produce the same plan twice. A
           planner whose reading of one description varies between two attempts is a
           planner nobody can correct. */
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!response.ok) {
      return { draft: { originalText: text }, interpreted: false, model: null, note: 'model_unavailable' };
    }
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { draft: { originalText: text }, interpreted: false, model: null, note: 'model_returned_unparseable_json' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { draft: { originalText: text }, interpreted: false, model: null, note: 'model_returned_non_object' };
    }
    /*
     * originalText is set HERE, after the spread, so it is the customer's text and not
     * whatever the model chose to echo back into that field. The one field in the draft
     * that is not the model's to fill.
     */
    return {
      draft: { ...(parsed as Record<string, unknown>), originalText: text },
      interpreted: true,
      model: 'gpt-4o-mini',
      note: null,
    };
  } catch {
    return { draft: { originalText: text }, interpreted: false, model: null, note: 'model_unreachable' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);

  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  /*
   * WHO IS ASKING, resolved from the token. The gateway already rejected a missing or
   * malformed JWT (verify_jwt = true), so this establishes WHICH user.
   */
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile } = await db
    .from('users').select('id').eq('auth_id', caller.user.id).maybeSingle();
  if (!profile?.id) return json({ error: 'no Homatch profile for this account' }, 403);
  const userId = String(profile.id);

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode ?? 'draft');

    /* ── DRAFT: read the sentence, propose a plan, run nothing ───────────── */
    if (mode === 'draft') {
      const text = String(body.text ?? '').trim().slice(0, 4000);
      if (!text) return json({ error: 'describe what you are looking for' }, 400);

      const interpretation = await interpret(text, Deno.env.get('OPENAI_API_KEY'));
      const { plan, rejected } = normalisePlan(interpretation.draft);

      return json({
        success: true,
        mode: 'draft',
        /*
         * SAID PLAINLY, so the interface never has to show a reading that did not
         * happen. false means the customer types the plan themselves, which is a
         * worse experience and an honest one.
         */
        interpreted: interpretation.interpreted,
        model: interpretation.model,
        note: interpretation.note,
        plan,
        /* What was thrown away. Surfaced, because a silently narrowed search shows
           somebody results for a question they did not ask. */
        rejected,
        readiness: planReadiness(plan),
        /* Nothing was written and nothing was charged. */
        persisted: false,
        charged: { credits: 0 },
        elapsedMs: Date.now() - started,
      });
    }

    /* ── CONFIRM: the plan the customer approved becomes a real search ───── */
    if (mode === 'confirm') {
      /*
       * RE-NORMALISED, even though the draft was normalised on the way out. The body
       * of this request is a browser's, not the draft we sent: a customer edited it,
       * and a client is as untrusted as a model. Validating only on the way out would
       * mean the one path that WRITES is the one path that never checked.
       */
      const { plan, rejected } = normalisePlan((body.plan ?? {}) as PlanDraft);
      const readiness = planReadiness(plan);
      if (!plan || !readiness.ready) {
        return json({
          success: false,
          mode: 'confirm',
          plan,
          rejected,
          readiness,
          persisted: false,
          charged: { credits: 0 },
        }, 400);
      }

      const row = planToIntentProfile(plan, { language: plan.originalLanguage });
      const { data: intent, error: intentError } = await db
        .from('intent_profiles')
        .insert(row)
        .select('id')
        .single();
      if (intentError) throw intentError;

      /*
       * side = 'SUPPLY' is a subscription watching for LISTINGS, which is what FIND
       * PROPERTY is. A seller watching for buyers is side = 'DEMAND' and belongs to the
       * forward direction. find-property reads exactly this: its ownership boundary is
       * this row, so getting the side wrong would mean a customer's own search returned
       * nothing and nobody could say why.
       */
      const { data: subscription, error: subError } = await db
        .from('active_search_subscriptions')
        .insert({
          user_id: userId,
          intent_id: intent.id,
          side: 'SUPPLY',
          is_active: true,
          /* The plan itself, kept so the search can be shown and edited later. */
          search_criteria: plan as unknown as Record<string, unknown>,
        })
        .select('id')
        .single();
      if (subError) throw subError;

      return json({
        success: true,
        mode: 'confirm',
        plan,
        rejected,
        readiness,
        intentId: intent.id,
        subscriptionId: subscription.id,
        persisted: true,
        /*
         * Writing down what somebody is looking for is not a billable event, and the
         * matching runs over intelligence Homatch already holds. Expand Search is the
         * PAYG action and it is not this one.
         */
        charged: { credits: 0 },
        /* What happens next, in the words the read endpoint uses for the same states. */
        state: 'SEARCHING',
        elapsedMs: Date.now() - started,
      });
    }

    return json({ error: `unknown mode ${JSON.stringify(mode)}` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// contact-import Edge Function
// Accepts CSV/XLSX column metadata (already uploaded to Storage) + structured transform.
// Normalizes headers, emails (format validation), phones (E.164 best-effort with confidence).
// Deduplicates within list. Never executes model-generated SQL.
// AI transforms compile to allowlisted structured operations only.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeEmail, normalizePhone, inferCountryFromPhone } from '../_shared/suppression.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Allowlisted structured transforms ─────────────────────────
type AllowedTransform =
  | { op: 'filter_language'; language: string }
  | { op: 'filter_budget_min'; amount: number; currency?: string }
  | { op: 'filter_lead_type'; lead_type: string }
  | { op: 'remove_duplicates' }
  | { op: 'remove_missing_email' }
  | { op: 'remove_missing_phone' }
  | { op: 'segment_by_country'; country: string }
  | { op: 'filter_tags'; tags: string[] };

function applyTransform(rows: Record<string, unknown>[], transform: AllowedTransform): Record<string, unknown>[] {
  switch (transform.op) {
    case 'filter_language':
      return rows.filter((r) => String(r.language ?? '').toLowerCase().startsWith(transform.language.toLowerCase().slice(0, 2)));
    case 'filter_budget_min':
      return rows.filter((r) => {
        const v = parseFloat(String(r.budget_max ?? r.budget ?? 0));
        return !isNaN(v) && v >= transform.amount;
      });
    case 'filter_lead_type':
      return rows.filter((r) => String(r.lead_type ?? '').toUpperCase() === transform.lead_type.toUpperCase());
    case 'remove_duplicates': {
      const seen = new Set<string>();
      return rows.filter((r) => {
        const key = `${r.email ?? ''}|${r.phone ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    case 'remove_missing_email':
      return rows.filter((r) => r.email);
    case 'remove_missing_phone':
      return rows.filter((r) => r.phone);
    case 'segment_by_country':
      return rows.filter((r) => String(r.country ?? '').toUpperCase() === transform.country.toUpperCase());
    case 'filter_tags':
      return rows.filter((r) => {
        const rowTags = (r.tags as string[] | null) ?? [];
        return transform.tags.some((t) => rowTags.map((rt) => rt.toLowerCase()).includes(t.toLowerCase()));
      });
    default:
      return rows;
  }
}

// ── Header normalization dictionary ──────────────────────────
const HEADER_MAP: Record<string, string> = {
  'e-mail': 'email', 'e_mail': 'email', 'email address': 'email', 'mail': 'email',
  'phone number': 'phone', 'mobile': 'phone', 'tel': 'phone', 'telephone': 'phone', 'cell': 'phone',
  'first name': 'first_name', 'last name': 'last_name', 'firstname': 'first_name', 'lastname': 'last_name',
  'full name': 'full_name', 'name': 'full_name', 'contact': 'full_name',
  'org': 'company', 'organization': 'company', 'firm': 'company',
  'budget': 'budget_max', 'max budget': 'budget_max', 'min budget': 'budget_min',
  'type': 'lead_type', 'contact type': 'lead_type', 'role': 'lead_type',
  'lang': 'language', 'locale': 'language',
  'country code': 'country', 'nation': 'country',
};

function normalizeHeader(h: string): string {
  const lower = h.trim().toLowerCase();
  return HEADER_MAP[lower] ?? lower.replace(/\s+/g, '_');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: profileRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!profileRow) return new Response(JSON.stringify({ error: 'User profile not found' }), { status: 404, headers: corsHeaders });
    const ownerId = profileRow.id;

    const {
      list_id,
      raw_rows,          // array of raw row objects from parsed CSV/XLSX
      transforms = [] as AllowedTransform[],
      preview_only = false,
    } = await req.json();

    if (!list_id) return new Response(JSON.stringify({ error: 'list_id required' }), { status: 400, headers: corsHeaders });
    if (!Array.isArray(raw_rows)) return new Response(JSON.stringify({ error: 'raw_rows must be array' }), { status: 400, headers: corsHeaders });

    // Verify list ownership
    const { data: list } = await supabase.from('outreach_contact_lists')
      .select('id,owner_id').eq('id', list_id).eq('owner_id', ownerId).maybeSingle();
    if (!list) return new Response(JSON.stringify({ error: 'List not found or forbidden' }), { status: 404, headers: corsHeaders });

    // Normalize headers
    const normalizedRows: Record<string, unknown>[] = raw_rows.map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        const normKey = normalizeHeader(k);
        out[normKey] = v;
      }
      // Reconstruct full_name if only first+last
      if (!out.full_name && (out.first_name || out.last_name)) {
        out.full_name = [out.first_name, out.last_name].filter(Boolean).join(' ');
      }
      return out;
    });

    // Apply allowlisted transforms
    let processedRows = normalizedRows;
    for (const transform of transforms) {
      processedRows = applyTransform(processedRows, transform);
    }

    // Normalize emails + phones, dedupe, validate
    const emailSeen = new Set<string>();
    const phoneSeen = new Set<string>();
    let validCount = 0, invalidCount = 0, dupCount = 0, missingEmail = 0, missingPhone = 0;
    const langCounts: Record<string, number> = {};
    const countryCounts: Record<string, number> = {};

    const contactRows = processedRows.map((row) => {
      const rawEmail = String(row.email ?? row.e_mail ?? '').trim();
      const rawPhone = String(row.phone ?? row.mobile ?? row.tel ?? '').trim();
      const countryHint = String(row.country ?? '').trim().toUpperCase() || undefined;

      const { email, valid: emailValid } = rawEmail ? normalizeEmail(rawEmail) : { email: null, valid: false };
      const { normalized: phone, confidence } = rawPhone ? normalizePhone(rawPhone, countryHint) : { normalized: null, confidence: 'UNRESOLVED' as const };

      // Country inference
      let country = countryHint ?? null;
      let countryInferred = false;
      if (!country && phone) {
        const inf = inferCountryFromPhone(phone);
        if (inf.country) { country = inf.country; countryInferred = true; }
      }

      // Language inference
      let language = String(row.language ?? '').trim() || null;
      let languageInferred = false;
      if (!language && country) {
        const countryLang: Record<string, string> = { GE: 'ka', RU: 'ru', TR: 'tr', IL: 'he', AE: 'ar', SA: 'ar', EG: 'ar' };
        if (countryLang[country]) { language = countryLang[country]; languageInferred = true; }
      }

      if (!rawEmail) missingEmail++;
      if (!rawPhone) missingPhone++;

      // Dedup
      const emailKey = email ?? '';
      const phoneKey = phone ?? '';
      const isDup = (emailKey && emailSeen.has(emailKey)) || (phoneKey && phoneSeen.has(phoneKey));
      if (isDup) { dupCount++; }
      else {
        if (emailKey) emailSeen.add(emailKey);
        if (phoneKey) phoneSeen.add(phoneKey);
      }

      const flags: string[] = [];
      if (rawEmail && !emailValid) flags.push('malformed_email');
      if (rawPhone && confidence === 'UNRESOLVED') flags.push('unresolvable_phone');
      if (confidence === 'LOW') flags.push('low_confidence_phone');
      if (countryInferred) flags.push('country_inferred');
      if (languageInferred) flags.push('language_inferred');

      const isValid = !isDup && (!rawEmail || emailValid);
      if (isValid) validCount++; else if (!isDup) invalidCount++;

      if (language) langCounts[language] = (langCounts[language] ?? 0) + 1;
      if (country) countryCounts[country] = (countryCounts[country] ?? 0) + 1;

      return {
        list_id,
        owner_id: ownerId,
        full_name: String(row.full_name ?? '').trim() || null,
        email,
        phone: phone,
        phone_raw: rawPhone || null,
        company: String(row.company ?? '').trim() || null,
        country,
        city: String(row.city ?? '').trim() || null,
        language,
        budget_min: row.budget_min ? parseFloat(String(row.budget_min)) || null : null,
        budget_max: row.budget_max ? parseFloat(String(row.budget_max)) || null : null,
        lead_type: String(row.lead_type ?? 'UNKNOWN').toUpperCase(),
        tags: Array.isArray(row.tags) ? row.tags : [],
        notes: String(row.notes ?? '').trim() || null,
        custom_fields: Object.fromEntries(
          Object.entries(row).filter(([k]) =>
            !['full_name','first_name','last_name','email','phone','company','country','city','language','budget_min','budget_max','lead_type','tags','notes'].includes(k)
          )
        ),
        raw_row: row,
        email_valid: rawEmail ? emailValid : null,
        phone_valid: rawPhone ? (confidence !== 'UNRESOLVED') : null,
        phone_e164_confidence: rawPhone ? confidence : null,
        country_inferred: countryInferred,
        language_inferred: languageInferred,
        is_duplicate: isDup,
        validation_flags: flags,
      };
    });

    const preview = {
      total: processedRows.length,
      valid: validCount,
      invalid: invalidCount,
      duplicates: dupCount,
      missing_email: missingEmail,
      missing_phone: missingPhone,
      languages: langCounts,
      countries: countryCounts,
      sample: contactRows.slice(0, 5),
    };

    if (preview_only) {
      return new Response(JSON.stringify({ preview }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Batch insert (non-duplicate rows first, then flag dupes)
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < contactRows.length; i += batchSize) {
      const batch = contactRows.slice(i, i + batchSize);
      const { error: insErr } = await supabase.from('outreach_contacts').insert(batch);
      if (insErr) console.error('[contact-import] insert batch error:', insErr.message);
      else inserted += batch.length;
    }

    // Update list stats
    await supabase.from('outreach_contact_lists').update({
      total_rows: processedRows.length,
      valid_rows: validCount,
      invalid_rows: invalidCount,
      duplicate_rows: dupCount,
      missing_email: missingEmail,
      missing_phone: missingPhone,
      import_status: 'READY',
      segments: Object.entries(langCounts).map(([lang, count]) => ({ name: `lang:${lang}`, count, criteria: { language: lang } })),
      updated_at: new Date().toISOString(),
    }).eq('id', list_id);

    return new Response(JSON.stringify({ preview, inserted, status: 'READY' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[contact-import] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

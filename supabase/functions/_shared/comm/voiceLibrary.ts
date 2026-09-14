// HOMATCH — the voices Homatch is allowed to speak with.
//
// WHY THERE IS A BOOTSTRAP AT ALL
//
// The library is admin-curated by design: an operator decides which of the
// provider's voices customers may choose from, which is recommended, and
// which is the default. That is the right shape and it has one bad property
// on a fresh deployment — nothing can speak until somebody signs in and
// clicks, and "the product is silent until an admin visits a settings page"
// is not a state worth shipping.
//
// So the first time a voice is needed and the library is empty, the catalogue
// is pulled and exactly ONE voice is turned on as the default. Everything
// else arrives disabled, which is the curated state the spec asks for: an
// admin still decides what customers see, they just do not have to decide it
// before the product works at all.
//
// It runs once. A library with rows in it is never re-bootstrapped, so an
// admin who disables every voice on purpose does not get them turned back on.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { listElevenLabsVoices, elevenLabsCredentialsPresent } from './elevenlabs.ts';

export interface LibrarySync {
  synced: number;
  bootstrapped: string | null;
  error: string | null;
}

/**
 * Refresh the catalogue from the provider.
 *
 * UPSERT, never replace. `enabled`, `recommended`, `is_default` and
 * `sort_order` are Homatch's decisions about a voice, not the provider's, and
 * a sync that overwrote them would undo a customer's selection every time it
 * ran.
 */
export async function syncVoiceLibrary(sb: SupabaseClient): Promise<LibrarySync> {
  if (!elevenLabsCredentialsPresent()) return { synced: 0, bootstrapped: null, error: 'MISSING' };

  const out = await listElevenLabsVoices();
  if (!out.ok || !out.data) {
    return { synced: 0, bootstrapped: null, error: out.error?.code ?? 'PROVIDER_ERROR' };
  }

  const rows = out.data.voices.filter((v) => v.voiceId).map((v) => ({
    provider: 'ELEVENLABS',
    provider_voice_id: v.voiceId,
    name: v.name || v.voiceId,
    category: v.category,
    description: v.description,
    preview_url: v.previewUrl,
    labels: v.labels,
    languages: v.languages,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  if (!rows.length) return { synced: 0, bootstrapped: null, error: 'NO_VOICES' };

  const { error } = await sb.from('voice_library_voices')
    .upsert(rows, { onConflict: 'provider,provider_voice_id', ignoreDuplicates: false });
  if (error) return { synced: 0, bootstrapped: null, error: 'STORE_FAILED' };

  return { synced: rows.length, bootstrapped: null, error: null };
}

/**
 * Make sure there is a voice to speak with, without taking the decision away.
 *
 * Returns the default voice id, bootstrapping the library only when it is
 * completely empty. The choice is deterministic — a voice that verifiably
 * covers the language being spoken, otherwise the first by name — so two
 * deployments of the same account land on the same voice and an admin
 * changing it is a real change rather than a race.
 */
export async function ensureDefaultVoice(
  sb: SupabaseClient, language: string | null,
): Promise<{ voiceId: string | null; bootstrapped: boolean; error: string | null }> {
  const { data: current } = await sb.from('voice_library_voices')
    .select('provider_voice_id')
    .eq('provider', 'ELEVENLABS').eq('is_default', true).eq('enabled', true)
    .maybeSingle();
  if (current?.provider_voice_id) {
    return { voiceId: String(current.provider_voice_id), bootstrapped: false, error: null };
  }

  const { count } = await sb.from('voice_library_voices')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'ELEVENLABS');

  // A library that has rows and no default is an admin's deliberate state:
  // they disabled the default, or they have not chosen one yet. Choosing for
  // them would be overriding a decision rather than making a first one.
  if ((count ?? 0) > 0) {
    return { voiceId: null, bootstrapped: false, error: 'NO_DEFAULT_CHOSEN' };
  }

  const sync = await syncVoiceLibrary(sb);
  if (sync.error) return { voiceId: null, bootstrapped: false, error: sync.error };

  const { data: candidates } = await sb.from('voice_library_voices')
    .select('provider_voice_id, name, languages')
    .eq('provider', 'ELEVENLABS')
    .order('name')
    .limit(200);

  const rows = candidates ?? [];
  if (!rows.length) return { voiceId: null, bootstrapped: false, error: 'NO_VOICES' };

  const code = (language ?? '').toLowerCase().split('-')[0];
  const covers = code
    ? rows.find((r) => Array.isArray(r.languages) && r.languages.some((l) => String(l).toLowerCase().startsWith(code)))
    : null;
  const chosen = covers ?? rows[0];

  const { error } = await sb.from('voice_library_voices')
    .update({ enabled: true, is_default: true, updated_at: new Date().toISOString() })
    .eq('provider', 'ELEVENLABS')
    .eq('provider_voice_id', chosen.provider_voice_id);
  if (error) return { voiceId: null, bootstrapped: false, error: 'STORE_FAILED' };

  return { voiceId: String(chosen.provider_voice_id), bootstrapped: true, error: null };
}

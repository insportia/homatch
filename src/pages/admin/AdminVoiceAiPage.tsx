// HOMATCH — the Voice AI Control Center.
//
// One screen for everything the voice stack does: which provider is leading,
// what it can actually do for this account, what it heard, what it said, what
// it cost.
//
// THE RULE THIS PAGE IS BUILT AROUND
//
// Nothing here is a claim. Every number comes back from a provider call or a
// row Homatch wrote when something really happened — the language list is the
// provider's, the character balance is the provider's, the latency is
// measured from calls that were made. Where a fact is unavailable the page
// says so instead of showing a zero, because a zero is a statement and
// "unknown" is the truth.
//
// It also never shows a control that does nothing. The pronunciation methods
// offered are the ones the current model honours; the personality dials shown
// are the ones the current model reads. A slider a provider ignores is the
// same lie as an invented number, just quieter.

import {
  AudioLines, Brain, CheckCircle2, Download, Ear, Loader2, MinusCircle, Play,
  Plus, RefreshCw, ShieldAlert, Square, Trash2, Upload, XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { TalkCostPanel } from '@/components/admin/TalkCostPanel';
import { VoiceAudition } from '@/components/admin/VoiceAudition';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type {
  KeytermSelection, LibraryVoice, PersonalityProfile, 
  PronunciationRule, ProviderModel, ProviderRoute,UsageGroup, VocabularyRow, VoiceOverview,
} from '@/services/voiceAi';
import {
  approvePronunciation, audioUrlFromBase64, deletePronunciation, deleteVocabularyTerm,
  exportVocabulary, getPersonality, getVoiceModels, getVoiceOverview, getVoiceUsage,
  importVocabulary, listLibraryVoices, listPronunciation, listRoutes, listVocabulary,
  previewKeyterms, previewLibraryVoice, previewPronunciation, savePersonality,
  savePronunciation, saveRoute, saveVocabularyTerm, setVoiceFlags, syncVoiceLibrary,
} from '@/services/voiceAi';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
const k = (s: string) => s as TKey;

/** Languages the previews and filters offer. The provider decides what it can actually speak. */
const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

/**
 * The technical voice tooling.
 *
 * `embedded` is set when this renders inside the AI & communication
 * centre, which supplies its own page heading. Without it the page would
 * carry two h1 elements, and a screen reader would be told the page has
 * two titles -- which is the kind of thing that survives a redesign
 * because it is invisible to everyone who can see.
 */
export default function AdminVoiceAiPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('overview');

  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <h1 className="text-xl font-bold">{t(k('voice_ai_title'))}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t(k('voice_ai_subtitle'))}</p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="inline-flex w-auto">
            <TabsTrigger value="overview" className="text-xs">{t(k('voice_ai_tab_overview'))}</TabsTrigger>
            <TabsTrigger value="stt" className="text-xs">{t(k('voice_ai_tab_stt'))}</TabsTrigger>
            <TabsTrigger value="brain" className="text-xs">{t(k('voice_ai_tab_brain'))}</TabsTrigger>
            <TabsTrigger value="voices" className="text-xs">{t(k('voice_ai_tab_voices'))}</TabsTrigger>
            <TabsTrigger value="audition" className="text-xs">{t(k('voice_ai_tab_audition'))}</TabsTrigger>
            <TabsTrigger value="vocabulary" className="text-xs">{t(k('voice_ai_tab_vocabulary'))}</TabsTrigger>
            <TabsTrigger value="pronunciation" className="text-xs">{t(k('voice_ai_tab_pronunciation'))}</TabsTrigger>
            <TabsTrigger value="personality" className="text-xs">{t(k('voice_ai_tab_personality'))}</TabsTrigger>
            <TabsTrigger value="failover" className="text-xs">{t(k('voice_ai_tab_failover'))}</TabsTrigger>
            <TabsTrigger value="usage" className="text-xs">{t(k('voice_ai_tab_usage'))}</TabsTrigger>
            <TabsTrigger value="cost" className="text-xs">{t(k('voice_ai_tab_cost'))}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-3"><OverviewTab /></TabsContent>
        <TabsContent value="stt" className="mt-3"><SpeechTab /></TabsContent>
        <TabsContent value="brain" className="mt-3"><BrainTab /></TabsContent>
        <TabsContent value="voices" className="mt-3"><VoicesTab /></TabsContent>
        <TabsContent value="audition" className="mt-3"><VoiceAudition /></TabsContent>
        <TabsContent value="vocabulary" className="mt-3"><VocabularyTab /></TabsContent>
        <TabsContent value="pronunciation" className="mt-3"><PronunciationTab /></TabsContent>
        <TabsContent value="personality" className="mt-3"><PersonalityTab /></TabsContent>
        <TabsContent value="failover" className="mt-3"><FailoverTab /></TabsContent>
        <TabsContent value="usage" className="mt-3"><UsageTab /></TabsContent>
        <TabsContent value="cost" className="mt-3"><TalkCostPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Small shared pieces ─────────────────────────────────────────────────────

function Stat({ label, value, hint, tone }: {
  label: string; value: React.ReactNode; hint?: string | null;
  tone?: 'good' | 'bad' | 'warn';
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[13px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-lg font-semibold tabular-nums',
        tone === 'good' && 'text-green-600 dark:text-green-400',
        tone === 'bad' && 'text-destructive',
        tone === 'warn' && 'text-amber-600 dark:text-amber-400',
      )}>{value}</p>
      {hint ? <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * "Unknown" rather than zero.
 *
 * A provider that has not told us a number has not told us it is zero, and a
 * dashboard that renders the difference as 0 invents a fact.
 */
function Num({ value }: { value: number | null | undefined }) {
  const { t } = useLanguage();
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">{t(k('voice_ai_unknown'))}</span>;
  }
  return <>{value.toLocaleString()}</>;
}

let currentClip: HTMLAudioElement | null = null;

/**
 * Play one clip, and only one.
 *
 * A clip somebody STOPPED, or navigated away from, is not a failure. The
 * first version reported it as one, so switching tabs while a voice was
 * playing left an error toast on screen about audio that had worked
 * perfectly. Tearing down an element mid-play can surface as an error event
 * or as a rejected play() promise, so the intent is tracked rather than
 * inferred: once we have stopped wanting this clip, nothing it does is news.
 */
function useClipPlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const wanted = useRef<string | null>(null);

  const stop = useCallback(() => {
    wanted.current = null;
    currentClip?.pause();
    currentClip = null;
    setPlayingId(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback((id: string, url: string, onError?: () => void) => {
    currentClip?.pause();
    const audio = new Audio(url);
    currentClip = audio;
    wanted.current = id;

    const done = () => {
      if (wanted.current === id) wanted.current = null;
      currentClip = null;
      setPlayingId(null);
    };
    const failed = () => {
      const report = wanted.current === id;
      done();
      if (report) onError?.();
    };

    audio.onended = done;
    audio.onerror = failed;
    setPlayingId(id);
    void audio.play().catch(failed);
  }, []);

  return { playingId, play, stop };
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab() {
  const { t } = useLanguage();
  const [data, setData] = useState<VoiceOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getVoiceOverview().then(setData).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  if (!data?.ok) {
    return <Alert><AlertDescription className="text-xs">{t(k('voice_ai_load_failed'))}</AlertDescription></Alert>;
  }

  const el = data.elevenLabs;
  const healthy = el.status === 'HEALTHY';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {healthy
            ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
            : <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />}
          <span className="text-sm font-semibold">ElevenLabs</span>
          <span className="text-sm text-muted-foreground">{el.status}</span>
          {el.tier ? <Badge variant="outline" className="text-[13px] uppercase">{el.tier}</Badge> : null}
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
          {t(k('voice_ai_refresh'))}
        </Button>
      </div>

      {el.detail && !healthy ? (
        <Alert><AlertDescription className="text-xs">{el.detail}</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t(k('voice_ai_stat_voices'))} value={<Num value={el.voiceCount} />} />
        <Stat label={t(k('voice_ai_stat_models'))} value={<Num value={el.modelCount} />} />
        <Stat
          label={t(k('voice_ai_stat_characters'))}
          value={<Num value={el.charactersRemaining} />}
          hint={el.charactersLimit ? `${t(k('voice_ai_stat_of'))} ${el.charactersLimit.toLocaleString()}` : null}
          tone={typeof el.charactersRemaining === 'number' && el.charactersRemaining < 5000 ? 'warn' : undefined}
        />
        <Stat
          label={t(k('voice_ai_stat_realtime'))}
          value={el.canMintRealtimeToken ? t(k('voice_ai_yes')) : t(k('voice_ai_no'))}
          hint={t(k('voice_ai_stat_realtime_hint'))}
          tone={el.canMintRealtimeToken ? 'good' : 'bad'}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {['STT', 'TTS', 'LLM'].map((role) => (
          <Stat
            key={role}
            label={`${role} ${t(k('voice_ai_stat_latency'))}`}
            value={data.latencyMedianMs[role] ? `${data.latencyMedianMs[role]} ms` : <Num value={null} />}
            hint={t(k('voice_ai_stat_latency_hint'))}
          />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_credentials'))}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {/*
              * Present or absent. Never the value, never a prefix, never a
              * length — a masked secret is still a secret being described.
              */}
            {data.credentials.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{c.name}</span>
                {c.present
                  ? <Badge className="bg-green-100 text-[13px] text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400">{t(k('voice_ai_present'))}</Badge>
                  : <Badge variant="outline" className="text-[13px]">{t(k('voice_ai_absent'))}</Badge>}
              </div>
            ))}
            <p className="pt-1 text-[13px] text-muted-foreground">{t(k('voice_ai_credentials_hint'))}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_configured'))}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t(k('voice_ai_default_voice'))}</span>
              <span className="font-medium">
                {data.defaultVoice?.name ?? <span className="text-muted-foreground">{t(k('voice_ai_none'))}</span>}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t(k('voice_ai_vocabulary_size'))}</span>
              <span className="font-medium tabular-nums">{data.vocabularyCount.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t(k('voice_ai_last_session'))}</span>
              <span className="font-medium">
                {data.lastSession
                  ? `${data.lastSession.state} · ${data.lastSession.turns ?? 0} ${t(k('voice_ai_turns'))}`
                  : <span className="text-muted-foreground">{t(k('voice_ai_none'))}</span>}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_recent_calls'))}</CardTitle></CardHeader>
        <CardContent>
          {!data.recentUsage.length ? (
            <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_calls'))}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[13px] uppercase text-muted-foreground">
                  <tr className="text-start">
                    <th className="py-1 text-start font-medium">{t(k('voice_ai_col_when'))}</th>
                    <th className="py-1 text-start font-medium">{t(k('voice_ai_col_provider'))}</th>
                    <th className="py-1 text-start font-medium">{t(k('voice_ai_col_role'))}</th>
                    <th className="py-1 text-start font-medium">{t(k('voice_ai_col_model'))}</th>
                    <th className="py-1 text-end font-medium">{t(k('voice_ai_col_latency'))}</th>
                    <th className="py-1 text-end font-medium">{t(k('voice_ai_col_result'))}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentUsage.map((u, i) => (
                    <tr key={`${u.occurred_at}-${i}`} className="border-t">
                      <td className="py-1 text-muted-foreground">{new Date(u.occurred_at).toLocaleTimeString()}</td>
                      <td className="py-1">{u.provider}</td>
                      <td className="py-1">{u.role}</td>
                      <td className="py-1 font-mono text-[13px] text-muted-foreground">{u.model ?? '—'}</td>
                      <td className="py-1 text-end tabular-nums">{u.latency_ms ?? '—'}</td>
                      <td className="py-1 text-end">
                        {u.ok
                          ? <span className="text-green-600 dark:text-green-400">OK</span>
                          : <span className="text-destructive">{u.error_code ?? u.provider_status ?? 'FAIL'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Speech recognition ──────────────────────────────────────────────────────

/**
 * What the transcriber is told, and what it is deliberately not told.
 *
 * The corpus is over a thousand terms and the provider takes a few dozen, so
 * a selection happens on every session. This tab exists so an operator can
 * see that selection for a context they describe — the same function the live
 * session calls, with the same limits, so it is an answer rather than an
 * illustration.
 */
function SpeechTab() {
  const { t } = useLanguage();
  const [routes, setRoutes] = useState<ProviderRoute[]>([]);
  const [language, setLanguage] = useState('ka');
  const [feature, setFeature] = useState('AI_TALK');
  const [locations, setLocations] = useState('');
  const [abusive, setAbusive] = useState(false);
  const [result, setResult] = useState<KeytermSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const sttRoutes = routes.filter((r) => r.role === 'STT');
  const elevenRoute = sttRoutes.find((r) => r.provider === 'ELEVENLABS');
  const cfg = (elevenRoute?.config ?? {}) as Record<string, unknown>;
  const maxTerms = Number(cfg.max_keyterms) || null;
  const maxChars = Number(cfg.max_keyterm_chars) || null;

  const [termsDraft, setTermsDraft] = useState('');
  const [charsDraft, setCharsDraft] = useState('');

  const load = useCallback(async () => {
    const r = await listRoutes();
    setRoutes(r?.routes ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setTermsDraft(maxTerms ? String(maxTerms) : '');
    setCharsDraft(maxChars ? String(maxChars) : '');
  }, [maxTerms, maxChars]);

  const run = useCallback(async () => {
    setBusy(true);
    const out = await previewKeyterms({
      language,
      feature,
      locations: locations.split(',').map((s) => s.trim()).filter(Boolean),
      abusiveContext: abusive,
    });
    setResult(out);
    setBusy(false);
  }, [language, feature, locations, abusive]);

  const saveLimits = useCallback(async () => {
    if (!elevenRoute?.id) return;
    setSaving(true);
    const out = await saveRoute({
      id: elevenRoute.id,
      config: {
        max_keyterms: Number(termsDraft) || null,
        max_keyterm_chars: Number(charsDraft) || null,
      },
    });
    setSaving(false);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    toast.success(t(k('voice_ai_saved')));
    await load();
  }, [elevenRoute?.id, termsDraft, charsDraft, load, t]);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Ear className="h-4 w-4" aria-hidden="true" />
            {t(k('voice_ai_stt_limits'))}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/*
            * Configurable, because a provider limit is the provider's to
            * change. Hard-coding today's number is how an integration quietly
            * stops using half of what it is allowed.
            */}
          <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_stt_limits_hint'))}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_max_terms'))}</span>
              <Input
                value={termsDraft} onChange={(e) => setTermsDraft(e.target.value)}
                inputMode="numeric" className="mt-1 h-8 w-28 text-xs"
                placeholder={t(k('voice_ai_provider_default'))}
              />
            </label>
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_max_chars'))}</span>
              <Input
                value={charsDraft} onChange={(e) => setCharsDraft(e.target.value)}
                inputMode="numeric" className="mt-1 h-8 w-28 text-xs"
                placeholder={t(k('voice_ai_provider_default'))}
              />
            </label>
            <Button size="sm" className="h-8" onClick={() => void saveLimits()} disabled={saving || !elevenRoute?.id}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : t(k('voice_ai_save'))}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_keyterm_preview'))}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_keyterm_preview_hint'))}</p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_language'))}</span>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="mt-1 h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_feature'))}</span>
              <Input value={feature} onChange={(e) => setFeature(e.target.value)} className="mt-1 h-8 w-36 text-xs" />
            </label>
            <label className="min-w-[180px] flex-1 text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_locations'))}</span>
              <Input
                value={locations} onChange={(e) => setLocations(e.target.value)}
                className="mt-1 h-8 text-xs" placeholder={t(k('voice_ai_locations_placeholder'))}
              />
            </label>
            <Button size="sm" className="h-8" onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : t(k('voice_ai_run'))}
            </Button>
          </div>

          {/*
            * The abuse lexicon is not a permanent keyterm set and this toggle
            * is why the switch exists at all: sending a profanity list to a
            * transcriber biases it toward hearing profanity. It becomes
            * eligible only inside a session that has already contained abuse.
            */}
          <label className="flex items-start gap-2 rounded-lg border p-2.5">
            <Switch checked={abusive} onCheckedChange={setAbusive} className="mt-0.5" />
            <span className="text-xs">
              <span className="block font-medium">{t(k('voice_ai_abusive_context'))}</span>
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_abusive_context_hint'))}</span>
            </span>
          </label>

          {result?.ok ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  {t(k('voice_ai_selected_count'))
                    .replace('{n}', String(result.selected.length))
                    .replace('{max}', String(result.limits.maxTerms))}
                </Badge>
                <Badge variant="outline">
                  {t(k('voice_ai_considered_count')).replace('{n}', String(result.considered))}
                </Badge>
                <Badge variant="outline">
                  {t(k('voice_ai_max_chars'))}: {result.limits.maxCharsPerTerm}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-1">
                {result.selected.map((s) => (
                  <span
                    key={s.id}
                    title={s.reasons.join(', ')}
                    className="rounded-md border px-1.5 py-0.5 text-[13px]"
                  >
                    {s.term}
                  </span>
                ))}
              </div>

              {result.dropped.length ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t(k('voice_ai_dropped')).replace('{n}', String(result.dropped.length))}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-[13px] text-muted-foreground">
                    {result.dropped.map((d, i) => (
                      <li key={`${d.term}-${i}`}>{d.term} — {d.reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Brain ───────────────────────────────────────────────────────────────────

function BrainTab() {
  const { t } = useLanguage();
  const [routes, setRoutes] = useState<ProviderRoute[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listRoutes();
    setRoutes(r?.routes ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const brain = routes.filter((r) => r.role === 'ORCHESTRATOR' || r.role === 'LLM');

  if (loading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4" aria-hidden="true" />
          {t(k('voice_ai_brain_title'))}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_brain_hint'))}</p>
        {!brain.length ? (
          <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_routes'))}</p>
        ) : brain.map((r) => <RouteRow key={r.id ?? `${r.role}-${r.provider}`} route={r} onChanged={load} />)}
      </CardContent>
    </Card>
  );
}

// ── Voice library ───────────────────────────────────────────────────────────

function VoicesTab() {
  const { t } = useLanguage();
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('ka');
  const [busyVoice, setBusyVoice] = useState<string | null>(null);
  const { playingId, play, stop } = useClipPlayer();
  const clips = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    const out = await listLibraryVoices();
    setVoices(out?.voices ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sync = useCallback(async () => {
    setSyncing(true);
    const out = await syncVoiceLibrary();
    setSyncing(false);
    if (!out?.ok) { toast.error(out?.reason ?? t(k('voice_ai_sync_failed'))); return; }
    toast.success(t(k('voice_ai_synced')).replace('{n}', String(out.synced ?? 0)));
    await load();
  }, [load, t]);

  const flag = useCallback(async (voiceId: string, patch: Parameters<typeof setVoiceFlags>[1]) => {
    setBusyVoice(voiceId);
    const out = await setVoiceFlags(voiceId, patch);
    setBusyVoice(null);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    await load();
  }, [load, t]);

  const preview = useCallback(async (voiceId: string) => {
    const key = `${voiceId}:${language}`;
    if (playingId === key) { stop(); return; }

    const cached = clips.current.get(key);
    if (cached) { play(key, cached, () => toast.error(t(k('voice_ai_preview_failed')))); return; }

    setBusyVoice(voiceId);
    const out = await previewLibraryVoice(voiceId, language);
    setBusyVoice(null);
    if (!out?.ok || !out.audioBase64) {
      // The provider's own refusal, named. An outage and a defect look
      // identical from a toast that just says it failed.
      toast.error(`${t(k('voice_ai_preview_failed'))}${out?.reason ? ` — ${out.reason}` : ''}`);
      return;
    }
    const url = audioUrlFromBase64(out.audioBase64, out.mime ?? 'audio/mpeg');
    if (!url) { toast.error(t(k('voice_ai_preview_failed'))); return; }
    clips.current.set(key, url);
    play(key, url, () => toast.error(t(k('voice_ai_preview_failed'))));
  }, [language, play, playingId, stop, t]);

  const needle = search.trim().toLowerCase();
  const shown = voices.filter((v) => !needle
    || v.name.toLowerCase().includes(needle)
    || (v.description ?? '').toLowerCase().includes(needle));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_library_hint'))}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t(k('voice_ai_search'))} className="h-8 w-40 text-xs"
          />
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void sync()} disabled={syncing}>
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} aria-hidden="true" />
            {t(k('voice_ai_sync'))}
          </Button>
        </div>
      </div>

      {loading ? <Skeleton className="h-64 w-full" /> : !voices.length ? (
        <Alert><AlertDescription className="text-xs">{t(k('voice_ai_library_empty'))}</AlertDescription></Alert>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((v) => (
            <li key={v.voiceId} className="rounded-xl border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void preview(v.voiceId)}
                  disabled={busyVoice === v.voiceId}
                  aria-label={t(k('voice_ai_play'))}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {busyVoice === v.voiceId
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : playingId === `${v.voiceId}:${language}`
                    ? <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {v.name}
                    {v.isDefault ? (
                      <Badge className="ms-1.5 bg-gold/15 text-[13px] text-gold hover:bg-gold/15">
                        {t(k('voice_ai_default'))}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {v.description || v.category || v.voiceId}
                  </p>
                  {v.languages?.length ? (
                    <p className="mt-0.5 truncate text-[13px] uppercase text-muted-foreground">
                      {v.languages.slice(0, 8).join(' · ')}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[13px]">
                    <Switch
                      checked={v.recommended}
                      onCheckedChange={(on) => void flag(v.voiceId, { recommended: on })}
                    />
                    {t(k('voice_ai_recommended'))}
                  </label>
                  <Button
                    variant={v.isDefault ? 'secondary' : 'outline'} size="sm" className="h-7 text-[13px]"
                    disabled={v.isDefault}
                    onClick={() => void flag(v.voiceId, { isDefault: true })}
                  >
                    {t(k('voice_ai_make_default'))}
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-7 text-[13px] text-muted-foreground"
                    onClick={() => void flag(v.voiceId, { enabled: false })}
                    disabled={v.isDefault}
                  >
                    {t(k('voice_ai_disable'))}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_library_disabled_hint'))}</p>
    </div>
  );
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

function VocabularyTab() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<VocabularyRow[]>([]);
  const [categories, setCategories] = useState<Array<{ name: string; count: number }>>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ term: '', category: 'custom', languageHint: 'ka', priority: 50, providerEligible: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const out = await listVocabulary({
      search: search.trim() || undefined,
      category: category === 'ALL' ? undefined : category,
      limit: 300,
    });
    setRows(out?.terms ?? []);
    if (out?.categories) setCategories(out.categories);
    setLoading(false);
  }, [search, category]);

  useEffect(() => {
    const id = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(id);
  }, [load]);

  const add = useCallback(async () => {
    if (!draft.term.trim()) return;
    const out = await saveVocabularyTerm(draft);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    setDraft((d) => ({ ...d, term: '' }));
    setAdding(false);
    await load();
  }, [draft, load, t]);

  const remove = useCallback(async (id: string) => {
    const out = await deleteVocabularyTerm(id);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    await load();
  }, [load, t]);

  const toggleEligible = useCallback(async (row: VocabularyRow) => {
    const out = await saveVocabularyTerm({
      id: row.id, term: row.term, category: row.category,
      languageHint: row.language_hint, scope: row.scope, priority: row.priority,
      enabled: row.enabled, providerEligible: !row.provider_eligible, notes: row.notes,
    });
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    await load();
  }, [load, t]);

  const doExport = useCallback(async () => {
    const out = await exportVocabulary();
    if (!out?.ok) { toast.error(t(k('voice_ai_export_failed'))); return; }
    const url = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `homatch-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [t]);

  const doImport = useCallback(async (file: File) => {
    const csv = await file.text();
    const out = await importVocabulary(csv);
    if (!out?.ok) { toast.error(out?.reason ?? t(k('voice_ai_import_failed'))); return; }
    toast.success(t(k('voice_ai_imported'))
      .replace('{n}', String(out.inserted ?? 0))
      .replace('{skipped}', String(out.skipped ?? 0)));
    await load();
  }, [load, t]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t(k('voice_ai_search'))} className="h-8 w-44 text-xs"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t(k('voice_ai_all_categories'))}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name} ({c.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t(k('voice_ai_add_term'))}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {t(k('voice_ai_import'))}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void doExport()}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {t(k('voice_ai_export'))}
        </Button>
        <input
          ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {adding ? (
        <Card><CardContent className="flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs">
            <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_term'))}</span>
            <Input
              value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })}
              className="mt-1 h-8 w-48 text-xs" maxLength={120}
            />
          </label>
          <label className="text-xs">
            <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_category'))}</span>
            <Input
              value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className="mt-1 h-8 w-40 text-xs" maxLength={60}
            />
          </label>
          <label className="text-xs">
            <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_language'))}</span>
            <Select value={draft.languageHint} onValueChange={(v) => setDraft({ ...draft, languageHint: v })}>
              <SelectTrigger className="mt-1 h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs">
            <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_priority'))}</span>
            <Input
              value={String(draft.priority)} inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
              className="mt-1 h-8 w-20 text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 pb-1 text-[13px]">
            <Switch
              checked={draft.providerEligible}
              onCheckedChange={(on) => setDraft({ ...draft, providerEligible: on })}
            />
            {t(k('voice_ai_keyterm_candidate'))}
          </label>
          <Button size="sm" className="h-8" onClick={() => void add()}>{t(k('voice_ai_save'))}</Button>
        </CardContent></Card>
      ) : null}

      <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_vocabulary_hint'))}</p>

      {loading ? <Skeleton className="h-64 w-full" /> : !rows.length ? (
        <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_terms'))}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[13px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-start font-medium">{t(k('voice_ai_term'))}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t(k('voice_ai_category'))}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t(k('voice_ai_language'))}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t(k('voice_ai_priority'))}</th>
                <th className="px-2 py-1.5 text-center font-medium">{t(k('voice_ai_keyterm_candidate'))}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1.5">{r.term}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r.category}</td>
                  <td className="px-2 py-1.5 uppercase text-muted-foreground">{r.language_hint ?? '—'}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{r.priority}</td>
                  <td className="px-2 py-1.5 text-center">
                    <Switch checked={r.provider_eligible} onCheckedChange={() => void toggleEligible(r)} />
                  </td>
                  <td className="px-2 py-1.5 text-end">
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground"
                      aria-label={t(k('voice_ai_delete'))}
                      onClick={() => void remove(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Pronunciation ───────────────────────────────────────────────────────────

/**
 * How Homatch says a word, which is a different problem from hearing it.
 *
 * A rule cannot go live until somebody has listened to the result — the
 * database enforces it and so does this screen. There is no save-and-enable
 * button, because approving audio you have not heard is the failure mode this
 * whole flow exists to prevent.
 */
function PronunciationTab() {
  const { t } = useLanguage();
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    term: 'Homatch', value: '', method: 'alias', language: 'ka', alphabet: 'ipa',
  });
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [clips, setClips] = useState<{ before: string | null; after: string | null; dictionary: { id: string; versionId: string } | null }>({
    before: null, after: null, dictionary: null,
  });
  const { playingId, play, stop } = useClipPlayer();

  const load = useCallback(async () => {
    setLoading(true);
    const out = await listPronunciation();
    setRules(out?.rules ?? []);
    setMethods(out?.methods ?? []);
    setModel(out?.model ?? '');
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const hear = useCallback(async () => {
    const text = sentence.trim() || draft.term;
    if (!text) return;
    setBusy(true);
    const out = await previewPronunciation({
      text, term: draft.term, value: draft.value, method: draft.method,
      alphabet: draft.alphabet, language: draft.language,
    });
    setBusy(false);
    if (!out?.ok) {
      toast.error(`${t(k('voice_ai_preview_failed'))}${out?.reason ? ` — ${out.reason}` : ''}`);
      return;
    }
    setClips({
      before: out.before ? audioUrlFromBase64(out.before.audioBase64, out.before.mime) : null,
      after: out.after ? audioUrlFromBase64(out.after.audioBase64, out.after.mime) : null,
      dictionary: out.dictionary,
    });
  }, [draft, sentence, t]);

  const saveAndApprove = useCallback(async () => {
    if (!draft.term.trim() || !draft.value.trim()) return;
    if (!clips.after) { toast.error(t(k('voice_ai_hear_first'))); return; }

    const saved = await savePronunciation(draft);
    if (!saved?.ok || !saved.id) { toast.error(t(k('voice_ai_save_failed'))); return; }

    const ok = await approvePronunciation({
      id: saved.id,
      enabled: true,
      dictionaryId: clips.dictionary?.id ?? null,
      versionId: clips.dictionary?.versionId ?? null,
    });
    if (!ok?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    toast.success(t(k('voice_ai_rule_live')));
    setClips({ before: null, after: null, dictionary: null });
    await load();
  }, [clips, draft, load, t]);

  const remove = useCallback(async (id: string) => {
    const out = await deletePronunciation(id);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    await load();
  }, [load, t]);

  const clipButton = (id: string, url: string | null, label: string) => (
    <Button
      variant="outline" size="sm" className="h-8 gap-1.5"
      disabled={!url}
      onClick={() => {
        if (!url) return;
        if (playingId === id) { stop(); return; }
        play(id, url, () => toast.error(t(k('voice_ai_preview_failed'))));
      }}
    >
      {playingId === id
        ? <Square className="h-3.5 w-3.5" aria-hidden="true" />
        : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </Button>
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_pronunciation_new'))}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_pronunciation_hint'))}</p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_term'))}</span>
              <Input
                value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })}
                className="mt-1 h-8 w-40 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_method'))}</span>
              <Select value={draft.method} onValueChange={(v) => setDraft({ ...draft, method: v })}>
                <SelectTrigger className="mt-1 h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* Only what THIS model honours. A phoneme rule silently
                      ignored is worse than one refused. */}
                  {(methods.length ? methods : ['alias']).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-[160px] flex-1 text-xs">
              <span className="block text-[13px] text-muted-foreground">
                {draft.method === 'phoneme' ? t(k('voice_ai_phoneme')) : t(k('voice_ai_alias'))}
              </span>
              <Input
                value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                className="mt-1 h-8 text-xs"
                placeholder={draft.method === 'phoneme' ? 'ˈhoʊmætʃ' : 'Ho-match'}
              />
            </label>
            <label className="text-xs">
              <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_language'))}</span>
              <Select value={draft.language} onValueChange={(v) => setDraft({ ...draft, language: v })}>
                <SelectTrigger className="mt-1 h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="block text-xs">
            <span className="block text-[13px] text-muted-foreground">{t(k('voice_ai_test_sentence'))}</span>
            <Textarea
              value={sentence} onChange={(e) => setSentence(e.target.value)}
              rows={2} maxLength={300} className="mt-1 text-xs"
              placeholder={t(k('voice_ai_test_sentence_placeholder'))}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8 gap-1.5" onClick={() => void hear()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />}
              {t(k('voice_ai_hear_both'))}
            </Button>
            {clipButton('before', clips.before, t(k('voice_ai_before')))}
            {clipButton('after', clips.after, t(k('voice_ai_after')))}
            <Button
              size="sm" className="h-8" variant="secondary"
              onClick={() => void saveAndApprove()}
              disabled={!clips.after}
            >
              {t(k('voice_ai_approve_and_enable'))}
            </Button>
          </div>
          {!clips.after ? (
            <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_approve_blocked'))}</p>
          ) : null}
          {model ? (
            <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_current_model'))}: <span className="font-mono">{model}</span></p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_pronunciation_rules'))}</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : !rules.length ? (
            <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_rules'))}</p>
          ) : (
            <ul className="space-y-1.5">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs">
                  <span className="font-medium">{r.term}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-[13px]">{r.value}</span>
                  <Badge variant="outline" className="text-[13px]">{r.method}</Badge>
                  {r.language ? <Badge variant="outline" className="text-[13px] uppercase">{r.language}</Badge> : null}
                  {r.approved_at && r.enabled
                    ? <Badge className="bg-green-100 text-[13px] text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400">{t(k('voice_ai_live'))}</Badge>
                    : <Badge variant="outline" className="text-[13px]">{t(k('voice_ai_awaiting_approval'))}</Badge>}
                  <span className="flex-1" />
                  <Button
                    variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground"
                    aria-label={t(k('voice_ai_delete'))}
                    onClick={() => void remove(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Personality ─────────────────────────────────────────────────────────────

const DIALS: Array<{ key: keyof PersonalityProfile; labelKey: string; min: number; max: number; step: number }> = [
  { key: 'brevity', labelKey: 'voice_ai_dial_brevity', min: 0, max: 100, step: 1 },
  { key: 'warmth', labelKey: 'voice_ai_dial_warmth', min: 0, max: 100, step: 1 },
  { key: 'formality', labelKey: 'voice_ai_dial_formality', min: 0, max: 100, step: 1 },
  { key: 'sales_intensity', labelKey: 'voice_ai_dial_sales', min: 0, max: 100, step: 1 },
  { key: 'proactivity', labelKey: 'voice_ai_dial_proactivity', min: 0, max: 100, step: 1 },
  { key: 'confirmation', labelKey: 'voice_ai_dial_confirmation', min: 0, max: 100, step: 1 },
  { key: 'interruption_sensitivity', labelKey: 'voice_ai_dial_interruption', min: 0, max: 100, step: 1 },
  { key: 'speaking_rate', labelKey: 'voice_ai_dial_rate', min: 0.5, max: 2, step: 0.05 },
];

const PROVIDER_DIALS: Array<{ key: keyof PersonalityProfile; labelKey: string; supports: string }> = [
  { key: 'stability', labelKey: 'voice_ai_dial_stability', supports: 'stability' },
  { key: 'similarity_boost', labelKey: 'voice_ai_dial_similarity', supports: 'similarityBoost' },
  { key: 'style', labelKey: 'voice_ai_dial_style', supports: 'style' },
];

function PersonalityTab() {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<PersonalityProfile | null>(null);
  const [supports, setSupports] = useState<Record<string, boolean>>({});
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const out = await getPersonality();
    setProfile(out?.profile ?? null);
    setSupports(out?.supports ?? {});
    setModel(out?.model ?? '');
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    const out = await savePersonality({
      brevity: profile.brevity, warmth: profile.warmth, formality: profile.formality,
      salesIntensity: profile.sales_intensity, proactivity: profile.proactivity,
      confirmation: profile.confirmation, interruptionSensitivity: profile.interruption_sensitivity,
      speakingRate: profile.speaking_rate, stability: profile.stability,
      similarityBoost: profile.similarity_boost, style: profile.style,
      useSpeakerBoost: profile.use_speaker_boost, extraInstructions: profile.extra_instructions,
    });
    setSaving(false);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    toast.success(t(k('voice_ai_saved')));
  }, [profile, t]);

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!profile) {
    return <Alert><AlertDescription className="text-xs">{t(k('voice_ai_no_personality'))}</AlertDescription></Alert>;
  }

  const set = (key: keyof PersonalityProfile, value: number | boolean | string | null) =>
    setProfile({ ...profile, [key]: value } as PersonalityProfile);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_personality_title'))}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_personality_hint'))}</p>

          {DIALS.map((d) => (
            <label key={String(d.key)} className="block">
              <span className="flex items-center justify-between text-xs">
                <span className="font-medium">{t(k(d.labelKey))}</span>
                <span className="tabular-nums text-muted-foreground">{Number(profile[d.key] ?? 0)}</span>
              </span>
              <Slider
                className="mt-1.5"
                min={d.min} max={d.max} step={d.step}
                value={[Number(profile[d.key] ?? 0)]}
                onValueChange={([v]) => set(d.key, v)}
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_provider_dials'))}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/*
            * Only the dials THIS model reads. A slider a provider ignores is
            * the same lie as an invented number, and the account's current
            * model is what decides — not a table written when the page was.
            */}
          <p className="text-[13px] text-muted-foreground">
            {t(k('voice_ai_provider_dials_hint'))} <span className="font-mono">{model}</span>
          </p>
          {PROVIDER_DIALS.filter((d) => supports[d.supports]).map((d) => {
            const value = profile[d.key] as number | null;
            return (
              <label key={String(d.key)} className="block">
                <span className="flex items-center justify-between text-xs">
                  <span className="font-medium">{t(k(d.labelKey))}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {value === null ? t(k('voice_ai_provider_default')) : value.toFixed(2)}
                  </span>
                </span>
                <Slider
                  className="mt-1.5"
                  min={0} max={1} step={0.01}
                  value={[value ?? 0.5]}
                  onValueChange={([v]) => set(d.key, v)}
                />
              </label>
            );
          })}
          {supports.speakerBoost ? (
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={profile.use_speaker_boost === true}
                onCheckedChange={(on) => set('use_speaker_boost', on)}
              />
              {t(k('voice_ai_dial_speaker_boost'))}
            </label>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_extra_instructions'))}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={profile.extra_instructions ?? ''}
            onChange={(e) => set('extra_instructions', e.target.value)}
            rows={5} maxLength={1200} className="text-xs"
          />
          <Button size="sm" className="h-8" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : t(k('voice_ai_save'))}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Failover ────────────────────────────────────────────────────────────────

function RouteRow({ route, onChanged }: { route: ProviderRoute; onChanged: () => void | Promise<void> }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  // §R keeps outbound telephony fail-closed. A kill switch may be raised from
  // here and never lowered, and the server refuses too — this only stops the
  // control from pretending otherwise.
  const protectedRole = route.role === 'TELEPHONY' || route.role === 'WHATSAPP_CALL';

  const patch = useCallback(async (p: Parameters<typeof saveRoute>[0]) => {
    if (!route.id) return;
    setBusy(true);
    const out = await saveRoute({ ...p, id: route.id });
    setBusy(false);
    if (!out?.ok) {
      toast.error(out?.reason === 'KILL_SWITCH_PROTECTED'
        ? t(k('voice_ai_kill_switch_protected'))
        : t(k('voice_ai_save_failed')));
      return;
    }
    await onChanged();
  }, [onChanged, route.id, t]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-xs">
      <Badge variant="outline" className="text-[13px]">{route.role}</Badge>
      <span className="font-medium">{route.provider}</span>
      <Badge variant="outline" className="text-[13px]">
        {t(k('voice_ai_priority'))} {route.priority}
      </Badge>
      {route.kill_switch ? (
        <Badge className="gap-1 bg-destructive/10 text-[13px] text-destructive hover:bg-destructive/10">
          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          {t(k('voice_ai_kill_switch'))}
        </Badge>
      ) : null}
      {route.last_error ? (
        <span className="truncate text-[13px] text-destructive" title={route.last_error}>
          {route.last_error.slice(0, 60)}
        </span>
      ) : route.last_success_at ? (
        <span className="text-[13px] text-muted-foreground">
          {t(k('voice_ai_last_success'))} {new Date(route.last_success_at).toLocaleString()}
        </span>
      ) : (
        <span className="text-[13px] text-muted-foreground">{t(k('voice_ai_never_used'))}</span>
      )}

      <span className="flex-1" />

      <label className="flex items-center gap-1.5 text-[13px]">
        <Switch
          checked={route.enabled}
          disabled={busy}
          onCheckedChange={(on) => void patch({ id: route.id!, enabled: on })}
        />
        {t(k('voice_ai_enabled'))}
      </label>

      {route.kill_switch && !protectedRole ? (
        <Button
          variant="outline" size="sm" className="h-7 text-[13px]"
          disabled={busy}
          onClick={() => void patch({ id: route.id!, killSwitch: false })}
        >
          {t(k('voice_ai_lower_kill_switch'))}
        </Button>
      ) : null}
      {!route.kill_switch ? (
        <Button
          variant="ghost" size="sm" className="h-7 text-[13px] text-destructive"
          disabled={busy}
          onClick={() => void patch({ id: route.id!, killSwitch: true })}
        >
          {t(k('voice_ai_raise_kill_switch'))}
        </Button>
      ) : null}
    </div>
  );
}

function FailoverTab() {
  const { t } = useLanguage();
  const [routes, setRoutes] = useState<ProviderRoute[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, m] = await Promise.all([listRoutes(), getVoiceModels()]);
    setRoutes(r?.routes ?? []);
    setModels(m?.models ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byRole = useMemo(() => {
    const map = new Map<string, ProviderRoute[]>();
    for (const r of routes) {
      if (!map.has(r.role)) map.set(r.role, []);
      map.get(r.role)!.push(r);
    }
    return [...map.entries()];
  }, [routes]);

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_failover_hint'))}</p>

      {byRole.map(([role, rs]) => (
        <Card key={role}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{role}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {rs.map((r) => <RouteRow key={r.id ?? `${role}-${r.provider}`} route={r} onChanged={load} />)}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(k('voice_ai_model_catalogue'))}</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-2 text-[13px] text-muted-foreground">{t(k('voice_ai_model_catalogue_hint'))}</p>
          {!models.length ? (
            <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_models'))}</p>
          ) : (
            <ul className="space-y-1">
              {models.map((m) => (
                <li key={m.modelId} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
                  <span className="font-mono text-[13px]">{m.modelId}</span>
                  <span className="text-muted-foreground">{m.name}</span>
                  {m.canDoTts ? <Badge variant="outline" className="text-[13px]">TTS</Badge> : null}
                  {m.canDoStt ? <Badge variant="outline" className="text-[13px]">STT</Badge> : null}
                  <span className="flex-1" />
                  <span className="text-[13px] uppercase text-muted-foreground">
                    {m.languages.length
                      ? t(k('voice_ai_language_count')).replace('{n}', String(m.languages.length))
                      : t(k('voice_ai_unknown'))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Usage ───────────────────────────────────────────────────────────────────

function UsageTab() {
  const { t } = useLanguage();
  const [days, setDays] = useState(7);
  const [groups, setGroups] = useState<UsageGroup[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getVoiceUsage(days).then((out) => {
      setGroups(out?.groups ?? []);
      setNote(out?.note ?? '');
    }).finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {/*
          * Said plainly and kept next to the numbers: a dashboard that looks
          * like an invoice becomes one in somebody's memory. Provider cost of
          * goods only — never what a customer pays.
          */}
        {/* The server sends its own version of this line for API callers;
            the screen says it in the reader's language. Same statement,
            translated, rather than English sitting inside a Georgian page. */}
        <p className="text-[13px] font-medium text-amber-700 dark:text-amber-400" title={note}>
          {t(k('voice_ai_cogs_note'))}
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 7, 30, 90].map((d) => (
              <SelectItem key={d} value={String(d)}>
                {t(k('voice_ai_days')).replace('{n}', String(d))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? <Skeleton className="h-64 w-full" /> : !groups.length ? (
        <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_usage'))}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[13px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-start font-medium">{t(k('voice_ai_col_provider'))}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t(k('voice_ai_col_role'))}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t(k('voice_ai_col_model'))}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t(k('voice_ai_col_calls'))}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t(k('voice_ai_col_failures'))}</th>
                <th className="px-2 py-1.5 text-end font-medium">P50</th>
                <th className="px-2 py-1.5 text-end font-medium">P90</th>
                <th className="px-2 py-1.5 text-end font-medium">{t(k('voice_ai_col_cogs'))}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={`${g.provider}-${g.role}-${g.model ?? ''}-${i}`} className="border-t">
                  <td className="px-2 py-1.5">{g.provider}</td>
                  <td className="px-2 py-1.5">{g.role}</td>
                  <td className="px-2 py-1.5 font-mono text-[13px] text-muted-foreground">{g.model ?? '—'}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{g.calls}</td>
                  <td className={cn('px-2 py-1.5 text-end tabular-nums', g.failures && 'text-destructive')}>
                    {g.failures}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums"><Num value={g.latencyP50Ms} /></td>
                  <td className="px-2 py-1.5 text-end tabular-nums"><Num value={g.latencyP90Ms} /></td>
                  <td className="px-2 py-1.5 text-end tabular-nums" title={g.costBasis?.join(', ') ?? ''}>
                    {g.costUsd === null
                      ? <span className="text-muted-foreground">{t(k('voice_ai_unknown'))}</span>
                      : `$${g.costUsd.toFixed(4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_cogs_hint'))}</p>
    </div>
  );
}

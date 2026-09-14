// HOMATCH — the Georgian audition.
//
// WHY THIS SCREEN EXISTS AND WHY IT HAS NO VERDICT ON IT
//
// The Georgian output sounded like an English speaker reading Georgian
// letters, and every automated check had passed. They would: the synthesis
// succeeded, the API answered 200, the audio played, the text was correct
// Georgian, and the provider's own transcriber read it back accurately —
// because an American saying Georgian words is perfectly transcribable. Not
// one of those facts is about accent, and accent was the thing that was wrong.
//
// The provider's metadata says why. Every stock voice on this account carries
// `language: en` with an american, british or australian accent. A
// multilingual MODEL renders those speakers saying Georgian words; it does not
// give them a Georgian mouth. The voice that became the Georgian default was
// picked on the widest language list in the catalogue, which is a fact about
// the model's reach and says nothing whatsoever about how the speaker sounds.
//
// So this screen generates the comparison and stops. It plays the same
// sentences in every candidate and records what produced each one. It does not
// score them, rank them, or recommend one, because the question it is asking
// cannot be answered by anything in this file. A person who speaks Georgian
// listens, and presses Approve.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, Check, Loader2, Play, Search, Sparkles, Square } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  approveLanguageVoice, getAuditionResults, getFallbackPolicy, getLanguageVoices,
  listLibraryVoices, revokeLanguageVoice, runAudition, searchSharedVoices,
  addSharedVoiceToAccount, setFallbackPolicy,
} from '@/services/voiceAi';
import type {
  AuditionCandidate, AuditionSample, LanguageVoice, LibraryVoice, SharedVoice,
} from '@/services/voiceAi';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
const k = (s: string) => s as TKey;

const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

/**
 * The sentences a candidate is judged on.
 *
 * Not "hello world". Real estate said the way a Tbilisi broker says it, the
 * consonants Georgian has and English does not, and a line that mixes the
 * brand, an abbreviation, a number and a currency — because those are where a
 * foreign speaker gives themselves away and where a normalisation layer
 * written for English quietly rewrites Georgian.
 */
const SENTENCES: Record<string, Array<{ key: string; text: string }>> = {
  ka: [
    { key: 'greeting', text: 'გამარჯობა, მე Homatch-ის ხელოვნური ინტელექტის ასისტენტი ვარ. როგორ შემიძლია დაგეხმაროთ?' },
    { key: 'search', text: 'თბილისში, ვაკის რაიონში, ორ-საძინებლიანი ბინა მაინტერესებს. ბიუჯეტი დაახლოებით ორასი ათასი დოლარია.' },
    { key: 'advice', text: 'მითხარით, რა განსხვავებაა ამ ორ შეთავაზებას შორის და რომელს მირჩევდით?' },
    { key: 'price', text: 'რა ღირს კვადრატული მეტრი ამ პროექტში და შესაძლებელია თუ არა ფასზე მოლაპარაკება?' },
    { key: 'offer', text: 'თუ გსურთ, შემიძლია დამატებითი ინფორმაცია მოგიძიოთ და ყველა მნიშვნელოვანი დეტალი შეგიდაროთ.' },
    { key: 'hard', text: 'ღრმაღელეში, ახალაშენებულ კორპუსში, მეცხრე სართულზე, ყველა ბინას აქვს ჭერის დიდი სიმაღლე, წყალი და ცენტრალური გათბობა; ეზოში ძველი ხის ჯიხურია.' },
    { key: 'mixed', text: 'Homatch-ის Buyer Intelligence აჩვენებს, რომ ფასი კვადრატულ მეტრზე არის 2450 აშშ დოლარი, ხოლო ROI დაახლოებით 7.5 პროცენტი.' },
  ],
  en: [
    { key: 'greeting', text: 'Hello, I am the Homatch AI assistant. How can I help you today?' },
    { key: 'search', text: 'I am looking for a two-bedroom flat in Vake, Tbilisi, with a budget of around two hundred thousand dollars.' },
    { key: 'mixed', text: 'Homatch Buyer Intelligence shows the price per square metre is 2450 US dollars, and the ROI is about 7.5 percent.' },
  ],
  ru: [
    { key: 'greeting', text: 'Здравствуйте, я AI-ассистент Homatch. Чем могу помочь?' },
    { key: 'search', text: 'Меня интересует двухкомнатная квартира в районе Ваке в Тбилиси, бюджет около двухсот тысяч долларов.' },
    { key: 'mixed', text: 'Homatch Buyer Intelligence показывает: цена за квадратный метр — 2450 долларов США, доходность около 7,5 процента.' },
  ],
};

/** The models worth auditioning, in the order a conversation cares about. */
const MODELS = [
  'eleven_v3_conversational',
  'eleven_flash_v2_5',
  'eleven_v3',
  'eleven_turbo_v2_5',
  'eleven_multilingual_v2',
];

let currentClip: HTMLAudioElement | null = null;

export function VoiceAudition() {
  const { t } = useLanguage();
  const [language, setLanguage] = useState('ka');
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [approved, setApproved] = useState<LanguageVoice[]>([]);
  const [fallback, setFallback] = useState<{
    voiceId: string; name: string; speakerLanguage: string | null; speakerAccent: string | null;
  } | null>(null);
  const [samples, setSamples] = useState<AuditionSample[]>([]);
  const [batches, setBatches] = useState<string[]>([]);
  const [batch, setBatch] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shared, setShared] = useState<SharedVoice[]>([]);
  const [sharedSearch, setSharedSearch] = useState('');
  /*
   * WHOSE LANGUAGE TO SEARCH FOR, WHICH IS NOT ALWAYS THE ONE BEING SPOKEN.
   *
   * The provider has no Georgian speaker at all. The nearest thing available
   * is a speaker of a language that shares more sounds with Georgian than
   * English does — a native Russian speaker has the rolled r and the vowel
   * timing, even though ღ, ყ and წ exist in neither. That is a lesser evil
   * and not a native accent, and it is worth being able to HEAR rather than
   * argue about, which means searching for one language while auditioning
   * another.
   */
  const [speakerLanguage, setSpeakerLanguage] = useState('ka');
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [allowsForeign, setAllowsForeign] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const wanted = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [lib, langs, res, policy] = await Promise.all([
      listLibraryVoices(), getLanguageVoices(), getAuditionResults(), getFallbackPolicy(),
    ]);
    setAllowsForeign(policy?.allowsForeign === true);
    setVoices(lib?.voices ?? []);
    setApproved(langs?.approved ?? []);
    setFallback(langs?.fallback ?? null);
    setSamples(res?.samples ?? []);
    setBatches(res?.batches ?? []);
    setBatch((b) => b || (res?.batches ?? [])[(res?.batches ?? []).length - 1] || '');
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    wanted.current = null;
    currentClip?.pause();
    currentClip = null;
  }, []);

  const play = useCallback((id: string, url: string) => {
    if (playing === id) {
      wanted.current = null;
      currentClip?.pause();
      currentClip = null;
      setPlaying(null);
      return;
    }
    currentClip?.pause();
    const audio = new Audio(url);
    currentClip = audio;
    wanted.current = id;
    const done = () => { if (wanted.current === id) wanted.current = null; currentClip = null; setPlaying(null); };
    audio.onended = done;
    audio.onerror = () => { const report = wanted.current === id; done(); if (report) toast.error(t(k('voice_ai_preview_failed'))); };
    setPlaying(id);
    void audio.play().catch(() => { const report = wanted.current === id; done(); if (report) toast.error(t(k('voice_ai_preview_failed'))); });
  }, [playing, t]);

  const toggle = useCallback((key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    const sentences = SENTENCES[language] ?? SENTENCES.en;
    const candidates: AuditionCandidate[] = [...picked].map((key) => {
      const [voiceId, modelId, lang] = key.split('|');
      return { voiceId, modelId, sendLanguage: lang === 'lang' };
    });
    if (!candidates.length) { toast.error(t(k('voice_ai_pick_candidates'))); return; }

    setRunning(true);
    const out = await runAudition({ language, sentences, candidates });
    setRunning(false);
    if (!out?.ok) { toast.error(out?.reason ?? t(k('voice_ai_audition_failed'))); return; }
    toast.success(t(k('voice_ai_audition_done'))
      .replace('{n}', String(out.generated ?? 0))
      .replace('{f}', String(out.failed ?? 0)));
    if (out.batchId) setBatch(out.batchId);
    await load();
  }, [language, picked, load, t]);

  const approve = useCallback(async (sample: AuditionSample) => {
    const out = await approveLanguageVoice({
      language: sample.language ?? language,
      voiceId: sample.voiceId,
      modelId: sample.modelId,
      sendLanguage: sample.sentLanguage,
      settings: sample.settings,
      auditionSampleId: sample.id,
    });
    if (!out?.ok) { toast.error(out?.reason ?? t(k('voice_ai_save_failed'))); return; }
    toast.success(t(k('voice_ai_language_approved')));
    await load();
  }, [language, load, t]);

  const revoke = useCallback(async (lang: string) => {
    const out = await revokeLanguageVoice(lang);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    await load();
  }, [load, t]);

  const savePolicy = useCallback(async (allow: boolean) => {
    setSavingPolicy(true);
    const out = await setFallbackPolicy(allow);
    setSavingPolicy(false);
    if (!out?.ok) { toast.error(t(k('voice_ai_save_failed'))); return; }
    setAllowsForeign(allow);
  }, [t]);

  const findShared = useCallback(async () => {
    setSearching(true);
    const out = await searchSharedVoices({
      language: speakerLanguage, search: sharedSearch.trim() || undefined, limit: 40,
    });
    setSearching(false);
    setShared(out?.voices ?? []);
  }, [speakerLanguage, sharedSearch]);

  const addShared = useCallback(async (v: SharedVoice) => {
    setAdding(v.voiceId);
    const out = await addSharedVoiceToAccount({
      publicOwnerId: v.publicOwnerId, voiceId: v.voiceId, name: v.name,
    });
    setAdding(null);
    if (!out?.ok) { toast.error(out?.detail ?? out?.reason ?? t(k('voice_ai_save_failed'))); return; }
    toast.success(t(k('voice_ai_voice_added')));
    await load();
  }, [load, t]);

  /* The samples of the batch being looked at, grouped into candidates. */
  const groups = useMemo(() => {
    const rows = samples.filter((s) => !batch || s.batchId === batch);
    const map = new Map<string, { label: AuditionSample; items: AuditionSample[] }>();
    for (const s of rows) {
      const key = `${s.voiceId}|${s.modelId}|${s.sentLanguage}`;
      if (!map.has(key)) map.set(key, { label: s, items: [] });
      map.get(key)!.items.push(s);
    }
    return [...map.entries()].map(([key, g]) => ({ key, ...g }));
  }, [samples, batch]);

  const approvedHere = approved.find((a) => a.language === language) ?? null;

  /*
   * WHAT THE PROVIDER SAYS ABOUT EACH SPEAKER, ON THE CARD.
   *
   * `language: en, accent: american` is the single most useful fact on this
   * screen and it was nowhere before. A voice list saying "24 languages" is
   * about the model; this is about the person.
   */
  const speakerOf = (v: LibraryVoice) => {
    const labels = (v.labels ?? {}) as Record<string, string>;
    return {
      language: labels.language ?? null,
      accent: labels.accent ?? null,
      cloned: v.category === 'cloned',
    };
  };

  const nativeish = (v: LibraryVoice) => {
    const sp = speakerOf(v);
    if (sp.cloned) return true;
    return sp.language ? sp.language.toLowerCase().startsWith(language) : false;
  };

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-3">
      <Alert>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="text-xs">{t(k('voice_ai_audition_why'))}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t(k('voice_ai_approved_for_language'))}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            {approvedHere ? (
              <>
                <Badge className="bg-green-100 text-[13px] text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400">
                  <Check className="me-1 h-3 w-3" aria-hidden="true" />
                  {approvedHere.voice_name ?? approvedHere.voice_id}
                </Badge>
                <span className="text-[13px] font-mono text-muted-foreground">{approvedHere.model_id}</span>
                <Button
                  variant="ghost" size="sm" className="h-7 text-[13px] text-muted-foreground"
                  onClick={() => void revoke(language)}
                >
                  {t(k('voice_ai_revoke_approval'))}
                </Button>
              </>
            ) : (
              <span className="text-xs text-destructive">{t(k('voice_ai_none_approved'))}</span>
            )}
          </div>

          {!approvedHere ? (
            <p className="text-[13px] text-muted-foreground">
              {allowsForeign && fallback ? (
                <>
                  {t(k('voice_ai_falling_back_to'))}{' '}
                  <span className="font-medium">{fallback.name}</span>
                  {fallback.speakerLanguage || fallback.speakerAccent ? (
                    <> — <span className="text-destructive">
                      {[fallback.speakerAccent, fallback.speakerLanguage].filter(Boolean).join(' · ')}
                    </span></>
                  ) : null}
                </>
              ) : t(k('voice_ai_silent_until_approved'))}
            </p>
          ) : null}

          {/*
            * THE SWITCH THAT DECIDES WHETHER A CUSTOMER CAN HEAR THE WRONG
            * ACCENT.
            *
            * Off in production. A customer hearing an American read Georgian
            * does not think "unapproved configuration" -- they think Homatch
            * sounds foreign, and that impression is not recoverable the way
            * a stated silence is. It is here, and labelled, because turning
            * it on for a demo is legitimate and doing so by accident is not.
            */}
          <label className="flex items-start gap-2 rounded-lg border p-2.5">
            <Switch
              checked={allowsForeign}
              disabled={savingPolicy}
              onCheckedChange={(on) => void savePolicy(on)}
              className="mt-0.5"
            />
            <span className="text-xs">
              <span className="block font-medium">{t(k('voice_ai_allow_foreign'))}</span>
              <span className="block text-[13px] text-muted-foreground">
                {t(k('voice_ai_allow_foreign_hint'))}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t(k('voice_ai_pick_candidates_title'))}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_pick_candidates_hint'))}</p>

          <div className="max-h-80 space-y-1.5 overflow-y-auto pe-1">
            {voices.map((v) => {
              const sp = speakerOf(v);
              return (
                <div key={v.voiceId} className={cn(
                  'rounded-lg border p-2',
                  nativeish(v) && 'border-gold/60 bg-gold/[0.04]',
                )}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{v.name}</span>
                    {sp.cloned ? (
                      <Badge variant="outline" className="text-[13px]">{t(k('voice_ai_cloned'))}</Badge>
                    ) : null}
                    {sp.language || sp.accent ? (
                      <Badge
                        variant="outline"
                        className={cn('text-[13px]',
                          sp.language && !sp.language.toLowerCase().startsWith(language) && 'text-destructive')}
                      >
                        {[sp.accent, sp.language].filter(Boolean).join(' · ')}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[13px]">{t(k('voice_ai_speaker_unknown'))}</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {MODELS.map((m) => [true, false].map((withLang) => {
                      const key = `${v.voiceId}|${m}|${withLang ? 'lang' : 'nolang'}`;
                      const on = picked.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(key)}
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 text-[13px] transition-colors',
                            on ? 'border-gold bg-gold/15 text-gold' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {m.replace('eleven_', '')}{withLang ? ` ${t(k('voice_ai_with_language'))}` : ''}
                        </button>
                      );
                    }))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8 gap-1.5" onClick={() => void run()} disabled={running || !picked.size}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              {t(k('voice_ai_generate_audition')).replace('{n}', String(picked.size))}
            </Button>
            {picked.size ? (
              <Button variant="ghost" size="sm" className="h-8 text-[13px]" onClick={() => setPicked(new Set())}>
                {t(k('voice_ai_clear'))}
              </Button>
            ) : null}
            <span className="text-[13px] text-muted-foreground">
              {t(k('voice_ai_audition_cost')).replace('{n}', String(picked.size * (SENTENCES[language] ?? SENTENCES.en).length))}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t(k('voice_ai_listen_and_choose'))}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {batches.length > 1 ? (
            <Select value={batch} onValueChange={setBatch}>
              <SelectTrigger className="h-8 w-full max-w-sm text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {batches.map((b, i) => (
                  <SelectItem key={b} value={b}>
                    {t(k('voice_ai_batch')).replace('{n}', String(i + 1))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {!groups.length ? (
            <p className="text-xs text-muted-foreground">{t(k('voice_ai_no_samples'))}</p>
          ) : groups.map((g) => {
            const failed = g.items.filter((s) => !s.ok);
            const playable = g.items.filter((s) => s.ok && s.url);
            const median = playable.length
              ? [...playable].map((s) => s.latencyMs ?? 0).sort((a, b) => a - b)[Math.floor(playable.length / 2)]
              : null;
            return (
              <div key={g.key} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold">{g.label.voiceName ?? g.label.voiceId}</span>
                  <Badge variant="outline" className="font-mono text-[13px]">{g.label.modelId}</Badge>
                  <Badge variant="outline" className="text-[13px]">
                    {g.label.sentLanguage ? t(k('voice_ai_language_declared')) : t(k('voice_ai_language_not_declared'))}
                  </Badge>
                  {median !== null ? (
                    <Badge variant="outline" className="text-[13px] tabular-nums">{median} ms</Badge>
                  ) : null}
                  <span className="flex-1" />
                  {playable.length ? (
                    <Button
                      size="sm" variant="secondary" className="h-7 gap-1.5 text-[13px]"
                      onClick={() => void approve(g.label)}
                    >
                      <Check className="h-3 w-3" aria-hidden="true" />
                      {t(k('voice_ai_approve_for')).replace('{lang}', (g.label.language ?? language).toUpperCase())}
                    </Button>
                  ) : null}
                </div>

                {failed.length ? (
                  <p className="mt-1.5 text-[13px] text-destructive">
                    {failed[0].errorCode}
                    {failed[0].providerStatus ? ` ${failed[0].providerStatus}` : ''}
                    {failed[0].errorDetail ? ` — ${failed[0].errorDetail}` : ''}
                  </p>
                ) : null}

                <ul className="mt-2 space-y-1">
                  {g.items.filter((s) => s.ok && s.url).map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => play(s.id, s.url!)}
                        aria-label={t(k('voice_ai_play'))}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
                      >
                        {playing === s.id
                          ? <Square className="h-3 w-3" aria-hidden="true" />
                          : <Play className="h-3 w-3" aria-hidden="true" />}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[13px]" title={s.sentence}>
                        {s.sentence}
                      </span>
                      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                        {s.latencyMs} ms
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t(k('voice_ai_shared_library'))}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_shared_library_hint'))}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={speakerLanguage} onValueChange={setSpeakerLanguage}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={sharedSearch} onChange={(e) => setSharedSearch(e.target.value)}
              placeholder={t(k('voice_ai_search'))} className="h-8 w-48 text-xs"
            />
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void findShared()} disabled={searching}>
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
              {t(k('voice_ai_search_speakers')).replace('{lang}', speakerLanguage.toUpperCase())}
            </Button>
          </div>

          {speakerLanguage !== language ? (
            <p className="text-[13px] text-amber-700 dark:text-amber-400">
              {t(k('voice_ai_nearest_language'))
                .replace('{speaker}', speakerLanguage.toUpperCase())
                .replace('{spoken}', language.toUpperCase())}
            </p>
          ) : null}

          {!shared.length ? (
            <p className="text-[13px] text-muted-foreground">{t(k('voice_ai_no_shared_speakers')).replace('{lang}', speakerLanguage.toUpperCase())}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto pe-1">
              {shared.map((v) => (
                <li key={v.voiceId} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
                  <span className="font-medium">{v.name}</span>
                  <Badge variant="outline" className="text-[13px]">
                    {[v.accent, v.language].filter(Boolean).join(' · ') || '—'}
                  </Badge>
                  {v.usageCount ? (
                    <span className="text-[13px] text-muted-foreground">{v.usageCount.toLocaleString()}</span>
                  ) : null}
                  <span className="flex-1" />
                  <Button
                    variant="outline" size="sm" className="h-7 text-[13px]"
                    disabled={adding === v.voiceId}
                    onClick={() => void addShared(v)}
                  >
                    {adding === v.voiceId
                      ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      : t(k('voice_ai_add_to_account'))}
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

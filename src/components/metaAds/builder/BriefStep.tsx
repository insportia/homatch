// 💬 TELL HOMATCH WHAT YOU REALLY WANT — the owner's own words, optional.
//
// Soft intent, never a command and never a targeting field: the brief is
// stored as `owner_brief`, read by meta-ads-api brief_interpret into closed
// vocabularies (audienceGuide.BriefUnderstanding), and shown back as "what
// HOMATCH understood" — every item removable. Anything useful becomes a
// suggestion the owner applies with one tap; nothing changes the campaign by
// itself, and nothing in the brief can override compliance or the facts.
import React, { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './MetaButton';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { briefHash, BRIEF_MAX, type BriefUnderstanding } from '@/lib/metaAds/audienceGuide';
import { briefInterpret, localeSearch, type MetaCampaignRow, type TargetingIntentRow } from '@/services/metaAds';
import { META_AGE_MAX, META_AGE_MIN } from '@/lib/metaAds/targeting';
import { StepShell } from './ui';
import { HelperCard, Pill } from './FinishKit';
import { regionName } from './LocationPicker';
import { languageName } from './AudienceStep';

type Patch = (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean; keepPreflight?: boolean }) => void;

export function BriefStep({ campaign, patch, setCampaign, flush }: {
  campaign: MetaCampaignRow; patch: Patch;
  setCampaign: (c: MetaCampaignRow) => void; flush: () => Promise<void>;
}) {
  const { t, lang } = useLanguage();
  const text = campaign.owner_brief ?? '';
  const u = campaign.brief_understanding ?? null;
  const fresh = !!u && u.hash === briefHash(text);
  const [busy, setBusy] = useState(false);

  const read = async () => {
    setBusy(true);
    try {
      await flush();
      const r = await briefInterpret(campaign.id, lang);
      setCampaign({ ...campaign, brief_understanding: r.understanding });
    } catch { toast.error(t('mm_f_brief_failed')); } finally { setBusy(false); }
  };

  /* A correction is the owner's: saved as is, flagged as edited. */
  const drop = <K extends keyof BriefUnderstanding>(key: K, value: unknown) => {
    if (!u) return;
    const list = (u[key] as unknown[]).filter((x) => x !== value);
    patch({ brief_understanding: { ...u, [key]: list, edited: true } as BriefUnderstanding }, { immediate: true, keepPreflight: true });
  };

  /* A fresh draft has no targeting yet: start one with NO places (a market is
     who the people are, never a place chosen for them). */
  const targeting: TargetingIntentRow = campaign.targeting ?? { locations: [], ageMin: META_AGE_MIN, ageMax: META_AGE_MAX, gender: 'ALL' };
  const applyMarkets = () => {
    if (!u) return;
    const intl = targeting.international ?? { enabled: true, intents: [], markets: [] };
    const intents = [...new Set([...intl.intents, ...u.audiences.filter((a) => a === 'FOREIGNERS_IN_COUNTRY' || a === 'MOVING_HERE' || a === 'INVESTORS_ABROAD')])];
    patch({ targeting: { ...targeting, international: { enabled: true, intents, markets: [...new Set([...intl.markets, ...u.markets])].slice(0, 10) } } as TargetingIntentRow }, { immediate: true });
    toast.success(t('mm_f_brief_applied'));
  };
  const applyLanguage = async (code: string) => {
    try {
      const r = await localeSearch(code);
      const hit = r.results?.[0];
      if (!hit) { toast.info(t(r.reason === 'MOCK_MODE_NO_META_CATALOGUE' ? 'mm_f_lang_mock' : 'mm_f_lang_none')); return; }
      const langs = targeting.languages ?? [];
      if (langs.some((l) => l.code === code)) return;
      patch({ targeting: { ...targeting, languages: [...langs, { key: hit.key, name: hit.name, code }] } }, { immediate: true });
      toast.success(t('mm_f_brief_applied'));
    } catch { toast.error(t('mm_f_lang_error')); }
  };
  const chosenLangs = new Set((targeting?.languages ?? []).map((l) => l.code));
  const reachedMarkets = new Set(targeting?.international?.markets ?? []);

  const Chip = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
    <span className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] ps-3 pe-1 text-[13px] font-medium text-foreground">
      <span dir="auto">{label}</span>
      <button type="button" onClick={onRemove} aria-label={t('mm_f_brief_remove', { item: label })}
        className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
    </span>
  );
  const Row = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-1.5"><p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p><div className="flex flex-wrap gap-1.5">{children}</div></div>
  );

  return (
    <StepShell eyebrow={t('madsb_step_brief')} title={`💬 ${t('mm_f_brief_title')}`} lead={t('mm_f_brief_lead')}>
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-foreground">
          {t('mm_f_brief_question')}<span className="shrink-0 text-2xs font-normal text-muted-foreground" dir="ltr">{text.length}/{BRIEF_MAX}</span>
        </span>
        <Textarea id="mm-f-brief" rows={5} maxLength={BRIEF_MAX} value={text} dir="auto" data-mm-brief=""
          placeholder={t('mm_f_brief_ph')} className="rounded-2xl text-[15px] leading-relaxed"
          onChange={(e) => patch({ owner_brief: e.target.value }, { keepPreflight: true })} />
        <span className="mt-1 block text-2xs text-muted-foreground">{t('mm_f_brief_optional')}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={read} disabled={busy || !text.trim()} className="gap-1.5" data-mm-brief-read="">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{t(u && !fresh ? 'mm_f_brief_reread' : 'mm_f_brief_read')}
        </Button>
        {u && !fresh && <span className="text-[13px] text-[hsl(32_78%_34%)]">{t('mm_f_brief_changed')}</span>}
      </div>

      {u && fresh && (
        <div data-mm-understood={u.source} className="space-y-3 rounded-2xl border border-[hsl(var(--gold-border))]/60 bg-gradient-to-br from-[hsl(var(--gold-soft))] via-card to-card p-4 shadow-card">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-foreground"><span aria-hidden>🧠</span>{t('mm_f_understood_title')}</p>
          {u.summary && <p className="text-sm leading-relaxed text-foreground" dir="auto" data-mm-understood-summary="">{u.summary}</p>}
          {u.audiences.length > 0 && <Row title={t('mm_f_u_audiences')}>{u.audiences.map((a) => <Chip key={a} label={t(`mm_f_aud_${a}`)} onRemove={() => drop('audiences', a)} />)}</Row>}
          {u.languages.length > 0 && <Row title={t('mm_f_u_languages')}>{u.languages.map((l) => <Chip key={l} label={languageName(l, lang)} onRemove={() => drop('languages', l)} />)}</Row>}
          {u.markets.length > 0 && <Row title={t('mm_f_u_markets')}>{u.markets.map((m) => <Chip key={m} label={regionName(m, lang)} onRemove={() => drop('markets', m)} />)}</Row>}
          {u.places.length > 0 && <Row title={t('mm_f_u_places')}>{u.places.map((p) => <Chip key={p} label={p} onRemove={() => drop('places', p)} />)}</Row>}
          {u.sellingPoints.length > 0 && <Row title={t('mm_f_u_points')}>{u.sellingPoints.map((p) => <Chip key={p} label={p} onRemove={() => drop('sellingPoints', p)} />)}</Row>}
          {!u.summary && !u.audiences.length && !u.languages.length && !u.markets.length && !u.places.length && !u.sellingPoints.length && (
            <p className="text-[13px] text-muted-foreground">{t('mm_f_understood_nothing')}</p>
          )}
          {u.ignored.length > 0 && (
            <div className="rounded-xl border border-border bg-background/60 p-3 text-[13px]">
              <p className="font-medium text-foreground">{t('mm_f_u_ignored')}</p>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {u.ignored.map((x, i) => <li key={i}>“<span dir="auto">{x.text}</span>” — {t(`mm_f_ignored_${x.reason}`)}</li>)}
              </ul>
            </div>
          )}
          <p className="text-2xs leading-relaxed text-muted-foreground">{t(u.source === 'AI' ? 'mm_f_understood_ai' : 'mm_f_understood_rules')}</p>
        </div>
      )}

      {u && fresh && (u.languages.some((l) => !chosenLangs.has(l)) || u.markets.some((m) => !reachedMarkets.has(m))) && (
        <HelperCard emoji="✨" tone="gold" title={t('mm_f_brief_suggest_title')} data-mm-brief-suggest=""
          action={(
            <>
              {u.languages.filter((l) => !chosenLangs.has(l)).map((l) => (
                <Pill key={l} active={false} onClick={() => void applyLanguage(l)}>{t('mm_f_brief_use_lang', { lang: languageName(l, lang) })}</Pill>
              ))}
              {u.markets.some((m) => !reachedMarkets.has(m)) && (
                <Pill active={false} onClick={applyMarkets}>{t('mm_f_brief_use_markets', { markets: u.markets.map((m) => regionName(m, lang)).join(', ') })}</Pill>
              )}
            </>
          )}>
          {t('mm_f_brief_suggest_body')}
        </HelperCard>
      )}
    </StepShell>
  );
}

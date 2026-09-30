// THE AD ITSELF — media guidance, validated uploads, the real ad fields, and
// HOMATCH AI inline.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Sparkles, Smartphone, Square, RectangleVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { checkMedia, GOAL_SPECS, PLACEMENTS, type Placement } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import {
  addCreative, removeCreative, updateCreative, readMediaFacts, creativeMediaUrl,
  type MetaCampaignRow, type MetaCreativeRow, type AiCopyVariant,
} from '@/services/metaAds';
import { StepShell, VerdictBadge } from './ui';
import { AiCopyPanel } from './AiCopyPanel';

export const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

/** Signed media URLs, fetched once per path and shared by cards and preview. */
const urlCache = new Map<string, Promise<string>>();
export function useMediaUrl(path: string | undefined | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let live = true;
    if (!urlCache.has(path)) urlCache.set(path, creativeMediaUrl(path).catch((e) => { urlCache.delete(path); throw e; }));
    urlCache.get(path)!.then((u) => { if (live) setUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [path]);
  return url;
}

export function MediaGuidance({ placements }: { placements: Placement[] }) {
  const { t } = useLanguage();
  const uses = (ratio: '1:1' | '4:5' | '9:16') => placements.filter((p) =>
    ratio === '9:16' ? /stories|reels/.test(p) : ratio === '4:5' ? /feed/.test(p) : /feed/.test(p));
  const cards: Array<{ ratio: '1:1' | '4:5' | '9:16'; w: number; h: number; icon: React.ReactNode }> = [
    { ratio: '1:1', w: 56, h: 56, icon: <Square className="h-3.5 w-3.5" /> },
    { ratio: '4:5', w: 48, h: 60, icon: <RectangleVertical className="h-3.5 w-3.5" /> },
    { ratio: '9:16', w: 38, h: 68, icon: <Smartphone className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="rounded-2xl border border-border bg-[hsl(var(--secondary))]/40 p-4">
      <p className="text-sm font-semibold text-foreground">{t('madsb_media_guide_title')}</p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t('madsb_media_guide_lead')}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {cards.map((c) => {
          const used = uses(c.ratio);
          return (
            <div key={c.ratio} className={cn('flex gap-3 rounded-xl border bg-card p-3', used.length ? 'border-[hsl(var(--gold-border))]/70' : 'border-border opacity-70')}>
              <div className="relative grid h-[72px] w-[60px] shrink-0 place-items-center">
                <div className="relative rounded-md border-2 border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]" style={{ width: c.w, height: c.h }}>
                  {c.ratio === '9:16' && (
                    <>
                      <div className="absolute inset-x-0 top-0 h-[14%] bg-destructive/15" />
                      <div className="absolute inset-x-0 bottom-0 h-[20%] bg-destructive/15" />
                    </>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground" dir="ltr">{c.icon}{c.ratio}</p>
                <p className="text-2xs leading-snug text-muted-foreground">{t(`madsb_ratio_${c.ratio.replace(':', '_')}_use` as never)}</p>
                {c.ratio === '9:16' && <p className="mt-0.5 text-2xs leading-snug text-destructive/80">{t('madsb_safe_zone')}</p>}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1 text-2xs leading-relaxed text-muted-foreground sm:grid-cols-2">
        <li>• {t('madsb_media_formats')}</li>
        <li>• {t('madsb_media_resolution')}</li>
        <li>• {t('madsb_media_video_length')}</li>
        <li>• {t('madsb_media_text_readable')}</li>
        <li>• {t('madsb_media_variants')}</li>
        <li>• {t('madsb_media_no_universal')}</li>
      </ul>
    </div>
  );
}

export function CreativeStep({ campaign, creatives, setCreatives, placements, onFocusCreative, defaultHeadline = '' }: {
  campaign: MetaCampaignRow; creatives: MetaCreativeRow[];
  setCreatives: React.Dispatch<React.SetStateAction<MetaCreativeRow[]>>;
  placements: Placement[]; onFocusCreative: (id: string) => void;
  /** The owner's own property title — a truthful, editable starting headline. */
  defaultHeadline?: string;
}) {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [aiFor, setAiFor] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files || !homatchUser) return;
    for (const file of Array.from(files).slice(0, 6)) {
      const facts = await readMediaFacts(file);
      const verdict = checkMedia({ mime: file.type, sizeBytes: file.size, width: facts.width, height: facts.height, durationSeconds: facts.duration }, placements);
      if (verdict.verdict === 'INCOMPATIBLE') {
        toast.error(`${file.name}: ${t(`madsb_${verdict.reasons[0] ?? 'media_format_unsupported'}` as never)}`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const row = await addCreative(homatchUser.id, campaign.id, file, { headline: defaultHeadline.slice(0, 40), primaryText: '' }, facts, creatives.length);
        setCreatives((cur) => [...cur, row]);
        onFocusCreative(row.id);
      } catch { toast.error(t('mads_upload_failed')); }
      finally { setUploading((n) => n - 1); }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const aiCreative = creatives.find((c) => c.id === aiFor) ?? null;

  return (
    <StepShell eyebrow={t('madsb_step_creative')} title={t('madsb_creative_title')} lead={t('madsb_creative_lead')}>
      <MediaGuidance placements={placements} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <Button type="button" onClick={() => fileRef.current?.click()} disabled={uploading > 0} className="gap-1.5">
          {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{t('madsb_add_media')}
        </Button>
        <p className="text-[13px] text-muted-foreground">{t('madsb_add_media_hint')}</p>
      </div>
      {creatives.map((cr) => (
        <CreativeEditor key={cr.id} creative={cr} goal={campaign.goal as MetaGoal} placements={placements}
          onChange={(next) => setCreatives((cur) => cur.map((c) => (c.id === next.id ? next : c)))}
          onRemove={async () => {
            try { await removeCreative(cr.id); setCreatives((cur) => cur.filter((c) => c.id !== cr.id)); }
            catch { toast.error(t('mads_load_failed')); }
          }}
          onAi={() => setAiFor(cr.id)} onFocus={() => onFocusCreative(cr.id)} />
      ))}
      {aiCreative && (
        <AiCopyPanel open={!!aiFor} onOpenChange={(v) => { if (!v) setAiFor(null); }} campaignId={campaign.id}
          current={{ primaryText: aiCreative.primary_text, headline: aiCreative.headline, description: aiCreative.description ?? '' }}
          onAccept={(v: AiCopyVariant) => {
            const next = { ...aiCreative, primary_text: v.primaryText || aiCreative.primary_text, headline: v.headline || aiCreative.headline, description: v.description ?? aiCreative.description ?? '' };
            setCreatives((cur) => cur.map((c) => (c.id === next.id ? next : c)));
            void updateCreative(next.id, { primary_text: next.primary_text, headline: next.headline, description: next.description } as never).catch(() => toast.error(t('mads_load_failed')));
          }} />
      )}
    </StepShell>
  );
}

function CreativeEditor({ creative, goal, placements, onChange, onRemove, onAi, onFocus }: {
  creative: MetaCreativeRow; goal: MetaGoal; placements: Placement[];
  onChange: (c: MetaCreativeRow) => void; onRemove: () => void; onAi: () => void; onFocus: () => void;
}) {
  const { t } = useLanguage();
  const spec = GOAL_SPECS[goal];
  const m0 = creative.media[0];
  const url = useMediaUrl(m0?.path);
  const check = useMemo(() => (m0 ? checkMedia({ mime: m0.mime, sizeBytes: Number(m0.size ?? 0), width: m0.width, height: m0.height, durationSeconds: m0.duration }, placements) : null), [m0, placements]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const edit = (patch: Partial<MetaCreativeRow>) => {
    const next = { ...creative, ...patch };
    onChange(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void updateCreative(creative.id, patch as never).catch(() => undefined); }, 600);
  };
  const fid = (f: string) => `madsb-field-${creative.id}-${f}`;
  const needsHeadline = goal !== 'ENGAGEMENT' && goal !== 'MESSAGES';

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4" onFocusCapture={onFocus}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div id={fid('media')} tabIndex={-1} className="w-full shrink-0 sm:w-40">
          {url ? (m0?.mime?.startsWith('video')
            ? <video src={url} className="aspect-square w-full rounded-xl object-cover" muted playsInline />
            : <img src={url} alt="" className="aspect-square w-full rounded-xl object-cover" />)
            : <Skeleton className="aspect-square w-full rounded-xl" />}
          {check && (
            <div className="mt-2 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <VerdictBadge verdict={check.verdict} />
                {check.ratio && <span className="text-2xs text-muted-foreground" dir="ltr">{check.ratio}{m0?.width ? ` · ${m0.width}×${m0.height}` : ''}</span>}
              </div>
              {check.reasons.slice(0, 2).map((r) => <p key={r} className="text-2xs leading-snug text-muted-foreground">{t(`madsb_${r}` as never)}</p>)}
              <div className="flex flex-wrap gap-1">
                {PLACEMENTS.filter((p) => placements.includes(p)).map((p) => (
                  <span key={p} className={cn('rounded px-1.5 py-px text-2xs',
                    check.placements[p] === 'READY' ? 'bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]'
                      : check.placements[p] === 'WARNING' ? 'bg-[hsl(32_78%_36%)]/10 text-[hsl(32_78%_30%)]' : 'bg-destructive/10 text-destructive')}>
                    {t(`mads_pl_${p}` as never)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-[13px] font-medium text-foreground">
              {t('madsb_field_primary')}<span className="text-2xs font-normal text-muted-foreground" dir="ltr">{creative.primary_text.length}/2200</span>
            </span>
            <Textarea id={fid('primaryText')} rows={3} value={creative.primary_text} maxLength={2200}
              placeholder={t('madsb_field_primary_ph')} onChange={(e) => edit({ primary_text: e.target.value })} />
            <span className="mt-0.5 block text-2xs text-muted-foreground">{t('madsb_field_primary_d')}</span>
          </label>
          {needsHeadline && (
            <label className="block">
              <span className="mb-1 flex items-baseline justify-between text-[13px] font-medium text-foreground">
                {t('madsb_field_headline')}<span className="text-2xs font-normal text-muted-foreground" dir="ltr">{creative.headline.length}/40</span>
              </span>
              <Input id={fid('headline')} value={creative.headline} maxLength={255} placeholder={t('madsb_field_headline_ph')}
                onChange={(e) => edit({ headline: e.target.value })} />
            </label>
          )}
          {needsHeadline && (
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-foreground">{t('madsb_field_description')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span></span>
              <Input id={fid('description')} value={creative.description ?? ''} maxLength={255} placeholder={t('madsb_field_description_ph')}
                onChange={(e) => edit({ description: e.target.value } as never)} />
            </label>
          )}
          {spec.allowedCtas.length > 1 && (
            <div id={fid('cta')} tabIndex={-1}>
              <span className="mb-1 block text-[13px] font-medium text-foreground">{t('madsb_field_cta')}</span>
              <div className="flex flex-wrap gap-1.5">
                {spec.allowedCtas.map((c) => {
                  const active = (spec.allowedCtas.includes(creative.cta) ? creative.cta : spec.defaultCta) === c;
                  return (
                    <button key={c} type="button" aria-pressed={active} onClick={() => edit({ cta: c })}
                      className={cn('rounded-full border px-2.5 py-1 text-2xs', active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground')}>
                      {t(`madsb_cta_${c.toLowerCase()}` as never)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAi} data-madsb-ai="">
              <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" />{t('mads_ai_assist')}
            </Button>
            <button type="button" aria-label={t('live_chat_delete')} onClick={onRemove}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--secondary))] hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

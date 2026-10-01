// LIVE PREVIEW — built from the campaign's real assets: the selected Page and
// Instagram identity, the uploaded media, and the copy as it is being typed.
// It is an honest approximation, labelled as one: Meta renders the final ad
// and may crop, truncate or rearrange it. Clicking a part of the preview
// jumps to the field that controls it — only parts the customer can actually
// change are clickable (media and a fixed button are shown, not offered).
// The grey line above the headline is the display link Meta derives from the
// destination URL's domain (HOMATCH does not override it), so it is shown
// only for website destinations and is never editable here.
import React, { useMemo, useState } from 'react';
import { Globe, MoreHorizontal, ThumbsUp, MessageCircle, Share2, Heart, Send, Bookmark, ChevronRight, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { checkMedia, ctaOptions, resolveCta, type Placement } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import type { MetaCampaignRow, MetaCreativeRow } from '@/services/metaAds';
import { useMediaUrl } from './CreativeStep';

export type PreviewField = 'primaryText' | 'headline' | 'description' | 'cta' | 'media';

export function AdPreview({ campaign, creative, placements, pageName, instagramName, formName, onField }: {
  campaign: MetaCampaignRow; creative: MetaCreativeRow | null; placements: Placement[];
  pageName: string | null; instagramName: string | null; formName: string | null;
  onField: (f: PreviewField) => void;
}) {
  const { t } = useLanguage();
  const available = placements.length ? placements : (['facebook_feed'] as Placement[]);
  const [placement, setPlacement] = useState<Placement>(available[0]);
  const current = available.includes(placement) ? placement : available[0];
  const m0 = creative?.media[0];
  const url = useMediaUrl(m0?.path);
  const isVideo = !!m0?.mime?.startsWith('video');
  const goal = campaign.goal as MetaGoal;
  const app = campaign.destination?.messagingApp ?? null;
  // The same rule the Meta payload uses (payload.resolveCta): what is shown is what is sent.
  const cta = t(`madsb_cta_${resolveCta(goal, creative?.cta, app).toLowerCase()}` as never);
  const ctaEditable = ctaOptions(goal, app).length > 1;
  const domain = useMemo(() => {
    try { return campaign.destination?.url ? new URL(campaign.destination.url).hostname.replace(/^www\./, '') : null; } catch { return null; }
  }, [campaign.destination?.url]);
  const verdict = m0 ? checkMedia({ mime: m0.mime, sizeBytes: Number(m0.size ?? 0), width: m0.width, height: m0.height, durationSeconds: m0.duration }, [current]).placements[current] : null;
  const page = pageName ?? t('madsb_preview_page_placeholder');
  const ig = instagramName ?? page;
  const text = creative?.primary_text?.trim() || t('madsb_preview_text_placeholder');
  const headline = creative?.headline?.trim() || t('madsb_preview_headline_placeholder');

  const editable = (field: PreviewField) => field === 'media' ? false : field === 'cta' ? ctaEditable : true;
  const zone = (field: PreviewField, children: React.ReactNode, cls?: string) => (editable(field) ? (
    <button type="button" onClick={() => onField(field)} title={t(`madsb_field_${field === 'primaryText' ? 'primary' : field}` as never)} data-mm-preview-zone={field}
      className={cn('block w-full text-start outline-none ring-[hsl(var(--gold-border))] transition-shadow hover:ring-2 focus-visible:ring-2', cls)}>
      {children}
    </button>
  ) : <div data-mm-preview-fixed={field} className={cn('block w-full', cls)}>{children}</div>);
  const media = (cls: string) => zone('media', url
    ? (isVideo ? <video src={url} className={cn('w-full object-cover', cls)} muted playsInline /> : <img src={url} alt="" className={cn('w-full object-cover', cls)} />)
    : <div className={cn('grid w-full place-items-center bg-[#e4e6eb] text-2xs text-[#65676b]', cls)}>{t('madsb_preview_media_placeholder')}</div>);
  const vertical = /stories|reels/.test(current);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label={t('madsb_preview_placements')}>
        {available.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={current === p} onClick={() => setPlacement(p)}
            className={cn('rounded-full border px-2.5 py-1 text-2xs', current === p ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground')}>
            {t(`mads_pl_${p}` as never)}
          </button>
        ))}
      </div>

      {verdict && verdict !== 'READY' && (
        <p className={cn('mb-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-2xs',
          verdict === 'INCOMPATIBLE' ? 'bg-destructive/10 text-destructive' : 'bg-[hsl(32_78%_36%)]/10 text-[hsl(32_78%_30%)]')}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t(verdict === 'INCOMPATIBLE' ? 'madsb_preview_incompatible' : 'madsb_preview_cropped')}
        </p>
      )}

      <div dir="ltr" className={cn('mx-auto overflow-hidden rounded-2xl border border-border bg-white text-[#050505] shadow-card', vertical ? 'max-w-[260px]' : 'max-w-[360px]')}>
        {current === 'facebook_feed' && (
          <div className="text-[13px]">
            <div className="flex items-center gap-2 px-3 py-2">
              <Avatar name={page} />
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{page}</p><p className="flex items-center gap-1 text-2xs text-[#65676b]">{t('mads_sponsored')} · <Globe className="h-3 w-3" /></p></div>
              <MoreHorizontal className="h-4 w-4 text-[#65676b]" />
            </div>
            {zone('primaryText', <p className="line-clamp-3 whitespace-pre-line px-3 pb-2">{text}</p>)}
            {media('aspect-[4/5] max-h-[380px]')}
            {goal !== 'ENGAGEMENT' && (
              <div className="flex items-center gap-2 bg-[#f0f2f5] px-3 py-2">
                <div className="min-w-0 flex-1">
                  {domain && <p data-mm-preview-display-link="" className="truncate text-2xs uppercase text-[#65676b]">{domain}</p>}
                  {zone('headline', <p className="truncate font-semibold">{headline}</p>)}
                  {creative?.description && zone('description', <p className="truncate text-2xs text-[#65676b]">{creative.description}</p>)}
                </div>
                {zone('cta', <span className="block shrink-0 rounded-md bg-[#e4e6eb] px-3 py-1.5 text-2xs font-semibold">{cta}</span>, 'w-auto')}
              </div>
            )}
            <div className="flex justify-around border-t border-[#ced0d4] px-2 py-1.5 text-2xs text-[#65676b]">
              <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" />{t('madsb_pv_like')}</span>
              <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{t('madsb_pv_comment')}</span>
              <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />{t('madsb_pv_share')}</span>
            </div>
          </div>
        )}
        {current === 'instagram_feed' && (
          <div className="text-[13px]">
            <div className="flex items-center gap-2 px-3 py-2">
              <Avatar name={ig} ring />
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{ig}</p><p className="text-2xs text-[#737373]">{t('mads_sponsored')}</p></div>
              <MoreHorizontal className="h-4 w-4" />
            </div>
            {media('aspect-[4/5] max-h-[400px]')}
            {goal !== 'ENGAGEMENT' && zone('cta', <div className="flex items-center justify-between bg-[#efefef] px-3 py-2 font-semibold"><span>{cta}</span><ChevronRight className="h-4 w-4" /></div>)}
            <div className="flex items-center gap-3 px-3 py-2"><Heart className="h-5 w-5" /><MessageCircle className="h-5 w-5" /><Send className="h-5 w-5" /><Bookmark className="ms-auto h-5 w-5" /></div>
            {zone('primaryText', <p className="line-clamp-3 px-3 pb-3"><span className="font-semibold">{ig}</span> {text}</p>)}
          </div>
        )}
        {vertical && (
          <div className="relative aspect-[9/16] bg-black text-white">
            {media('absolute inset-0 h-full')}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[14%] bg-gradient-to-b from-black/60 to-transparent" />
            <div className="pointer-events-none absolute start-3 top-3 flex items-center gap-2 text-2xs">
              <Avatar name={current.startsWith('instagram') ? ig : page} small />
              <span className="font-semibold">{current.startsWith('instagram') ? ig : page}</span><span className="opacity-75">· {t('mads_sponsored')}</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-4 pt-10">
              {current === 'instagram_reels' && zone('primaryText', <p className="line-clamp-2 text-2xs">{text}</p>)}
              {goal !== 'ENGAGEMENT' && zone('cta', <span className="mx-auto block w-max rounded-full bg-white px-4 py-1.5 text-2xs font-semibold text-black">{cta}</span>)}
            </div>
          </div>
        )}
      </div>

      {goal === 'LEADS_ON_META' && <p className="mt-2 text-center text-2xs text-muted-foreground">{t('madsb_preview_opens_form', { form: formName ?? '—' })}</p>}
      {goal === 'MESSAGES' && <p className="mt-2 text-center text-2xs text-muted-foreground">{t(`madsb_preview_opens_${String(campaign.destination?.messagingApp ?? 'MESSENGER').toLowerCase()}` as never)}</p>}
      <p className="mt-2 text-center text-2xs leading-relaxed text-muted-foreground">{t('madsb_preview_disclaimer')}</p>
    </div>
  );
}

function Avatar({ name, ring, small }: { name: string; ring?: boolean; small?: boolean }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-full bg-[#0C1119] font-bold text-[hsl(38_92%_60%)]',
      small ? 'h-6 w-6 text-2xs' : 'h-8 w-8 text-2xs', ring && 'ring-2 ring-[#d62976] ring-offset-1')}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

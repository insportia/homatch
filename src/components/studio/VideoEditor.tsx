import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { isVideo, parseVideo } from '@/site/video';
import type { StudioState } from './useStudioState';

/**
 * THE VIDEO ADDRESS.
 *
 * Typed, not uploaded. A walkthrough is a hundred megabytes and wants a
 * player with adaptive bitrate, captions and a CDN; the honest thing for this
 * product to do is accept a link to somewhere that already does all of that.
 *
 * THE BOX SAYS WHAT IS WRONG WHILE IT IS BEING TYPED
 *
 * Every address is checked against the provider allowlist (src/site/video.ts)
 * as the admin types, and the verdict is shown under the box. Half of a
 * YouTube URL is not a valid one, so a strict checker with a silent failure
 * mode would look broken for as long as it took to finish typing.
 *
 * The value is only STORED when it parses. That keeps the page from having to
 * decide what to do with a half-written address, and it means an admin cannot
 * publish a block whose video quietly does not appear.
 */
export function VideoEditor({
  studio, slot, labelKey,
}: { studio: StudioState; slot: string; labelKey: string }) {
  const { t } = useLanguage();
  const { selected, setMedia } = studio;

  /*
   * What is in the box, as opposed to what is stored.
   *
   * They differ exactly while an address is being typed or is refused, which
   * is the whole reason this is not driven straight off the model.
   */
  const stored = selected?.media[slot]?.url ?? '';
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? stored;

  if (!selected) return null;

  const parsed = parseVideo(text);
  const ok = isVideo(parsed);
  const problem = ok ? null : parsed.error;

  const onChange = (next: string) => {
    setTyped(next);
    const result = parseVideo(next);
    if (isVideo(result)) setMedia(slot, result.original);
    // Emptied on purpose: clear the slot, so the block goes back to its
    // "no video yet" state rather than keeping the old one invisibly.
    else if (result.error === 'empty' && stored) setMedia(slot, null);
  };

  return (
    <div className="space-y-2 border-b py-4">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`v-${slot}`} className="text-[15px] font-medium">{t(labelKey)}</Label>
        {stored && (
          <Button
            variant="ghost" size="sm" className="h-7 px-2 text-[14px]"
            onClick={() => { setTyped(''); setMedia(slot, null); }}
          >
            {t('studio_video_clear')}
          </Button>
        )}
      </div>

      <Input
        id={`v-${slot}`}
        value={text}
        inputMode="url"
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        placeholder={t('studio_video_help')}
        className="text-[16px]"
      />

      {problem === 'empty' ? (
        <p className="text-[14px] text-muted-foreground">{t('studio_video_none')}</p>
      ) : problem ? (
        <p className="flex items-start gap-1.5 text-[14px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {problem === 'insecure' ? t('studio_video_err_insecure') : t('studio_video_err_unsupported')}
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-[14px] text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
          {/* The resolved embed address, not what was typed. It is how an
              admin can see that a `watch?v=` link became a nocookie embed. */}
          <span className="min-w-0 break-all">{isVideo(parsed) ? parsed.src : ''}</span>
        </p>
      )}
    </div>
  );
}

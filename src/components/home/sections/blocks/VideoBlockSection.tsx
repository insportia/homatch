// HOMATCH — a video an admin can put on a page.
//
// WHY THE EMBED IS NOT IN THE PAGE UNTIL SOMEBODY PRESSES PLAY
//
// A YouTube <iframe> costs roughly a megabyte and a handful of third-party
// connections before anyone has decided to watch anything, on every visit,
// including the visits that scroll straight past it. So what the page ships
// is a poster and a play control; the iframe is created by the press.
//
// That also means the page can honestly say it opens no third-party
// connection until the visitor asks for one, which is a promise worth being
// able to keep on a site that sells trust in records.
//
// A DIRECT FILE IS DIFFERENT
//
// mp4/webm plays in <video>, which is a media element: it cannot run script
// or navigate, and with preload="none" it costs nothing until pressed. It
// gets the browser's own controls rather than a facade.
import React, { useState } from 'react';
import { Play } from 'lucide-react';
import {
  useIsEditing, useMediaProps, useSectionMedia, useSectionSettings,
  useSectionVideo, spacingClass,
} from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE } from '../primitives';
import { BlockIntro, useBlockIntro } from './intro';

export function VideoBlockSection() {
  const { variant, theme, spacing } = useSectionSettings();
  const video = useSectionVideo()('video');
  const poster = useSectionMedia()('poster');
  const mp = useMediaProps();
  const editing = useIsEditing();
  const { t } = useLanguage();

  // Only ever set by a press, and never reset: a visitor who started the
  // video does not want it swapped back for a picture.
  const [playing, setPlaying] = useState(false);

  const intro = useBlockIntro();
  const dark = theme === 'dark';

  if (!intro.written && !video && !editing) return null;

  /* 16/9 unless a Site Studio preset says otherwise. A video is the one
     picture on a page whose shape an admin has a real reason to change. */
  const frame = `relative isolate aspect-[var(--hm-media-ratio,16/9)] w-full overflow-hidden rounded-[0.9rem] ${
    dark ? 'bg-white/[0.06] ring-1 ring-inset ring-white/15' : 'bg-secondary ring-1 ring-inset ring-foreground/10'
  }`;

  return (
    <section className={dark ? 'bg-[#0D0D0D] text-white' : 'bg-background text-foreground'}>
      <div className={`${PAGE} ${spacingClass(spacing)}`}>
        <BlockIntro values={intro} dark={dark} align={variant === 'wide' ? 'center' : 'start'} />

        <div
          className={`mt-12 sm:mt-16 ${variant === 'wide' ? '' : 'max-w-[60rem]'}`}
          {...mp('video')}
        >
          {video === null ? (
            /*
             * No address yet. On the public site this section has already
             * returned null unless there is a heading, so what is left is a
             * written block waiting for its video — and in the editor, the
             * thing an admin clicks to add one.
             */
            <div className={`${frame} grid place-items-center`}>
              {/* Not a field mark: the prompt is an instruction, not copy.
                  The address is set from the inspector, because a URL is not
                  something you type into the middle of a page. */}
              <p className={`px-6 text-center text-[15px] ${dark ? 'text-white/55' : 'text-ink-soft'}`}>
                {t('studio_ph_video')}
              </p>
            </div>
          ) : video.kind === 'file' ? (
            <video
              className={frame}
              src={video.src}
              poster={poster?.url}
              controls
              preload="none"
              playsInline
            />
          ) : playing ? (
            <iframe
              className={frame}
              src={`${video.src}${video.src.includes('?') ? '&' : '?'}autoplay=1`}
              title={intro.title ?? t('studio_sec_video')}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              // In the editor a press would load the embed into the preview
              // iframe, which is a third-party document inside the editing
              // surface. The admin is arranging a page, not watching it.
              onClick={() => { if (!editing) setPlaying(true); }}
              className={`${frame} group block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            >
              {poster && (
                <img
                  src={poster.url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transform-none motion-reduce:transition-none"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <span className="absolute inset-0 bg-[#0D0D0D]/28" aria-hidden="true" />
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white/90 text-[#0D0D0D] shadow-[0_8px_30px_rgba(0,0,0,0.28)] transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none">
                  <Play className="ms-0.5 h-6 w-6 fill-current" strokeWidth={1.5} aria-hidden="true" />
                </span>
              </span>
              <span className="sr-only">{t('video_play')}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

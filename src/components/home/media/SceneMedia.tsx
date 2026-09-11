import React, { useState } from 'react';
import { ArchitecturalScene, type SceneName } from './scenes';

/**
 * THE IMAGE SLOT
 *
 * One component owns every photograph on the Main Page, so the crop, the art
 * direction, the responsive ladder and the reserved geometry live in one
 * place and a page section only says *which* scene it wants and *how wide it
 * renders*.
 *
 * THE ASSETS
 *
 * Four owner-approved photographs, built into three widths × AVIF/WebP/JPEG
 * by scripts/build-scene-assets.mjs (see that file for the recipe and for how
 * to regenerate). The browser picks a width from `sizes` and a format from
 * source order, so a phone on AVIF pulls ~43 kB where the JPEG master is
 * 350 kB.
 *
 * THE FALLBACK
 *
 * If an image 404s or fails to decode, a vector architectural scene takes
 * over at identical geometry rather than leaving a grey hole. It is not the
 * design — the photographs are — it is what keeps a broken asset from
 * breaking the page.
 *
 * ART DIRECTION
 *
 * `position` and `positionMobile` are separate because the crop that works in
 * a tall desktop panel drowns in a short mobile band. Passing only `position`
 * means "same crop everywhere". See the .scene-img rule in index.css for how
 * the two are swapped at the lg breakpoint.
 */
export type SceneKey = 'hero' | 'verification' | 'platform' | 'closing';

interface SceneAsset {
  dir: string;
  file: string;
  widths: number[];
  /** Intrinsic size of the source, used to reserve geometry against CLS. */
  intrinsic: { w: number; h: number };
  /** Vector stand-in used only if the photograph fails to load. */
  fallback: SceneName;
}

const ASSETS: Record<SceneKey, SceneAsset> = {
  hero: {
    dir: 'hero',
    file: 'homatch-hero-tbilisi-luxury',
    widths: [768, 1200, 1536],
    intrinsic: { w: 1536, h: 1024 },
    fallback: 'interior',
  },
  verification: {
    dir: 'verification',
    file: 'homatch-verification-property',
    widths: [640, 960, 1280],
    intrinsic: { w: 1514, h: 1039 },
    fallback: 'detail',
  },
  platform: {
    dir: 'platform',
    file: 'homatch-tbilisi-network',
    widths: [960, 1400, 1672],
    intrinsic: { w: 1672, h: 941 },
    fallback: 'city',
  },
  closing: {
    dir: 'cta',
    file: 'homatch-closing-tbilisi',
    widths: [960, 1400, 1832],
    intrinsic: { w: 1832, h: 859 },
    fallback: 'city',
  },
};

const srcSet = (asset: SceneAsset, ext: string) =>
  asset.widths.map(w => `/images/${asset.dir}/${asset.file}-${w}.${ext} ${w}w`).join(', ');

export interface SceneMediaProps {
  scene: SceneKey;
  /** Accessible description, already translated. Empty string for decoration. */
  alt: string;
  /** How wide this image actually renders — drives which width is downloaded. */
  sizes: string;
  /** object-position from lg up (and everywhere, if positionMobile is unset). */
  position?: string;
  /** object-position below lg. */
  positionMobile?: string;
  /** Above-the-fold media is fetched eagerly at high priority; the rest lazily. */
  priority?: boolean;
  className?: string;
  /**
   * A photograph an admin uploaded through Site Studio, replacing the built
   * one for this slot.
   *
   * It renders at the same geometry, crop and fallback behaviour, but as a
   * single file: there is no responsive ladder, because an upload is one
   * width and inventing srcset entries for sizes that were never generated
   * would just serve the same bytes under four names. That is a real cost, so
   * the bucket caps uploads at 5 MB and the field is opt-in per slot.
   */
  overrideUrl?: string;
}

export function SceneMedia({
  scene,
  alt,
  sizes,
  position = '50% 50%',
  positionMobile,
  priority = false,
  className = '',
  overrideUrl,
}: SceneMediaProps) {
  const [failed, setFailed] = useState(false);
  const asset = ASSETS[scene];
  const widest = asset.widths[asset.widths.length - 1];

  const positionStyle = {
    ['--scene-pos' as string]: positionMobile ?? position,
    ['--scene-pos-lg' as string]: position,
  };

  return (
    <div className={`relative h-full w-full overflow-hidden bg-sand ${className}`}>
      {failed ? (
        <ArchitecturalScene scene={asset.fallback} />
      ) : overrideUrl ? (
        <img
          src={overrideUrl}
          alt={alt}
          width={asset.intrinsic.w}
          height={asset.intrinsic.h}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          {...({ fetchpriority: priority ? 'high' : 'auto' } as Record<string, string>)}
          // Same failure path as the built assets: a replaced photo that 404s
          // falls back to the vector scene rather than leaving a hole.
          onError={() => setFailed(true)}
          className="scene-img h-full w-full object-cover"
          style={positionStyle}
        />
      ) : (
        // <picture> is display:inline by default, which collapses the img's
        // percentage height to auto and leaves an empty frame. It has to be a
        // block that fills its parent for object-fit to have anything to fit
        // against.
        <picture className="block h-full w-full">
          <source type="image/avif" srcSet={srcSet(asset, 'avif')} sizes={sizes} />
          <source type="image/webp" srcSet={srcSet(asset, 'webp')} sizes={sizes} />
          <img
            src={`/images/${asset.dir}/${asset.file}-${widest}.jpg`}
            srcSet={srcSet(asset, 'jpg')}
            sizes={sizes}
            alt={alt}
            width={asset.intrinsic.w}
            height={asset.intrinsic.h}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            // React 18 does not map camelCase `fetchPriority` onto the DOM
            // attribute — it warns and drops it. (React 19 does; @types/react
            // here is already 19, which is why the typed prop looks correct.)
            // Spreading the lowercase attribute is what actually reaches the
            // element on the version this app runs.
            {...({ fetchpriority: priority ? 'high' : 'auto' } as Record<string, string>)}
            onError={() => setFailed(true)}
            // .scene-img reads the two custom properties below and swaps
            // between them at lg (see index.css). Custom properties rather
            // than classes because object-position takes arbitrary values, so
            // this art-directs the crop without a second element or download.
            className="scene-img h-full w-full object-cover"
            style={positionStyle}
          />
        </picture>
      )}
    </div>
  );
}

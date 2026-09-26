// EVERY PHOTO A PROPERTY HAS, NOT THE FIRST ONE AND A ROW OF STAMPS.
//
// What this replaces: a 16:7 cover, and — only when there was more than one photo — a
// strip of inert 64px squares. You could see that other photos existed and you could
// not look at any of them. For a listing, where the photographs ARE the product, that
// is the single most useful thing on the page left switched off.
//
// WHERE THE PHOTOS COME FROM, IN ORDER OF TRUTHFULNESS
//
//   property_photos      the real table, ordered by display_order, with is_cover. This
//                        is what an owner actually manages on the edit screen.
//   cover_photo_url      a single key on the property. Every row has one; imports set
//                        it to the source portal's own image.
//   facts.gallery_images an importer's array, kept because an imported listing's other
//                        photos live there and nowhere else.
//
// Deduplicated across all three, because an import writes the same key into
// cover_photo_url AND into the gallery array, and showing that photo twice makes the
// count wrong — and the count is a claim.
//
// STORAGE IS NOT REIMPLEMENTED HERE. Everything goes through PrivateImage, which is the
// one place that knows a `property-photos` key from an absolute URL and mints a
// short-lived signed URL for the former. This component never sees a bucket name.
//
// THE LIGHTBOX IS A DIALOG, NOT A DIV WITH A HIGH z-index. Escape closes it, arrows
// move, focus is trapped by the primitive, and the page behind it does not scroll.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PrivateImage } from '@/components/common/PrivateImage';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export interface GallerySource {
  coverPhotoUrl?: string | null;
  photos?: Array<{
    id?: string | number;
    storage_path?: string | null;
    public_url?: string | null;
    is_cover?: boolean | null;
    display_order?: number | null;
  }> | null;
  galleryImages?: string[] | null;
}

/**
 * One ordered, de-duplicated list of image addresses.
 *
 * The cover goes first whether it came from the photo table or from the property row,
 * because the owner chose it and an interface that opens on a different photo is
 * quietly overruling them.
 */
export function galleryImages(source: GallerySource): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const key = (value ?? '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  const rows = [...(source.photos ?? [])].sort((a, b) => {
    /* The cover leads; everything else keeps the order the owner dragged it into. */
    if (Boolean(a.is_cover) !== Boolean(b.is_cover)) return a.is_cover ? -1 : 1;
    return Number(a.display_order ?? 0) - Number(b.display_order ?? 0);
  });

  const cover = rows.find((row) => row.is_cover);
  if (cover) push(cover.storage_path ?? cover.public_url);
  else push(source.coverPhotoUrl);

  for (const row of rows) push(row.storage_path ?? row.public_url);
  push(source.coverPhotoUrl);
  for (const image of source.galleryImages ?? []) push(image);

  return out;
}

function Empty({ label }: { label: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/40"
      role="img"
      aria-label={label}
    >
      <ImageOff className="h-10 w-10" aria-hidden="true" />
      <span className="text-[13px] break-words px-4 text-center">{label}</span>
    </div>
  );
}

export function PropertyGallery({ source, title }: { source: GallerySource; title: string }) {
  const { t } = useLanguage();
  const images = useMemo(() => galleryImages(source), [source]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const count = images.length;
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;

  const go = useCallback((delta: number) => {
    if (count === 0) return;
    /* Wraps, because the end of a gallery is not an error. */
    setIndex((current) => (current + delta + count) % count);
  }, [count]);

  /*
   * ARROW KEYS, BUT ONLY WHILE THE LIGHTBOX IS OPEN. Binding them to the page would
   * steal them from every other control on a long property page.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  if (count === 0) {
    return (
      <div className="aspect-[16/9] w-full overflow-hidden rounded-xl bg-secondary/40 sm:aspect-[16/7]">
        <Empty label={t('gallery_no_photos')} />
      </div>
    );
  }

  const counter = (
    <span className="rounded-full bg-background/85 px-2.5 py-1 text-[13px] text-foreground shadow-sm backdrop-blur">
      <span dir="ltr">{safeIndex + 1} / {count}</span>
    </span>
  );

  return (
    <div className="space-y-2">
      {/* ── THE PRIMARY IMAGE ─────────────────────────────────────────── */}
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-secondary/40 sm:aspect-[16/7]">
        <PrivateImage
          src={images[safeIndex]}
          alt={title}
          loading="eager"
          className="absolute inset-0 h-full w-full object-cover"
          pending={<div className="absolute inset-0 animate-pulse bg-secondary/60" />}
          fallback={<Empty label={t('gallery_unavailable')} />}
        />

        {/* Opening the lightbox is the whole point of the primary image. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('gallery_open_full')}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        />

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('gallery_previous')}
              className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('gallery_next')}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </>
        )}

        <div className="pointer-events-none absolute bottom-2 end-2 flex items-center gap-1.5">
          {count > 1 && counter}
          <span className="flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[13px] text-foreground shadow-sm backdrop-blur">
            <Expand className="h-3 w-3" aria-hidden="true" />
            <span className="break-words">{t('gallery_open_full')}</span>
          </span>
        </div>
      </div>

      {/*
        ── THE THUMBNAIL RAIL ───────────────────────────────────────────
        Scrolls horizontally INSIDE ITS OWN BOX rather than widening the page, which is
        the rule every wide element on this product follows. Each thumbnail is a real
        button, so the rail is usable from the keyboard as well as the thumb.
      */}
      {count > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {images.map((image, position) => (
            <button
              key={`${image}-${position}`}
              type="button"
              onClick={() => setIndex(position)}
              aria-label={`${position + 1} / ${count}`}
              aria-current={position === safeIndex}
              className={cn(
                'relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                position === safeIndex
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border opacity-80 hover:opacity-100',
              )}
            >
              <PrivateImage
                src={image}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                pending={<div className="absolute inset-0 animate-pulse bg-secondary/60" />}
                fallback={(
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                    <ImageOff className="h-4 w-4" aria-hidden="true" />
                  </div>
                )}
              />
            </button>
          ))}
        </div>
      )}

      {/* ── THE LIGHTBOX ──────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* DialogContent renders its own close control; a second one would be two
            buttons doing the same thing in the same corner. */}
        <DialogContent className="max-w-[min(72rem,calc(100vw-1.5rem))] border-0 bg-background/95 p-2 backdrop-blur">
          {/* Named for screen readers; the visible title would only crowd the photo. */}
          <DialogTitle className="sr-only">{title}</DialogTitle>

          <div className="relative aspect-[4/3] w-full sm:aspect-[16/9]">
            <PrivateImage
              src={images[safeIndex]}
              alt={title}
              loading="eager"
              className="absolute inset-0 h-full w-full object-contain"
              pending={<div className="absolute inset-0 animate-pulse bg-secondary/40" />}
              fallback={<Empty label={t('gallery_unavailable')} />}
            />

            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label={t('gallery_previous')}
                  className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label={t('gallery_next')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
                </button>
                <div className="absolute bottom-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2">
                  {counter}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

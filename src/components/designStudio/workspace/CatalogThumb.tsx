import React, { useEffect, useRef, useState } from 'react';
import { catalogUrls } from '@/services/designStudio/catalogUrls';
import { cn } from '@/lib/utils';

/**
 * A catalogue picture in a fixed box, signed only once it is on screen.
 *
 * The box never changes size (no layout shift while pictures arrive). Until
 * the row scrolls into view nothing is asked for; then the key joins the
 * session batcher (one signing call per ~50 ms, cached until expiry). No key,
 * a key that cannot be signed, or a picture that fails to load → `fallback`.
 */
export function CatalogThumb({
  thumbKey, fallback, className, alt = '',
}: {
  thumbKey: string | null | undefined;
  fallback: React.ReactNode;
  /** Size classes for the box, e.g. "h-14 w-14". */
  className: string;
  alt?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [url, setUrl] = useState<string | null>(() => (thumbKey ? catalogUrls().peek(thumbKey) : null));
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setFailed(false);
    setVisible(false);
    setUrl(thumbKey ? catalogUrls().peek(thumbKey) : null);
  }, [thumbKey]);

  useEffect(() => {
    const el = ref.current;
    if (!thumbKey || !el || visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '120px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [thumbKey, visible]);

  useEffect(() => {
    if (!thumbKey || !visible || url) return;
    let live = true;
    void catalogUrls().get(thumbKey).then((u) => {
      if (!live) return;
      if (u) setUrl(u); else setFailed(true);
    });
    return () => { live = false; };
  }, [thumbKey, visible, url]);

  const showImage = !!thumbKey && !!url && !failed;
  return (
    <span ref={ref} className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-md bg-[#F1F2F4]', className)}>
      {showImage ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-contain"
          onError={() => {
            // An expired or refused URL: forget it and show the drawn swatch.
            if (thumbKey) catalogUrls().invalidate(thumbKey);
            setFailed(true);
          }}
        />
      ) : fallback}
    </span>
  );
}

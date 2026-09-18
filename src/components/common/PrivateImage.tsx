/**
 * An <img> for a value that might be a URL and might be a private storage
 * path.
 *
 * Every photo in this product is stored in a PRIVATE bucket, so its address
 * has to be minted per view and expires. Doing that inline at each display
 * site means four places to get it wrong; this is one place, and it is a
 * drop-in replacement for the <img> that used to be there.
 *
 * While the URL is being minted it renders the fallback rather than an
 * <img> with an empty src, because an empty src makes the browser re-request
 * the current page and log a console error. If the object cannot be read —
 * it is gone, or this person is not allowed it — the fallback simply stays.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { resolveImageSrc } from '@/services/storage/images';

interface PrivateImageProps {
  /** An absolute URL, or a path inside the private photo bucket. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** Shown while resolving, and kept if there is nothing to show. */
  fallback?: ReactNode;
}

export function PrivateImage({
  src, alt, className, loading = 'lazy', fallback = null,
}: PrivateImageProps) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setResolved(null);
    setFailed(false);
    void resolveImageSrc(src).then((url) => {
      // The path can change while a signature is in flight — a gallery being
      // scrolled, a cover being swapped. Whatever came back for the previous
      // path is not what this component should now be showing.
      if (live) setResolved(url);
    });
    return () => { live = false; };
  }, [src]);

  if (!resolved || failed) return <>{fallback}</>;

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => setFailed(true)}
    />
  );
}

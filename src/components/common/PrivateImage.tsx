/**
 * An <img> for a value that might be a URL and might be a private storage
 * path.
 *
 * Every photo in this product is stored in a PRIVATE bucket, so its address
 * has to be minted per view and expires. Doing that inline at each display
 * site means four places to get it wrong; this is one place, and it is a
 * drop-in replacement for the <img> that used to be there.
 *
 * While the URL is being minted it renders `pending` rather than an <img> with an
 * empty src, because an empty src makes the browser re-request the current page and
 * log a console error. If the object cannot be read — it is gone, this person is not
 * allowed it, or the host refuses the request — it renders `fallback`.
 *
 * THOSE TWO USED TO BE THE SAME NODE, and that was a real defect found in production
 * rather than a tidiness point. My Properties passed a shimmer as the fallback, and
 * the one imported property in the database carries an EXTERNAL cover URL from the
 * portal it was read off. That host does not serve the image to us, so the component
 * went straight to the failed branch and rendered the shimmer — forever. An owner
 * looking at their own portfolio saw a photo that was permanently one second away
 * from appearing.
 *
 * `pending` defaults to `fallback`, so every existing caller behaves exactly as it
 * did; callers that care pass both and can tell a customer the difference between
 * "loading" and "there is no photo here".
 */

import { useEffect, useState, type ReactNode } from 'react';
import { resolveImageSrc } from '@/services/storage/images';

interface PrivateImageProps {
  /** An absolute URL, or a path inside the private photo bucket. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** Shown when there is nothing to show: no src, or it could not be read. */
  fallback?: ReactNode;
  /**
   * Shown while the URL is being minted. Defaults to `fallback`, which is what every
   * caller got before this existed.
   */
  pending?: ReactNode;
}

export function PrivateImage({
  src, alt, className, loading = 'lazy', fallback = null, pending,
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

  /*
   * FAILED IS CHECKED FIRST, and there is no src-less pending state: with nothing to
   * resolve there is nothing to wait for, so an absent src is the empty answer rather
   * than a permanent spinner.
   */
  if (failed || !src) return <>{fallback}</>;
  if (!resolved) return <>{pending ?? fallback}</>;

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

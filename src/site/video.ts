/**
 * VIDEO AN ADMIN CAN PUT ON A PAGE.
 *
 * Two things a page needs from a pasted video URL: is it one we can actually
 * embed, and what is the embed address. Both answered here, with no React and
 * no DOM, so the rules can be tested directly — which matters because this is
 * the one content field where the stored value becomes an iframe src.
 *
 * WHY AN ALLOWLIST OF PROVIDERS
 *
 * `<iframe src={whatever the admin typed}>` is a way to put an arbitrary
 * third-party document inside our page, with our users' attention on it. The
 * providers here are the ones a property company actually uses for tutorials
 * and walkthroughs; anything else is refused with a reason rather than
 * rendered and hoped about.
 *
 * A direct file (mp4/webm) is allowed because it is played by <video>, which
 * is a media element, not a document — it cannot run script or navigate.
 */

export type VideoKind = 'youtube' | 'vimeo' | 'file';

export interface VideoRef {
  kind: VideoKind;
  /** For an embed, the iframe src. For a file, the file itself. */
  src: string;
  /** What the admin typed, kept so the field can be shown back to them. */
  original: string;
}

export type VideoProblem = 'empty' | 'insecure' | 'unsupported';

const YOUTUBE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/;
const VIMEO = /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(?:video\/)?(\d{6,12})/;
const FILE = /\.(mp4|webm|ogg)(\?.*)?$/i;

/**
 * Resolve what an admin pasted.
 *
 * Returns the problem rather than throwing, so the editor can say which of
 * the three things went wrong instead of "invalid".
 */
export function parseVideo(input: string): VideoRef | { error: VideoProblem } {
  const raw = (input ?? '').trim();
  if (!raw) return { error: 'empty' };

  /*
   * http:, data:, javascript: and friends are refused before anything is
   * matched. A mixed-content iframe is blocked by the browser anyway, and the
   * other schemes are the injection this module exists to prevent.
   */
  if (/^(?!https:\/\/)[a-z][a-z0-9+.-]*:/i.test(raw)) return { error: 'insecure' };

  const yt = YOUTUBE.exec(raw);
  if (yt) {
    return {
      kind: 'youtube',
      // nocookie, and no related videos from other channels at the end.
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`,
      original: raw,
    };
  }

  const vi = VIMEO.exec(raw);
  if (vi) {
    return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vi[1]}`, original: raw };
  }

  if (FILE.test(raw) && /^https:\/\//i.test(raw)) {
    return { kind: 'file', src: raw, original: raw };
  }

  return { error: 'unsupported' };
}

/** Narrow a parse result without repeating the shape test at each call site. */
export function isVideo(v: VideoRef | { error: VideoProblem }): v is VideoRef {
  return (v as VideoRef).kind !== undefined;
}

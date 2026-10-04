// A design picture for the 3D views, decoded and kept: a fresh link first (the page's own may have expired), then
// the one the page has. Kept by id, so a room entered again (or prepared while the one before was looked at) opens
// at once.

import { signedUrls } from '@/services/designStudio/files';

export interface PictureRef { id: string; url: string; key?: string | null }

const kept = new Map<string, Promise<HTMLImageElement>>();

async function fetchPicture(p: PictureRef, onStage: (s: string) => void): Promise<HTMLImageElement> {
  const links = [...new Set([p.key ? (await signedUrls([p.key], 900).catch(() => new Map<string, string>())).get(p.key) : null, p.url].filter((x): x is string => !!x))];
  let blob: Blob | null = null;
  let stage = 'PICTURE_NETWORK';
  for (const link of links) {
    const res = await fetch(link, { cache: 'no-store' }).catch(() => null);
    stage = res ? `PICTURE_${res.status}` : 'PICTURE_NETWORK';
    onStage(stage);
    if (res?.ok) { blob = await res.blob(); break; }
  }
  if (!blob) throw new Error(stage);
  onStage('DECODE');
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** The decoded picture (asked again, the same one; a failure is forgotten so it can be asked again). */
export function loadPicture(p: PictureRef, onStage: (s: string) => void = () => {}): Promise<HTMLImageElement> {
  const hit = kept.get(p.id);
  if (hit) return hit;
  const job = fetchPicture(p, onStage);
  kept.set(p.id, job);
  job.catch(() => { if (kept.get(p.id) === job) kept.delete(p.id); });
  return job;
}

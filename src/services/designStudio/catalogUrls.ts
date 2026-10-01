// One session-wide signer for public catalogue files (thumbnails, material
// maps). Keys live under design-studio/catalog/public/…; originals are never
// asked for here. Batching and expiry: src/lib/designStudio/signedUrlBatcher.ts.

import { createSignedUrlBatcher, type SignedUrlBatcher } from '@/lib/designStudio/signedUrlBatcher';
import { signedUrls } from './files';

const EXPIRES_IN_S = 600;

let batcher: SignedUrlBatcher | null = null;

export function catalogUrls(): SignedUrlBatcher {
  batcher ??= createSignedUrlBatcher({
    sign: (keys) => signedUrls(keys, EXPIRES_IN_S),
    expiresInS: EXPIRES_IN_S,
    windowMs: 50,
  });
  return batcher;
}

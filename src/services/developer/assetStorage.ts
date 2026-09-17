import type { StorageProvider } from './twin';

/**
 * WHERE THE HEAVY BYTES LIVE, AND WHERE THEY MUST NOT.
 *
 * Three rules this module exists to keep:
 *
 *   NOT IN THE BUNDLE.   A glTF is megabytes. Shipping one inside the Vercel
 *                        application would make every page on homatch.live pay
 *                        for an apartment nobody opened. Assets are fetched by
 *                        URL, at the moment a viewer asks for them, and never
 *                        imported.
 *   NOT IN A DATABASE ROW. Postgres is where the canonical facts live —
 *                        projects, units, prices, statuses, CRM, permissions,
 *                        scene metadata and asset REFERENCES. A binary in a
 *                        column would make every row read drag geometry with
 *                        it and put a CDN's job on a connection pool.
 *   ONE PLACE DECIDES.   Every heavy object becomes a URL through here. Moving
 *                        a project's geometry from Supabase Storage to R2 is
 *                        then a change of one column plus one branch, rather
 *                        than a rewrite of the viewer, the studio and the
 *                        domain model.
 *
 * R2 IS NOT CONFIGURED IN THIS DEPLOYMENT and this module does not pretend it
 * is. `r2Status()` reports exactly that, the adapter falls back to the bucket
 * that does exist, and nothing anywhere invents a credential. When somebody
 * sets VITE_TWIN_ASSET_CDN the R2 branch starts working with no other change.
 */

export type HeavyAssetKind =
  | 'GEOMETRY' | 'TEXTURE' | 'PANORAMA' | 'HDRI' | 'IMAGE' | 'FLOOR_PLAN';

export interface StoredAsset {
  storage_provider: StorageProvider;
  storage_key: string;
  version: number;
  content_hash: string | null;
}

/** The bucket that exists today. Public because a published twin is public. */
export const SUPABASE_ASSET_BUCKET = 'developer-media';

export type R2State = 'CONFIGURED' | 'EXTERNAL_CONFIGURATION_REQUIRED';

export interface R2Status {
  state: R2State;
  /** The base URL objects would be served from, when there is one. */
  base: string | null;
  /** What a person would have to do. Empty when nothing is outstanding. */
  missing: string[];
}

/**
 * Whether heavy assets can be served from an object CDN yet.
 *
 * Deliberately a runtime read rather than a build-time constant: the answer is
 * a property of the deployment, and a build that hard-coded "not configured"
 * would keep saying it after somebody configured it.
 */
export function r2Status(): R2Status {
  const base = (import.meta.env?.VITE_TWIN_ASSET_CDN as string | undefined) ?? null;
  if (base && base.trim()) {
    return { state: 'CONFIGURED', base: base.replace(/\/$/, ''), missing: [] };
  }
  return {
    state: 'EXTERNAL_CONFIGURATION_REQUIRED',
    base: null,
    missing: [
      'VITE_TWIN_ASSET_CDN',
      'R2 bucket and public hostname',
      'R2 credentials for the upload path',
    ],
  };
}

/**
 * THE ONE PLACE AN ASSET BECOMES A URL.
 *
 * The version or the content hash is in the query string, which is what makes
 * an object IMMUTABLE: a cache may hold it for ever, and marking an apartment
 * sold invalidates none of it, because availability never travels this way.
 */
export function heavyAssetUrl(asset: StoredAsset, supabaseUrl?: string): string {
  const cacheKey = asset.content_hash ?? String(asset.version);

  switch (asset.storage_provider) {
    case 'R2':
    case 'CDN': {
      const status = r2Status();
      // Falls through to Supabase when the CDN is not configured, rather than
      // producing a URL that would 404 for every buyer.
      if (status.base) return `${status.base}/${asset.storage_key}?v=${cacheKey}`;
      break;
    }
    case 'EXTERNAL':
      return asset.storage_key;
    default:
      break;
  }

  const base = supabaseUrl
    ?? (import.meta.env?.VITE_SUPABASE_URL as string | undefined)
    ?? '';
  return `${base}/storage/v1/object/public/${SUPABASE_ASSET_BUCKET}/${asset.storage_key}?v=${cacheKey}`;
}

/**
 * Which provider a NEW upload should go to.
 *
 * Geometry and textures are the objects that justify a CDN; a floor-plan image
 * is small and is read once by an operator, so it stays where the rest of the
 * developer's media is. Both answers change together when R2 arrives.
 */
export function providerFor(kind: HeavyAssetKind): StorageProvider {
  const heavy: HeavyAssetKind[] = ['GEOMETRY', 'TEXTURE', 'PANORAMA', 'HDRI'];
  if (!heavy.includes(kind)) return 'SUPABASE';
  return r2Status().state === 'CONFIGURED' ? 'R2' : 'SUPABASE';
}

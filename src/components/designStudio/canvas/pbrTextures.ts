// IMPORTED MATERIALS, WORN AS TEXTURES.
//
// A licensed (imported) material's look lives in its maps — albedo, normal
// and a glTF-packed ORM (R = occlusion, G = roughness, B = metalness) — not
// in its colour, which is white. This loader signs each map's key (session
// batcher, public catalogue keys only), loads the JPEG once, and shares it:
// one base texture per key, plus one repeat clone per (key, repeat) that
// shares the base's pixels, so every surface wearing the same material at
// the same scale wears the same texture objects.
//
// Colour spaces: albedo sRGB, normal and ORM linear. Normals are OpenGL
// (Y+), three.js's own convention. Wrapping: repeat on both axes.
//
// Which maps and how often they repeat is decided in
// src/lib/designStudio/pbrMaps.ts (pure). KTX2 variants are not used yet.
//
// Lifetime: the SceneController owns one loader and disposes it with the
// scene; a load that finishes after dispose() is disposed on arrival.

import * as THREE from 'three';
import type { PbrSelection } from '@/lib/designStudio/pbrMaps';

export interface PbrTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  orm: THREE.Texture | null;
  /** The albedo's average colour (linear), when it could be measured: what a tint balances against. */
  mean: THREE.Color | null;
}

/** The average colour of an image (linear), from a small copy of it; null when it cannot be read. */
export function imageMean(image: unknown): THREE.Color | null {
  try {
    if (typeof document === 'undefined' || !image) return null;
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); g += lin(d[i + 1]); b += lin(d[i + 2]); }
    const n = d.length / 4;
    return new THREE.Color(r / n, g / n, b / n);
  } catch {
    return null; // a tainted or unreadable image: no balancing, the texture as it is
  }
}

/**
 * The colour a material is multiplied by so its texture's average becomes
 * the colour that was seen: the grain stays, the tone is the picture's.
 * Bounded, so a texture is never pushed into a caricature of itself.
 */
export function balanceTo(seen: string, mean: THREE.Color | null): THREE.Color {
  const target = new THREE.Color(seen);
  if (!mean) return target;
  const k = (t: number, m: number) => Math.max(0.25, Math.min(2.4, t / Math.max(m, 0.01)));
  return new THREE.Color(k(target.r, mean.r), k(target.g, mean.g), k(target.b, mean.b));
}

type Sign = (key: string) => Promise<string | null>;

async function defaultSign(key: string): Promise<string | null> {
  const { catalogUrls } = await import('@/services/designStudio/catalogUrls');
  return catalogUrls().get(key);
}

export class PbrTextureLoader {
  private base = new Map<string, Promise<THREE.Texture | null>>();
  private loadedBase = new Set<THREE.Texture>();
  private means = new Map<string, THREE.Color | null>();
  private clones = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private disposed = false;
  private anisotropy: number;
  private sign: Sign;

  constructor(anisotropy = 1, sign: Sign = defaultSign) {
    this.anisotropy = anisotropy;
    this.sign = sign;
    this.loader.setCrossOrigin('anonymous');
  }

  private loadBase(key: string, srgb: boolean): Promise<THREE.Texture | null> {
    let p = this.base.get(key);
    if (!p) {
      p = (async () => {
        const url = await this.sign(key);
        if (!url || this.disposed) return null;
        try {
          const tex = await this.loader.loadAsync(url);
          if (this.disposed) { tex.dispose(); return null; }
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = this.anisotropy;
          tex.generateMipmaps = true;
          tex.needsUpdate = true;
          this.loadedBase.add(tex);
          return tex;
        } catch {
          return null;
        }
      })();
      // A failed key may be tried again later (e.g. an expired URL).
      void p.then((t) => { if (!t && !this.disposed) this.base.delete(key); });
      this.base.set(key, p);
    }
    return p;
  }

  private repeated(key: string, base: THREE.Texture, repeat: [number, number]): THREE.Texture {
    const id = `${key}|${repeat[0]}x${repeat[1]}`;
    let t = this.clones.get(id);
    if (!t) {
      t = base.clone();
      t.source = base.source; // share the pixels (and the GPU upload), not a copy
      t.repeat.set(repeat[0], repeat[1]);
      t.needsUpdate = true;
      this.clones.set(id, t);
    }
    return t;
  }

  /** The textures for a selection; null when the albedo cannot be had (the caller keeps a flat look). */
  async load(sel: PbrSelection): Promise<PbrTextureSet | null> {
    const [albedo, normal, orm] = await Promise.all([
      this.loadBase(sel.albedo, true),
      sel.normal ? this.loadBase(sel.normal, false) : Promise.resolve(null),
      sel.orm ? this.loadBase(sel.orm, false) : Promise.resolve(null),
    ]);
    if (!albedo || this.disposed) return null;
    if (!this.means.has(sel.albedo)) this.means.set(sel.albedo, imageMean(albedo.image));
    return {
      mean: this.means.get(sel.albedo) ?? null,
      map: this.repeated(sel.albedo, albedo, sel.repeat),
      normalMap: normal && sel.normal ? this.repeated(sel.normal, normal, sel.repeat) : null,
      orm: orm && sel.orm ? this.repeated(sel.orm, orm, sel.repeat) : null,
    };
  }

  dispose() {
    this.disposed = true;
    for (const t of this.clones.values()) t.dispose();
    for (const t of this.loadedBase) t.dispose();
    this.clones.clear();
    this.loadedBase.clear();
    this.base.clear();
  }
}

/** Put a texture set on a material, glTF-style: ORM drives AO, roughness and metalness (factors are multipliers). */
export function wearPbr(m: THREE.MeshStandardMaterial, set: PbrTextureSet, normalScale: number) {
  m.map = set.map;
  m.normalMap = set.normalMap;
  m.normalScale.set(normalScale, normalScale);
  m.aoMap = set.orm;
  m.roughnessMap = set.orm;
  m.metalnessMap = set.orm;
  m.needsUpdate = true;
}

/** Take every PBR map off a material (back to the flat-colour path). */
export function shedPbr(m: THREE.MeshStandardMaterial) {
  m.map = null;
  m.normalMap = null;
  m.aoMap = null;
  m.roughnessMap = null;
  m.metalnessMap = null;
  m.needsUpdate = true;
}

// STEP INSIDE THE PICTURE — the selected design picture, made 3D, full screen.
//
// The picture itself is the scene (photo3d/depthMesh.ts): nothing re-designed,
// nothing replaced. It opens exactly as the picture; drag to look around, the
// circle (or W A S D / arrows / the wheel) to step in. The other rooms of this
// design are points standing in the room: tap one and you are in that room
// (prepared while you look around, so it opens at once). What the picture does
// not show stays open rather than invented, and the walk ends where the picture does.

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { clampWalk, hotspotAt, PHOTO_CAMERAS, photoMesh, roomShapedDepth, walkBounds } from '@/lib/designStudio/photo3d/depthMesh';
import { estimateDepth } from '@/lib/designStudio/photo3d/estimateDepth';
import { signedUrls } from '@/services/designStudio/files';

/** A picture to step into: its storage key (signed afresh when entered — a page left open outlives a link). */
export interface WalkPhoto { id: string; url: string; key?: string | null; label: string; kind: 'ROOM' | 'MASTER' }

// The same game as every long wait, watching this one.
const SnakeGame = lazy(() => import('@/components/games/SnakeGame'));

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const ROUND = cn('grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20', RING);
const SPEED = 0.9;

/** The picture behind a walk photo, as a decoded image: a fresh link first (the page's may have expired), then the one it has. */
async function loadPicture(photo: WalkPhoto, onStage: (s: string) => void): Promise<HTMLImageElement> {
  const links = [...new Set([photo.key ? (await signedUrls([photo.key], 900).catch(() => new Map<string, string>())).get(photo.key) : null, photo.url].filter((x): x is string => !!x))];
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
    // Decoded: the pixels stay with the image.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

type Phase = { kind: 'LOADING'; progress: number | null; measuring?: boolean } | { kind: 'READY'; approximate: boolean; reason?: string } | { kind: 'FAILED'; code: string };

export function PhotoWalk({ photos, initialId, onClose }: { photos: WalkPhoto[]; initialId: string; onClose: () => void }) {
  const { t, isRTL } = useLanguage();
  const [activeId, setActiveId] = useState(initialId);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING', progress: null });
  const host = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const photo = photos.find((p) => p.id === activeId) ?? photos[0];
  // The other rooms, as points in this one (placed every frame where the room shows them).
  const elsewhere = photos.filter((p) => p.id !== photo?.id).slice(0, 12);
  const spots = useRef<Array<HTMLButtonElement | null>>([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  useEffect(() => {
    const el = host.current;
    if (!el || !photo) return;
    let disposed = false;
    let frame = 0;
    setPhase({ kind: 'LOADING', progress: null });
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene();
    const cam = PHOTO_CAMERAS[photo.kind];
    const camera = new THREE.PerspectiveCamera(cam.fovDeg, 1, 0.05, 200);
    camera.rotation.order = 'YXZ';
    const pos = { x: 0, y: 0, z: 0 };
    const look = { yaw: 0, pitch: 0 };
    let bounds = { forwardM: 0.5, sideM: 0.3, upM: 0.25 };
    let place: ((i: number, n: number) => THREE.Vector3) | null = null;
    const move = { x: 0, y: 0, wheel: 0 };
    const keys = new Set<string>();
    resetRef.current = () => { pos.x = 0; pos.y = 0; pos.z = 0; look.yaw = 0; look.pitch = 0; };

    const size = () => {
      const w = el.clientWidth || 1; const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(el);

    // Looking: a drag anywhere but the circle. The view stays within what the picture can show.
    let drag: { id: number; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); };
    const moveP = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      look.yaw = Math.max(-0.9, Math.min(0.9, look.yaw + (e.clientX - drag.x) * 0.004));
      look.pitch = Math.max(-0.5, Math.min(0.5, look.pitch + (e.clientY - drag.y) * 0.004));
      drag = { ...drag, x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); move.wheel += -e.deltaY * 0.002; };
    const keyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
    const keyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', moveP);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);

    // Stepping: the circle.
    const s = stick.current; const k = knob.current;
    let stickId: number | null = null;
    const stickAt = (e: PointerEvent) => {
      if (!s || !k) return;
      const r = s.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      move.x = dx; move.y = dy;
      k.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
    };
    const stickDown = (e: PointerEvent) => { stickId = e.pointerId; s?.setPointerCapture(e.pointerId); stickAt(e); };
    const stickMove = (e: PointerEvent) => { if (stickId === e.pointerId) stickAt(e); };
    const stickUp = (e: PointerEvent) => { if (stickId !== e.pointerId) return; stickId = null; move.x = 0; move.y = 0; if (k) k.style.transform = ''; };
    s?.addEventListener('pointerdown', stickDown);
    s?.addEventListener('pointermove', stickMove);
    s?.addEventListener('pointerup', stickUp);
    s?.addEventListener('pointercancel', stickUp);

    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      let fwd = -move.y; let side = move.x;
      if (keys.has('w') || keys.has('arrowup')) fwd += 1;
      if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
      if (keys.has('d') || keys.has('arrowright')) side += 1;
      if (keys.has('a') || keys.has('arrowleft')) side -= 1;
      const step = SPEED * dt;
      const dz = -(fwd * step + move.wheel);
      move.wheel = 0;
      const dx = side * step;
      // In the direction one looks (on the floor).
      pos.x += dx * Math.cos(look.yaw) + dz * Math.sin(look.yaw);
      pos.z += -dx * Math.sin(look.yaw) + dz * Math.cos(look.yaw);
      Object.assign(pos, clampWalk(pos, bounds));
      camera.position.set(pos.x, pos.y, pos.z);
      camera.rotation.set(look.pitch, look.yaw, 0);
      renderer.render(scene, camera);
      camera.updateMatrixWorld();
      const list = spots.current;
      const n = list.filter(Boolean).length;
      const w = el.clientWidth; const h = el.clientHeight;
      for (let i = 0; i < list.length; i += 1) {
        const b = list[i];
        if (!b) continue;
        const at = place ? place(i, n).project(camera) : null;
        const shown = !!at && at.z < 1 && Math.abs(at.x) < 1.05 && Math.abs(at.y) < 1.05;
        b.style.visibility = shown ? 'visible' : 'hidden';
        if (at && shown) b.style.transform = `translate(${((at.x + 1) / 2) * w}px, ${((1 - at.y) / 2) * h}px) translate(-50%, -50%)`;
      }
    };

    let stage = 'START';
    (async () => {
      try {
        const img = await loadPicture(photo, (st) => { stage = st; });
        stage = 'DEPTH';
        if (disposed) return;
        // The picture's own depth; a device that cannot estimate it still enters the picture, on a room's shape.
        let approximate = false;
        let reason = '';
        const depth = await estimateDepth(photo.id, img, (p) => {
          if (disposed) return;
          setPhase(p.stage === 'MEASURING' ? { kind: 'LOADING', progress: null, measuring: true } : { kind: 'LOADING', progress: p.fraction });
        })
          .catch((e) => { approximate = true; reason = String((e as Error)?.message ?? e).slice(0, 60); return roomShapedDepth(); });
        if (disposed) return;
        stage = 'MESH';
        const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        const mesh = photoMesh(depth, aspect, cam);
        bounds = walkBounds(mesh);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        const texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
        // Unlit: the picture's own light and colour, exactly.
        scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })));
        // What the picture does not show: its own average colour, darkened — never an invented surface.
        const c = document.createElement('canvas'); c.width = 8; c.height = 8;
        const g = c.getContext('2d');
        if (g) {
          g.drawImage(img, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data;
          let r = 0; let gg = 0; let b = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
          const px = d.length / 4;
          scene.background = new THREE.Color(`rgb(${Math.round((r / px) * 0.45)}, ${Math.round((gg / px) * 0.45)}, ${Math.round((b / px) * 0.45)})`);
        }
        // The points to the other rooms: where the picture shows that part of the room, a little nearer.
        place = (i, n) => {
          const { u, v } = hotspotAt(i, n);
          const k = Math.round(v * mesh.rows) * (mesh.cols + 1) + Math.round(u * mesh.cols);
          return new THREE.Vector3(mesh.positions[k * 3], mesh.positions[k * 3 + 1], mesh.positions[k * 3 + 2]).multiplyScalar(0.8);
        };
        // eslint-disable-next-line no-console
        if (approximate) console.warn('[photo-walk] approximate depth', reason);
        setPhase({ kind: 'READY', approximate, reason });
        frame = requestAnimationFrame(tick);
        // The other rooms are prepared while this one is looked at, one after another: a tap opens them at once.
        void (async () => {
          for (const other of photosRef.current.filter((p) => p.id !== photo.id).slice(0, 12)) {
            if (disposed) return;
            try { await estimateDepth(other.id, await loadPicture(other, () => {})); } catch { /* measured when entered */ }
          }
        })();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[photo-walk]', stage, e);
        if (!disposed) setPhase({ kind: 'FAILED', code: stage });
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      s?.removeEventListener('pointerdown', stickDown);
      s?.removeEventListener('pointermove', stickMove);
      s?.removeEventListener('pointerup', stickUp);
      s?.removeEventListener('pointercancel', stickUp);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        if (mat) { mat.map?.dispose(); mat.dispose(); }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [photo?.id, photo?.url, photo?.kind, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0C1119] text-white" role="dialog" aria-modal="true" aria-label={t('dsx_photo3d_title')} data-testid="photo-walk" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(env(safe-area-inset-top),12px)]">
        <h2 className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold" data-testid="photo-walk-room">{photo?.label ?? t('dsx_photo3d_title')}</h2>
        <button type="button" onClick={() => resetRef.current()} className={ROUND} aria-label={t('dsx_photo3d_reset')} data-testid="photo-walk-reset"><RotateCcw className="h-5 w-5" aria-hidden="true" /></button>
        <button type="button" onClick={onClose} className={cn(ROUND, 'bg-white text-[#0C1119] hover:bg-white/90')} aria-label={t('dsx_photo3d_close')} data-testid="photo-walk-close"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {photos.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2" role="tablist" aria-label={t('dsx_photo3d_pictures')}>
          {photos.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === photo?.id} onClick={() => setActiveId(p.id)}
              className={cn('min-h-10 shrink-0 rounded-full px-4 text-[14px] font-medium', RING, p.id === photo?.id ? 'bg-white text-[#0C1119]' : 'bg-white/10 text-white ring-1 ring-white/20')}
              data-testid="photo-walk-pick">{p.label}</button>
          ))}
        </div>
      ) : null}
      <div ref={host} className="relative min-h-0 flex-1 overflow-hidden">
        {phase.kind === 'LOADING' ? (
          <div className="absolute inset-0 grid place-items-center bg-[#0C1119]" role="status" aria-live="polite" data-testid="photo-walk-loading">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              <p className="text-[15px] font-semibold">{t(phase.measuring ? 'dsx_photo3d_measuring' : 'dsx_photo3d_loading')}</p>
              {phase.progress != null && !phase.measuring ? <p className="text-[13px] text-white/70">{Math.round(phase.progress * 100)}%</p> : null}
              <button type="button" onClick={() => setPlaying(true)} className={cn('mt-2 inline-flex h-11 items-center rounded-full bg-[hsl(38_92%_56%)] px-5 text-[14px] font-semibold text-[#0C1119]', RING)} data-testid="photo-walk-snake">{t('dsx_sn_play')}</button>
            </div>
          </div>
        ) : null}
        {phase.kind === 'FAILED' ? (
          <div className="absolute inset-0 grid place-items-center bg-[#0C1119]" role="alert" data-testid="photo-walk-failed">
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <p className="text-[15px] font-semibold">{t('dsx_photo3d_failed')}</p>
              <p className="text-2xs text-white/50" data-testid="photo-walk-code">{phase.code}</p>
              <button type="button" onClick={retry} className={cn('inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-[#0C1119]', RING)}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('dsx_walk_retry')}
              </button>
            </div>
          </div>
        ) : null}
        {phase.kind === 'READY' ? (
          <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-full bg-black/45 px-4 py-2 text-center text-[13px] text-white" data-testid="photo-walk-hint"
            data-approximate={phase.approximate ? 'yes' : 'no'} data-reason={phase.reason || undefined}>{t(elsewhere.length ? 'dsx_tour_hint' : 'dsx_photo3d_hint')}</p>
        ) : null}
        {phase.kind === 'READY' ? elsewhere.map((p, i) => (
          <button key={p.id} ref={(b) => { spots.current[i] = b; }} type="button" onClick={() => setActiveId(p.id)}
            style={{ visibility: 'hidden' }} aria-label={t('dsx_tour_go', { room: p.label })}
            className={cn('group absolute left-0 top-0 flex flex-col items-center gap-1.5', RING)} data-testid="photo-walk-spot">
            <span className="relative grid h-12 w-12 place-items-center" aria-hidden="true">
              <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(38_92%_56%)]/40" />
              <span className="relative h-7 w-7 rounded-full border-[3px] border-white bg-[hsl(38_92%_56%)] shadow-[0_4px_16px_rgba(0,0,0,0.45)] transition-transform group-hover:scale-110" />
            </span>
            <span className="max-w-[9rem] truncate rounded-full bg-black/60 px-3 py-1 text-[13px] font-semibold text-white backdrop-blur-sm">{p.label}</span>
          </button>
        )) : null}
        <div ref={stick} className={cn('absolute bottom-[max(env(safe-area-inset-bottom),20px)] start-5 grid h-28 w-28 touch-none place-items-center rounded-full ring-2 ring-white/40', phase.kind === 'READY' ? '' : 'hidden')}
          aria-label={t('dsx_photo3d_move')} role="application" data-testid="photo-walk-stick">
          <div ref={knob} className="h-12 w-12 rounded-full bg-white/70" />
        </div>
      </div>
      {playing ? (
        <Suspense fallback={null}>
          <SnakeGame
            status={phase.kind === 'READY' ? 'READY' : phase.kind === 'FAILED' ? 'FAILED' : 'PROCESSING'}
            stageLabel={t(phase.kind === 'LOADING' && phase.measuring ? 'dsx_photo3d_measuring' : 'dsx_photo3d_loading')}
            onView={() => setPlaying(false)} onClose={() => setPlaying(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}

export default PhotoWalk;

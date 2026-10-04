// THE HOME IN 360° — stand in a room, look all the way round, walk through its doors.
//
// Each room is four eye-level pictures of the design taken from the room's
// centre a quarter turn apart (tour/roomViews.ts): set round the visitor they
// close the room, so a drag turns a full circle. The plan puts a point on
// every door, named for the room behind it; a tap walks through that door and
// the visitor stands in the next room still facing the way they walked. Every
// pixel is the design's own picture: nothing is rebuilt.

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { VIEW_HFOV_DEG } from '@/lib/designStudio/tour/roomViews';
import { loadPicture, type PictureRef } from './loadPicture';

const SnakeGame = lazy(() => import('@/components/games/SnakeGame'));

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const ROUND = cn('grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20', RING);

/** One room of the tour: its four pictures (heading 0..3) and its doors. */
export interface PanoRoom {
  id: string;
  label: string;
  views: [PictureRef, PictureRef, PictureRef, PictureRef];
  /** Doors to other rooms of the tour, by clockwise bearing from heading 0. */
  doors: Array<{ toRoomId: string; bearingDeg: number }>;
}

type Phase = { kind: 'LOADING' } | { kind: 'READY' } | { kind: 'FAILED'; code: string };

/** The direction of a clockwise bearing (0 = heading 0) in the viewer's space: −z ahead, +x to the right. */
const dirOf = (deg: number) => { const a = (deg * Math.PI) / 180; return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)); };

export function PanoramaWalk({ rooms, initialId, onClose }: { rooms: PanoRoom[]; initialId: string; onClose: () => void }) {
  const { t, isRTL } = useLanguage();
  const [roomId, setRoomId] = useState(initialId);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING' });
  const host = useRef<HTMLDivElement>(null);
  const spots = useRef<Array<HTMLButtonElement | null>>([]);
  // Where the visitor faces (clockwise degrees): kept through a door, so the next room opens the way they walked.
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  const doors = (room?.doors ?? []).filter((d) => rooms.some((r) => r.id === d.toRoomId)).slice(0, 12);
  const doorsRef = useRef(doors);
  doorsRef.current = doors;
  const labelOf = (id: string) => rooms.find((r) => r.id === id)?.label ?? '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  useEffect(() => {
    const el = host.current;
    if (!el || !room) return;
    let disposed = false;
    let frame = 0;
    setPhase({ kind: 'LOADING' });
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, 1, 0.01, 50);
    camera.rotation.order = 'YXZ';
    let pitchMax = 0.3;

    const size = () => {
      const w = el.clientWidth || 1; const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      // A tall phone sees more height, a wide screen more of the room round it.
      camera.fov = w < h ? 72 : 58;
      camera.updateProjectionMatrix();
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(el);

    // Looking: drag anywhere (a full circle round; up and down as far as the pictures reach), or the arrow keys.
    let drag: { id: number; x: number; y: number; moved: number } | null = null;
    const down = (e: PointerEvent) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; renderer.domElement.setPointerCapture(e.pointerId); };
    const moveP = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const k = camera.fov / Math.max(1, el.clientHeight);
      yawRef.current -= (e.clientX - drag.x) * k;
      pitchRef.current = Math.max(-pitchMax, Math.min(pitchMax, pitchRef.current + ((e.clientY - drag.y) * k * Math.PI) / 180));
      drag = { ...drag, x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(e.clientX - drag.x) };
    };
    const up = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    const keys = new Set<string>();
    const keyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
    const keyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', moveP);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);

    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (keys.has('arrowleft') || keys.has('a')) yawRef.current -= 70 * dt;
      if (keys.has('arrowright') || keys.has('d')) yawRef.current += 70 * dt;
      camera.rotation.set(pitchRef.current, (-yawRef.current * Math.PI) / 180, 0);
      renderer.render(scene, camera);
      camera.updateMatrixWorld();
      const w = el.clientWidth; const h = el.clientHeight;
      const list = doorsRef.current;
      for (let i = 0; i < spots.current.length; i += 1) {
        const b = spots.current[i];
        if (!b) continue;
        const d = list[i];
        const at = d ? dirOf(d.bearingDeg).multiplyScalar(0.9).setY(-0.16).project(camera) : null;
        const shown = !!at && at.z < 1 && Math.abs(at.x) < 1.1 && Math.abs(at.y) < 1.1;
        b.style.visibility = shown ? 'visible' : 'hidden';
        if (at && shown) b.style.transform = `translate(${((at.x + 1) / 2) * w}px, ${((1 - at.y) / 2) * h}px) translate(-50%, -50%)`;
      }
    };

    let stage = 'PICTURE';
    (async () => {
      try {
        const imgs = await Promise.all(room.views.map((v) => loadPicture(v, (s) => { stage = s; })));
        if (disposed) return;
        stage = 'BUILD';
        // Four walls of pictures round the visitor, each a quarter of the circle at one unit away.
        const half = Math.tan(((VIEW_HFOV_DEG / 2) * Math.PI) / 180);
        let topColour = new THREE.Color(0x222222); let bottomColour = new THREE.Color(0x222222);
        const sample = (img: HTMLImageElement, top: boolean) => {
          const c = document.createElement('canvas'); c.width = 16; c.height = 4;
          const g = c.getContext('2d');
          if (!g) return null;
          g.drawImage(img, 0, top ? 0 : img.naturalHeight * 0.96, img.naturalWidth, img.naturalHeight * 0.04, 0, 0, 16, 4);
          const d = g.getImageData(0, 0, 16, 4).data;
          let r = 0; let gg = 0; let bb = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
          const n = d.length / 4;
          return new THREE.Color(`rgb(${Math.round(r / n)}, ${Math.round(gg / n)}, ${Math.round(bb / n)})`);
        };
        let tallest = 0;
        imgs.forEach((img, k) => {
          const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
          const width = 2 * half; const height = width / aspect;
          tallest = Math.max(tallest, height);
          const texture = new THREE.Texture(img);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          texture.needsUpdate = true;
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
          const a = (k * Math.PI) / 2;
          plane.position.set(Math.sin(a), 0, -Math.cos(a));
          plane.rotation.y = -a;
          scene.add(plane);
          if (k === 0) { topColour = sample(img, true) ?? topColour; bottomColour = sample(img, false) ?? bottomColour; }
        });
        // Above and below the pictures: the ceiling's and the floor's own colour, never an invented surface.
        const cap = (y: number, colour: THREE.Color) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * half + 0.02, 2 * half + 0.02), new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }));
          m.rotation.x = Math.PI / 2; m.position.y = y; scene.add(m);
        };
        cap(tallest / 2, topColour);
        cap(-tallest / 2, bottomColour);
        scene.background = bottomColour.clone().multiplyScalar(0.5);
        // Up and down only as far as the pictures go.
        pitchMax = Math.max(0, Math.atan(tallest / 2) - ((camera.fov / 2) * Math.PI) / 180) + 0.12;
        setPhase({ kind: 'READY' });
        frame = requestAnimationFrame(tick);
        // The rooms behind this room's doors are prepared while it is looked at: a tap opens them at once.
        for (const d of doorsRef.current) {
          const next = rooms.find((r) => r.id === d.toRoomId);
          if (!next || disposed) continue;
          for (const v of next.views) { if (disposed) return; await loadPicture(v).catch(() => null); }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[panorama-walk]', stage, e);
        if (!disposed) setPhase({ kind: 'FAILED', code: stage });
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        if (mat) { mat.map?.dispose(); mat.dispose(); }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [room?.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((id: string) => { pitchRef.current = 0; setRoomId(id); }, []);
  const reset = () => { yawRef.current = 0; pitchRef.current = 0; };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0C1119] text-white" role="dialog" aria-modal="true" aria-label={t('dsx_photo3d_title')} data-testid="pano-walk" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(env(safe-area-inset-top),12px)]">
        <h2 className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold" data-testid="pano-room">{room?.label}</h2>
        <button type="button" onClick={reset} className={ROUND} aria-label={t('dsx_photo3d_reset')} data-testid="pano-reset"><RotateCcw className="h-5 w-5" aria-hidden="true" /></button>
        <button type="button" onClick={onClose} className={cn(ROUND, 'bg-white text-[#0C1119] hover:bg-white/90')} aria-label={t('dsx_photo3d_close')} data-testid="pano-close"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {rooms.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2" role="tablist" aria-label={t('dsx_photo3d_pictures')}>
          {rooms.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={r.id === room?.id} onClick={() => go(r.id)}
              className={cn('min-h-10 shrink-0 rounded-full px-4 text-[14px] font-medium', RING, r.id === room?.id ? 'bg-white text-[#0C1119]' : 'bg-white/10 text-white ring-1 ring-white/20')}
              data-testid="pano-pick">{r.label}</button>
          ))}
        </div>
      ) : null}
      <div ref={host} className="relative min-h-0 flex-1 overflow-hidden">
        {phase.kind === 'LOADING' ? (
          <div className="absolute inset-0 grid place-items-center bg-[#0C1119]" role="status" aria-live="polite" data-testid="pano-loading">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              <p className="text-[15px] font-semibold">{t('dsx_photo3d_loading')}</p>
              <button type="button" onClick={() => setPlaying(true)} className={cn('mt-2 inline-flex h-11 items-center rounded-full bg-[hsl(38_92%_56%)] px-5 text-[14px] font-semibold text-[#0C1119]', RING)} data-testid="pano-snake">{t('dsx_sn_play')}</button>
            </div>
          </div>
        ) : null}
        {phase.kind === 'FAILED' ? (
          <div className="absolute inset-0 grid place-items-center bg-[#0C1119]" role="alert" data-testid="pano-failed" data-code={phase.code}>
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <p className="text-[15px] font-semibold">{t('dsx_photo3d_failed')}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn('inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-[#0C1119]', RING)}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('dsx_walk_retry')}
              </button>
            </div>
          </div>
        ) : null}
        {phase.kind === 'READY' ? (
          <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-full bg-black/45 px-4 py-2 text-center text-[13px] text-white" data-testid="pano-hint">{t(doors.length ? 'dsx_pano_hint' : 'dsx_pano_hint_alone')}</p>
        ) : null}
        {phase.kind === 'READY' ? doors.map((d, i) => (
          <button key={`${d.toRoomId}-${i}`} ref={(b) => { spots.current[i] = b; }} type="button" onClick={() => go(d.toRoomId)}
            style={{ visibility: 'hidden' }} aria-label={t('dsx_tour_go', { room: labelOf(d.toRoomId) })}
            className={cn('group absolute left-0 top-0 flex flex-col items-center gap-1.5', RING)} data-testid="pano-door">
            <span className="relative grid h-12 w-12 place-items-center" aria-hidden="true">
              <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(38_92%_56%)]/40" />
              <span className="relative h-7 w-7 rounded-full border-[3px] border-white bg-[hsl(38_92%_56%)] shadow-[0_4px_16px_rgba(0,0,0,0.45)] transition-transform group-hover:scale-110" />
            </span>
            <span className="max-w-[9rem] truncate rounded-full bg-black/60 px-3 py-1 text-[13px] font-semibold text-white backdrop-blur-sm">{labelOf(d.toRoomId)}</span>
          </button>
        )) : null}
      </div>
      {playing ? (
        <Suspense fallback={null}>
          <SnakeGame status={phase.kind === 'READY' ? 'READY' : phase.kind === 'FAILED' ? 'FAILED' : 'PROCESSING'} stageLabel={t('dsx_photo3d_loading')}
            onView={() => setPlaying(false)} onClose={() => setPlaying(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}

export default PanoramaWalk;

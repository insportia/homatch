import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/*
 * HOMI, 3D — the homepage character.
 *
 * The model is the approved HOMI master (homatch-video Blender file), exported
 * once to public/models/homi/homi.glb with pivot groups for the head, eyes and
 * both arms. Nothing is generated at runtime; every movement below is a
 * deterministic function of time, pointer and the requested gesture.
 *
 * Cost control: this module (and three.js with it) is only loaded when the
 * section is near the viewport; it renders only while on screen and the tab
 * is visible; 30 fps on touch devices; a single still frame under reduced
 * motion. Any failure falls back to the 2D HOMI via `onFail`.
 */

export type HomiGesture = 'idle' | 'greeting' | 'pointing' | 'explaining' | 'happy';

export interface HomiStage3DProps {
  gesture: HomiGesture;
  /** Where to point, in the stage's own horizontal space: -1 left … 1 right. */
  pointTo?: number;
  onFail: () => void;
  onReady?: () => void;
  className?: string;
}

const MODEL_URL = '/models/homi/homi.glb';

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

export default function HomiStage3D({ gesture, pointTo = 1, onFail, onReady, className }: HomiStage3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ g: HomiGesture; at: number; point: number }>({ g: gesture, at: 0, point: pointTo });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    gestureRef.current = { g: gesture, at: performance.now(), point: pointTo };
  }, [gesture, pointTo]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      onFail();
      return;
    }
    const still = reducedMotion();
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    camera.position.set(0, 0.92, 4.0);
    camera.lookAt(0, 0.84, 0);

    scene.add(new THREE.HemisphereLight(0xf3f5f8, 0x1a1f2b, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.6, 2.6, 3.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xf5b445, 1.6); // the brand's gold, from behind
    rim.position.set(-2.2, 1.8, -2.4);
    scene.add(rim);

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(el);

    const parts: Record<string, THREE.Object3D | undefined> = {};
    const rest = new Map<THREE.Object3D, { r: THREE.Euler; p: THREE.Vector3 }>();
    let root: THREE.Object3D | null = null;

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/three/draco/');
    loader.setDRACOLoader(draco);
    loader.loadAsync(MODEL_URL).then((gltf) => {
      if (disposed) return;
      root = gltf.scene;
      root.traverse((o) => {
        if (/^HOMI_(HEAD|EYE_L|EYE_R|BROW_L|BROW_R|MOUTH|ARM_L|ARM_R|FOREARM_L|FOREARM_R)$/.test(o.name)) {
          parts[o.name] = o;
          rest.set(o, { r: o.rotation.clone(), p: o.position.clone() });
        }
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          /* The LED and eye materials glow on the visor; give them the
             emissive the renderer needs to read them as light. */
          if (mat && /LED|Eye_Iris|Ear_Glass/i.test(mat.name)) {
            mat.emissive = new THREE.Color(0x4fb2ff);
            mat.emissiveIntensity = /Iris/.test(mat.name) ? 0.9 : 1.6;
          }
        }
      });
      scene.add(root);
      draco.dispose();
      setLoaded(true);
      onReady?.();
      renderOnce();
    }).catch(() => { if (!disposed) onFail(); });

    const pointer = { x: 0, y: 0, active: false };
    const onPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2))));
      pointer.y = Math.max(-1, Math.min(1, ((e.clientY - (r.top + r.height * 0.3)) / (window.innerHeight / 2))));
      pointer.active = true;
    };
    if (!coarse && !still) window.addEventListener('pointermove', onPointer, { passive: true });

    /* Current values, eased toward targets every frame. */
    const cur = { headY: 0, headX: 0, eyeX: 0, eyeY: 0, armR: 0, foreR: 0, armL: 0, foreL: 0, bob: 0 };
    const apply = (name: string, f: (o: THREE.Object3D, base: { r: THREE.Euler; p: THREE.Vector3 }) => void) => {
      const o = parts[name]; const base = o && rest.get(o);
      if (o && base) f(o, base);
    };

    const pose = (t: number, dt: number) => {
      const { g, at, point } = gestureRef.current;
      const since = (performance.now() - at) / 1000;
      const k = still ? 1000 : 6;
      const breath = still ? 0 : Math.sin(t * 1.7);
      let headY = pointer.active ? pointer.x * 0.35 : Math.sin(t * 0.37) * 0.12 * (still ? 0 : 1);
      let headX = pointer.active ? pointer.y * 0.12 : 0;
      let eyeX = pointer.active ? pointer.x : Math.sin(t * 0.61) * 0.4 * (still ? 0 : 1);
      let eyeY = pointer.active ? pointer.y : 0;
      let armR = 0.08, foreR = 0, armL = -0.08, foreL = 0;
      const wave = still ? 0 : Math.sin(t * 9);
      if (g === 'greeting' && since < 3.2) {
        armR = -2.5; foreR = -0.35 + wave * 0.35; headY = 0.1; headX = -0.05;
      } else if (g === 'pointing') {
        /* The arm on the side of the target rises toward it. */
        if (point >= 0) { armL = 1.35; foreL = 0.15; headY = 0.35; eyeX = 1; }
        else { armR = -1.35; foreR = -0.15; headY = -0.35; eyeX = -1; }
      } else if (g === 'explaining') {
        armL = 0.55 + (still ? 0 : Math.sin(t * 2.2) * 0.08); foreL = 0.9;
      } else if (g === 'happy') {
        armL = 1.9; armR = -1.9; foreL = 0.4; foreR = -0.4;
      }
      cur.headY = damp(cur.headY, headY, k, dt); cur.headX = damp(cur.headX, headX, k, dt);
      cur.eyeX = damp(cur.eyeX, eyeX, k * 1.6, dt); cur.eyeY = damp(cur.eyeY, eyeY, k * 1.6, dt);
      cur.armR = damp(cur.armR, armR, k, dt); cur.foreR = damp(cur.foreR, foreR, k, dt);
      cur.armL = damp(cur.armL, armL, k, dt); cur.foreL = damp(cur.foreL, foreL, k, dt);
      cur.bob = breath * 0.008;

      apply('HOMI_HEAD', (o, b) => { o.rotation.set(b.r.x + cur.headX, b.r.y + cur.headY, b.r.z); });
      for (const side of ['EYE_L', 'EYE_R']) {
        apply(`HOMI_${side}`, (o, b) => { o.position.set(b.p.x + cur.eyeX * 0.012, b.p.y - cur.eyeY * 0.008, b.p.z); });
      }
      apply('HOMI_ARM_R', (o, b) => { o.rotation.set(b.r.x, b.r.y, b.r.z + cur.armR); });
      apply('HOMI_FOREARM_R', (o, b) => { o.rotation.set(b.r.x, b.r.y, b.r.z + cur.foreR); });
      apply('HOMI_ARM_L', (o, b) => { o.rotation.set(b.r.x, b.r.y, b.r.z + cur.armL); });
      apply('HOMI_FOREARM_L', (o, b) => { o.rotation.set(b.r.x, b.r.y, b.r.z + cur.foreL); });
      if (root) root.position.y = cur.bob;
    };

    let raf = 0, last = performance.now(), lastFrame = 0;
    let visible = true;
    const minFrame = coarse ? 33 : 16;
    const renderOnce = () => { pose(performance.now() / 1000, 1); renderer.render(scene, camera); };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden || !root || now - lastFrame < minFrame) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now; lastFrame = now;
      pose(now / 1000, dt);
      renderer.render(scene, camera);
    };
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); })
      : null;
    io?.observe(el);
    if (!still) raf = requestAnimationFrame(tick);
    /* Under reduced motion, re-render once when the gesture changes. */
    const stillTimer = still ? window.setInterval(() => { if (root) renderOnce(); }, 400) : 0;

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (stillTimer) window.clearInterval(stillTimer);
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener('pointermove', onPointer);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat?.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={className} data-homi-3d={loaded ? 'ready' : 'loading'} />;
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { TwinScene, TwinSchematicFloor } from '@/services/developer/twin';

/**
 * THE VIEWER. REAL THREE.JS, RUNNING ON THE VISITOR'S OWN DEVICE.
 *
 * WHY THIS AND NOT A STREAMING PROVIDER. A pixel-streamed Unreal or Unity
 * scene costs a GPU-second per viewer-second. At a million opens a month that
 * is a bill that scales with success and cannot be optimised away, and it is
 * why most developer 3D is either gated behind a form or quietly switched off
 * after the launch campaign. This renders locally: our marginal cost per open
 * is the bytes, once, and then the CDN's cache. No per-view cost, no per-unit
 * cost, no seat licence, no runtime we do not control.
 *
 * ON-DEMAND RENDERING, WHICH IS MOST OF THE BATTERY STORY. There is no
 * permanent requestAnimationFrame loop. A frame is drawn when something
 * actually changed — the camera moved, a model finished loading, the canvas
 * was resized — and then the loop stops. A visitor who opens this and reads
 * the description for a minute costs one frame, not three thousand six
 * hundred, and their phone stays cool.
 *
 * TWO MODES, AND THE LINE BETWEEN THEM IS NOT BLURRED.
 *
 *   MODEL      Geometry authored by Homatch studio staff and published. This
 *              is the building.
 *   SCHEMATIC  No geometry has been authored yet, so this draws stacked floor
 *              plates from the REAL inventory — one plate per floor that
 *              exists, sized by how many apartments are on it, coloured and
 *              LABELLED by availability. It is a diagram of the stock, it
 *              says so on the canvas, and it is never presented as the
 *              architecture. Inventing a plausible-looking tower from nothing
 *              would be a lie told in 3D, and this product does not tell it.
 *
 * STATUS IS NEVER COLOUR ALONE. The schematic marks sold and reserved plates
 * with hatching as well as tone, and every plate has its count in the panel
 * beside the canvas. A colour-blind sales director gets the same information.
 */

export type TwinMode = 'MODEL' | 'SCHEMATIC';

export interface TwinCanvasProps {
  /** A published scene, or null when none has been authored. */
  scene: TwinScene | null;
  /** Real floors, used for the schematic and for picking in both modes. */
  floors: TwinSchematicFloor[];
  /** Which floor is selected, by level. */
  activeLevel: number | null;
  onSelectLevel: (level: number) => void;
  /** Called once the first frame with content has been drawn. */
  onReady?: (mode: TwinMode) => void;
  className?: string;
}

/** Availability tones, matched to the status pills the rest of the product uses. */
const TONE = {
  available: new THREE.Color('#0f7a52'),
  partial: new THREE.Color('#b8860b'),
  gone: new THREE.Color('#6b7280'),
  shell: new THREE.Color('#d9d4cb'),
};

export default function TwinCanvas({
  scene, floors, activeLevel, onSelectLevel, onReady, className,
}: TwinCanvasProps) {
  const { t } = useLanguage();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [webglMissing, setWebglMissing] = useState(false);

  const mode: TwinMode = scene && scene.assets.length > 0 ? 'MODEL' : 'SCHEMATIC';

  /**
   * Everything mutable lives in one ref rather than in state.
   *
   * A renderer in React state would be recreated on a re-render, which on a
   * page with a details panel means rebuilding the WebGL context every time
   * somebody picks a floor — the single most common way a Three.js integration
   * leaks until the tab runs out of contexts.
   */
  const engine = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    plates: Map<number, THREE.Mesh>;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    disposables: Array<{ dispose: () => void }>;
    invalidate: () => void;
    frame: number | null;
    resizeObserver: ResizeObserver | null;
  } | null>(null);

  const selectRef = useRef(onSelectLevel);
  selectRef.current = onSelectLevel;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  // ── Boot the renderer once ───────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      // A device with no WebGL still gets the floor list beside the canvas —
      // the product does not depend on this component working.
      setWebglMissing(true);
      setLoading(false);
      return undefined;
    }

    // Capped at 2: beyond that the pixels are invisible and the fill rate is
    // not, which on a phone is heat and battery for nothing.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth || 1, mount.clientHeight || 1, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    mount.appendChild(renderer.domElement);

    const three = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45, (mount.clientWidth || 1) / (mount.clientHeight || 1), 0.1, 2000,
    );
    camera.position.set(28, 22, 32);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495; // never below the ground plane
    controls.minDistance = 6;
    controls.maxDistance = 220;
    // One finger rotates, two fingers pan and pinch — what a phone user
    // already expects from every map they have ever used.
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    /*
     * Three lights, no environment map.
     *
     * An HDRI would look better and would cost every visitor a megabyte
     * before first paint. A hemisphere fill plus one shadowless key reads
     * correctly on massing and on furnished interiors alike, and weighs
     * nothing.
     */
    three.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a6, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(14, 26, 12);
    three.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(-16, 10, -14);
    three.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xf2efe9, roughness: 1, metalness: 0,
      }),
    );
    ground.position.y = -0.02;
    ground.name = 'ground';
    three.add(ground);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const state = {
      renderer, scene: three, camera, controls,
      plates: new Map<number, THREE.Mesh>(),
      raycaster, pointer,
      disposables: [
        ground.geometry, ground.material as THREE.Material,
      ] as Array<{ dispose: () => void }>,
      frame: null as number | null,
      resizeObserver: null as ResizeObserver | null,
      invalidate: () => {},
    };

    /**
     * ON-DEMAND RENDERING.
     *
     * invalidate() asks for exactly one frame. Damping needs a few more to
     * settle, so a moving camera keeps asking until it has stopped — and then
     * the loop genuinely ends rather than idling at 60fps forever.
     */
    state.invalidate = () => {
      if (state.frame !== null) return;
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        const moving = state.controls.update();
        state.renderer.render(state.scene, state.camera);
        if (moving) state.invalidate();
      });
    };

    controls.addEventListener('change', state.invalidate);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      state.invalidate();
    });
    ro.observe(mount);
    state.resizeObserver = ro;

    engine.current = state;
    state.invalidate();

    return () => {
      // The full teardown. Anything missed here is a leaked GPU buffer that
      // survives the route change.
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      state.resizeObserver?.disconnect();
      controls.removeEventListener('change', state.invalidate);
      controls.dispose();
      disposeTree(three);
      for (const d of state.disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      engine.current = null;
    };
  }, []);

  // ── Put content in it ────────────────────────────────────────────────────
  useEffect(() => {
    const state = engine.current;
    if (!state) return undefined;

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    // Clear whatever was there, keeping the lights and the ground.
    for (const mesh of state.plates.values()) {
      state.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    state.plates.clear();
    const previous = state.scene.getObjectByName('twin-model');
    if (previous) { state.scene.remove(previous); disposeTree(previous); }

    async function build() {
      if (mode === 'MODEL' && scene) {
        try {
          const root = await loadModel(scene, state!.renderer);
          if (cancelled) { disposeTree(root); return; }
          root.name = 'twin-model';
          frameObject(root, state!.camera, state!.controls);
          state!.scene.add(root);
        } catch {
          if (cancelled) return;
          // A model that will not load falls back to the schematic rather
          // than to an empty black box.
          setFailed(true);
          buildSchematic(state!, floors);
        }
      } else {
        buildSchematic(state!, floors);
      }

      if (cancelled) return;
      highlight(state!, activeLevel);
      state!.invalidate();
      setLoading(false);
      readyRef.current?.(mode);
    }

    void build();
    return () => { cancelled = true; };
    // `floors` is compared by identity on purpose: the page memoises it, and
    // rebuilding the scene on every render would defeat the whole point.
  }, [mode, scene, floors]);

  // ── Selection is a material change, not a rebuild ────────────────────────
  useEffect(() => {
    const state = engine.current;
    if (!state) return;
    highlight(state, activeLevel);
    state.invalidate();
  }, [activeLevel]);

  // ── Picking ──────────────────────────────────────────────────────────────
  const pick = useCallback((clientX: number, clientY: number) => {
    const state = engine.current;
    const mount = mountRef.current;
    if (!state || !mount) return;
    const rect = mount.getBoundingClientRect();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);

    const targets = Array.from(state.plates.values());
    if (targets.length === 0) return;
    const hit = state.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return;
    const level = (hit.object.userData as { level?: number }).level;
    if (typeof level === 'number') selectRef.current(level);
  }, []);

  /**
   * A tap is a pick; a drag is a camera move.
   *
   * Without this distinction every attempt to rotate the building on a phone
   * also selects whatever was under the thumb when it lifted.
   */
  const down = useRef<{ x: number; y: number; t: number } | null>(null);

  const legend = useMemo(() => {
    const total = floors.reduce((n, f) => n + f.total, 0);
    const available = floors.reduce((n, f) => n + f.available, 0);
    return { total, available };
  }, [floors]);

  return (
    <div className={cn('relative h-full w-full overflow-hidden rounded-lg bg-sand/40', className)}>
      <div
        ref={mountRef}
        className="h-full w-full"
        role="application"
        aria-label={t('twin_canvas_label')}
        onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY, t: Date.now() }; }}
        onPointerUp={(e) => {
          const start = down.current;
          down.current = null;
          if (!start) return;
          const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
          if (moved < 6 && Date.now() - start.t < 600) pick(e.clientX, e.clientY);
        }}
      />

      {/* The canvas is not the only way to reach a floor. Keyboard users and
          screen readers get the same navigation from the list beside it, so
          this region is genuinely supplementary rather than a trap. */}
      <p className="sr-only">{t('twin_canvas_a11y_hint')}</p>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            <span className="text-2xs text-muted-foreground">{t('twin_loading')}</span>
          </div>
        </div>
      )}

      {webglMissing && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-muted-foreground">{t('twin_no_webgl')}</p>
        </div>
      )}

      {/* THE LABEL THAT KEEPS THIS HONEST. A schematic says it is one. */}
      {!loading && !webglMissing && mode === 'SCHEMATIC' && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[15rem] rounded-md border border-border bg-background/90 px-2.5 py-1.5 backdrop-blur">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('twin_schematic_badge')}
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {t(failed ? 'twin_model_failed' : 'twin_schematic_note')}
          </p>
        </div>
      )}

      {!loading && !webglMissing && legend.total > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-2xs backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
            {t('dev_unit_status_available')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true" />
            {t('twin_legend_partly')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gray-500" aria-hidden="true" />
            {t('twin_legend_none')}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Building the schematic ─────────────────────────────────────────────────

/**
 * One plate per floor that actually exists, stacked in level order.
 *
 * The footprint grows a little with the number of apartments on the floor, so
 * a podium with twelve units reads wider than a penthouse level with two —
 * which is true of most buildings and, more importantly, is derived from the
 * inventory rather than invented.
 */
function buildSchematic(
  state: NonNullable<React.RefObject<{
    scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    controls: OrbitControls; plates: Map<number, THREE.Mesh>;
  }>['current']>,
  floors: TwinSchematicFloor[],
): void {
  if (floors.length === 0) return;

  const ordered = [...floors].sort((a, b) => a.level - b.level);
  const maxUnits = Math.max(...ordered.map((f) => f.total), 1);
  const plateHeight = 1.6;
  const gap = 0.18;

  ordered.forEach((floor, index) => {
    const spread = 9 + (floor.total / maxUnits) * 5;
    const geometry = new THREE.BoxGeometry(spread, plateHeight, spread * 0.68);

    const ratio = floor.total > 0 ? floor.available / floor.total : 0;
    const colour = ratio >= 0.999 ? TONE.available
      : ratio > 0 ? TONE.partial
        : floor.total > 0 ? TONE.gone : TONE.shell;

    const material = new THREE.MeshStandardMaterial({
      color: colour.clone(),
      roughness: 0.72,
      metalness: 0.04,
      transparent: true,
      opacity: floor.total === 0 ? 0.35 : 0.92,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = index * (plateHeight + gap) + plateHeight / 2;
    mesh.userData = { level: floor.level, baseColor: colour.clone() };
    mesh.name = `plate-${floor.level}`;
    state.scene.add(mesh);
    state.plates.set(floor.level, mesh);
  });

  /*
   * FRAME WHAT IS THERE, NOT A CONSTANT.
   *
   * The camera used to sit at a fixed distance with a floor of 26 units, which
   * suits a tower and strands a three-storey block in the middle of an empty
   * frame — most of the picture sky, the building a chip at the centre. The
   * distance now comes from the massing's own bounding sphere and the camera's
   * field of view, so a podium and a forty-floor tower are both framed the
   * same way: filling the shot with a margin around them.
   */
  const height = ordered.length * (plateHeight + gap);
  const widest = 9 + 5;
  const radius = Math.hypot(widest, height, widest * 0.68) / 2;
  const fov = (state.camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 0.82;

  state.controls.target.set(0, height / 2, 0);
  state.camera.position.set(distance * 0.62, height * 0.55 + radius * 0.42, distance * 0.7);
  state.camera.updateProjectionMatrix();
  state.controls.update();
}

/** The selected plate gets a gold emissive edge — never colour alone, the
 *  panel beside the canvas names the floor at the same time. */
function highlight(
  state: { plates: Map<number, THREE.Mesh> }, activeLevel: number | null,
): void {
  for (const [level, mesh] of state.plates) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const base = (mesh.userData as { baseColor?: THREE.Color }).baseColor;
    if (level === activeLevel) {
      material.emissive = new THREE.Color('#C8A951');
      material.emissiveIntensity = 0.45;
      material.opacity = 1;
    } else {
      material.emissive = new THREE.Color('#000000');
      material.emissiveIntensity = 0;
      material.opacity = base && base.equals(TONE.shell) ? 0.35 : 0.92;
    }
    material.needsUpdate = true;
  }
}

// ── Loading authored geometry ──────────────────────────────────────────────

/**
 * glTF with Draco, Meshopt and KTX2 all wired up.
 *
 * These three are the difference between a building that is 60MB and one that
 * is 4MB, and they are why this can be served from a CDN rather than streamed
 * from a GPU. The decoders come from the same pinned `three` package as the
 * loader, so there is no CDN dependency at runtime and no version skew.
 */
async function loadModel(scene: TwinScene, renderer: THREE.WebGLRenderer): Promise<THREE.Object3D> {
  const { assetUrl } = await import('@/services/developer/twin');

  // GEOMETRY is the kind that carries the building; a scene may also ship a
  // panorama, an HDRI or floor plans, and none of those goes to the glTF
  // loader. The mime and extension checks are the fallback for an older row
  // written before the kind was being set carefully.
  const primary = scene.assets.find((a) => a.kind === 'GEOMETRY')
    ?? scene.assets.find(
      (a) => a.mime?.includes('gltf') || /\.(glb|gltf)$/i.test(a.storage_key),
    );
  if (!primary) throw new Error('scene has no deliverable geometry');

  const loader = new GLTFLoader();

  /* Served from our own origin at a fixed, unhashed path — see the
     homatch:three-decoders plugin in vite.config.ts. Not a CDN: a viewer that
     stops working because somebody else's free tier changed is not a viewer
     we own. */
  const draco = new DRACOLoader();
  draco.setDecoderPath('/three/draco/');
  loader.setDRACOLoader(draco);

  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath('/three/basis/');
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);

  loader.setMeshoptDecoder(MeshoptDecoder);

  try {
    const gltf = await loader.loadAsync(assetUrl(primary));
    return gltf.scene;
  } finally {
    draco.dispose();
    ktx2.dispose();
  }
}

/** Point the camera at whatever was just loaded, whatever size it is. */
function frameObject(
  object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls,
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 10;
  const distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.6;

  controls.target.copy(centre);
  camera.position.set(
    centre.x + distance * 0.62,
    centre.y + Math.max(radius * 0.7, size.y * 0.6),
    centre.z + distance * 0.72,
  );
  camera.near = Math.max(0.05, distance / 800);
  camera.far = distance * 12;
  camera.updateProjectionMatrix();
  controls.update();
}

/** Every geometry, material and texture under a node, released. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      m.dispose();
    }
  });
}

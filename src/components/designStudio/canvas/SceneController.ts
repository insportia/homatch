// THE DESIGN STUDIO SCENE — imperative three.js, rendered on demand.
//
// One class owns the WebGL context for a workspace: it builds the space from
// a SpaceModel (or loads a GLB for model sources), dresses surfaces and
// places objects from the design state, answers picking, highlights the
// selection, moves the camera, and cleans every GPU resource on dispose.
//
// RENDERING IS ON DEMAND. A frame is drawn when something changed — camera
// movement, a design change, a resize — and while damping or a camera
// transition is still settling; never on a permanent loop. A workspace left
// open on a phone must not hold the GPU awake.
//
// It never decides anything about the design. It is told the state and
// draws it; the deterministic engine decides what the state is.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyFinish, patternOfMaterial, type SurfacePattern } from './finishTextures.ts';
import {
  ceilingSurfaceId, floorSurfaceId, wallSlabPlacement, type SpaceModel, type SpaceRoom,
} from '@/lib/designStudio/space';
import { sliceWall, type WallSlab } from '@/lib/floorplan/slabs';
import type { QualityProfile } from '@/lib/designStudio/quality';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import type { DesignState, ObjectInstance } from '@/lib/designStudio/designState';
import { PAINTABLE_ROLES, type PartRole } from '@/lib/designStudio/modelParts';
import { EYE_HEIGHT_M, doorsOnRoute, findPath, nearestFree, setDoorClosed, type WalkModel } from '@/lib/designStudio/navigation';
import {
  easeInOut as easeInOutCubic, isActiveState, validateInteractions, type ActionCode, type InteractionRole, type InteractionSpec,
} from '@/lib/designStudio/interactions';
import {
  DEFAULT_SETTINGS, REACH_M, canWalk, look, normalizeSettings, postureTransition, stepBody, wishVelocity,
  type PlayerSettings, type Posture,
} from '@/lib/designStudio/player';
import { LivingRuntime, type LiveEntry } from './livingRuntime';
import { roomContaining, wallFrame, type Point } from '@/lib/designStudio/space';
import { buildProcedural, setFinishBudget, slotColors } from './procedural';

export type PickTarget =
  | { kind: 'surface'; id: string; roomId: string | null }
  | { kind: 'object'; id: string; roomId: string | null }
  | { kind: 'room'; id: string }
  /** An identified piece of furniture inside an uploaded model. */
  | { kind: 'part'; id: string }
  /** The rotate handle around a selected piece. */
  | { kind: 'handle'; id: string }
  | { kind: 'model' };

/** How an uploaded model is shown upright and at metre scale; the file itself is never changed. */
export interface ModelTransform { scale: number; upAxis: 'Y' | 'Z' }

export interface ModelPartBinding { id: string; role: PartRole; object: THREE.Object3D }

interface PartMaterial {
  material: THREE.MeshStandardMaterial;
  original: { color: THREE.Color; map: THREE.Texture | null; roughness: number; metalness: number };
}

export type ViewMode = 'OVERVIEW' | 'TOP' | 'ROOM' | 'WALK';

/** A place to stand and a direction to look, in plan metres (from the Camera Director). */
export interface WalkPose { position: Point; target: Point; fov: number }

/** What the visitor is pointing at: shown as a quiet hint, never a game icon. */
export interface AimHint { role: InteractionRole; open: boolean; actions: ActionCode[] }

/** The walkthrough's time of day. */
export type TimeOfDayEnv = 'DAY' | 'SUNSET' | 'EVENING' | 'NIGHT';

/** Skirting board: 7 cm high, 1.2 cm proud of the wall face. */
const SKIRT_H = 0.07;
const SKIRT_D = 0.012;

/** A soft darkening under a piece: grounds it on the floor on every tier (no shadow maps needed). */
let contactTexture: THREE.Texture | null = null;
let contactGeometry: THREE.PlaneGeometry | null = null;
function contactShadow(w: number, d: number): THREE.Mesh {
  if (!contactTexture && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.6, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    }
    contactTexture = new THREE.CanvasTexture(c);
  }
  contactGeometry ??= new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Mesh(contactGeometry, new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.scale.set(w * 1.18 + 0.12, d * 1.18 + 0.12, 1);
  m.renderOrder = -1;
  m.raycast = () => {};
  m.name = 'contact-shadow';
  m.userData.decor = true;
  return m;
}

/** An object's box from what it is made of (its contact shadow is not the object). */
function solidBox(node: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  node.updateMatrixWorld(true);
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.decor) box.expandByObject(o, false);
  });
  return box;
}

interface LightRig {
  sun: number; sunColor: THREE.Color; sunPos: THREE.Vector3; hemi: number;
  interior: number; interiorColor: THREE.Color; background: THREE.Color;
  /** Image-based light (reflections, soft fill), scaled with daylight. */
  env: number;
}

/**
 * A design-preview lighting setup for a time of day and an interior light
 * colour. Not a lux calculation, and never presented as one.
 */
function lightRig(l: { timeOfDay: TimeOfDayEnv; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interiorIntensity: number }): LightRig {
  const kelvin = l.temperature === 'WARM' ? 0xffd8a8 : l.temperature === 'COOL' ? 0xdfe9ff : 0xfff3e2;
  const day = l.timeOfDay === 'DAY' ? 1 : l.timeOfDay === 'SUNSET' ? 0.62 : l.timeOfDay === 'EVENING' ? 0.4 : 0.07;
  const sunColor = l.timeOfDay === 'SUNSET' ? 0xff9a5a : l.timeOfDay === 'EVENING' ? 0xffc59a : l.timeOfDay === 'NIGHT' ? 0x9fb4e0 : 0xffffff;
  // The sun lowers toward the horizon through the evening; at night it is the moon's cool fill.
  const sunPos = l.timeOfDay === 'DAY' ? [8, 14, 6] : l.timeOfDay === 'SUNSET' ? [14, 3.5, 4] : l.timeOfDay === 'EVENING' ? [12, 5, 8] : [-6, 12, -8];
  const bg = l.timeOfDay === 'NIGHT' ? 0x1c2230 : l.timeOfDay === 'EVENING' ? 0x4a4f66 : l.timeOfDay === 'SUNSET' ? 0xe9b48a : TONE.background;
  return {
    sun: 1.5 * day,
    sunColor: new THREE.Color(sunColor),
    sunPos: new THREE.Vector3(sunPos[0], sunPos[1], sunPos[2]),
    hemi: 0.3 + 1.05 * day,
    interior: (1 - day) * 1.3 * Math.max(0, Math.min(1, l.interiorIntensity)) + 0.1,
    interiorColor: new THREE.Color(kelvin),
    background: new THREE.Color(bg),
    env: 0.06 + 0.34 * day,
  };
}

/** How long a hover aim lingers over bare floor (time to reach the hint with the mouse). */
const AIM_LINGER_MS = 1200;

const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** What the walkthrough tells the page: where you are, what you aim at, how you stand, and when to show the menu. */
export interface WalkCallbacks {
  onRoom?: (roomId: string | null) => void;
  onAim?: (hint: AimHint | null) => void;
  onSeat?: (posture: 'SIT' | 'LIE' | null) => void;
  onPosture?: (posture: Posture) => void;
  /** Esc (or the mouse released by Esc): open the walkthrough menu. */
  onMenu?: () => void;
  onLock?: (locked: boolean) => void;
}

export interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

interface PickData { pick: PickTarget }

const TONE = {
  background: 0xdfe3e8,
  ground: 0xd3d8df,
  wallBody: 0xfbfaf8,
  wallTop: 0x2a3140, // the cut: walls read as a drawn plan from above
  wallFace: 0xf7f5f1,
  wallEdge: 0x8b93a1,
  floor: 0xd8c4a6, // neutral light oak until a design says otherwise
  outdoor: 0xc3cabe,
  ceiling: 0xfbfbf9,
  select: 0xe8a33a, // HOMATCH gold
  hover: 0xf2c46b,
};

/** Ease for camera transitions. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class SceneController {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private mount: HTMLElement;
  private quality: QualityProfile;
  private reducedMotion: boolean;
  private frameQueued = false;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private listeners = new Set<() => void>();

  /** Everything built for the current space; cleared as a unit. */
  private spaceGroup = new THREE.Group();
  private modelGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private disposables = new Set<{ dispose: () => void }>();

  private space: SpaceModel | null = null;
  private surfaceMeshes = new Map<string, THREE.Mesh[]>();
  private surfaceMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private ceilingMeshes: THREE.Mesh[] = [];
  private wallBodies: THREE.Mesh[] = [];
  /** Everything drawn for one wall, so the cutaway can hide it as a unit. */
  private partMeshes = new Map<string, THREE.Mesh[]>();
  private partMaterials = new Map<string, PartMaterial[]>();
  private partRoots = new Map<string, THREE.Object3D>();
  private wallParts = new Map<string, { start: { x: number; y: number }; end: { x: number; y: number }; meshes: THREE.Object3D[] }>();
  private cutawayEnabled = true;
  private cutawayKey = '';
  /** How far around the look-at point walls count as "in front of what I am looking at". */
  private focusRadius = 0;
  private raycaster = new THREE.Raycaster();

  private transition: {
    from: { pos: THREE.Vector3; target: THREE.Vector3 };
    to: { pos: THREE.Vector3; target: THREE.Vector3 };
    start: number; duration: number;
  } | null = null;

  private selectionOutline: THREE.Object3D | null = null;
  private hoverOutline: THREE.Object3D | null = null;
  private view: ViewMode = 'OVERVIEW';
  private ceilingsShown = false;
  private walk: {
    model: WalkModel;
    pos: Point;
    yaw: number;
    pitch: number;
    keys: Set<string>;
    stick: { x: number; y: number };
    last: number;
    saved: CameraSnapshot;
    room: string | null;
    onRoom?: (roomId: string | null) => void;
    glide: {
      from: Point; fromYaw: number; to: Point; toYaw: number;
      fromEye: number; toEye: number; fromPitch: number; toPitch: number;
      start: number; duration: number;
    } | null;
    /** Eye height: standing, or lower when sitting or lying down. */
    eye: number;
    seated: { objectId: string; posture: 'SIT' | 'LIE'; returnTo: Point } | null;
    /** Plan velocity (m/s): a body speeds up and slows down. */
    vel: Point;
    /** Shift (or a full push of the stick): a brisk walk. */
    brisk: boolean;
    posture: Posture;
    /** A route being walked for the visitor (Live Here). */
    route: { points: Point[]; i: number; doors: Set<string>; face: Point; faceHeight: number; done: (arrived: boolean) => void; stuck?: number } | null;
  } | null = null;

  constructor(mount: HTMLElement, quality: QualityProfile, options: { reducedMotion?: boolean } = {}) {
    this.mount = mount;
    this.quality = quality;
    this.reducedMotion = !!options.reducedMotion;
    this.baseReducedMotion = this.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
    this.renderer.setSize(mount.clientWidth || 1, mount.clientHeight || 1, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral tone mapping keeps whites white and a paint colour the colour
    // it was chosen as; ACES shifts both, which matters in a design tool.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    mount.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(TONE.background);
    this.camera = new THREE.PerspectiveCamera(50, (mount.clientWidth || 1) / (mount.clientHeight || 1), 0.05, 500);
    this.camera.position.set(8, 10, 10);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 80;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', this.requestRender);
    this.controls.addEventListener('start', () => this.normalFrustum());

    this.living = new LivingRuntime({
      reducedMotion: this.reducedMotion,
      // Measured: each forward-rendered light costs every pixel; four nearest lights look the same as twelve.
      maxLights: quality.tier === 'HIGH' ? 4 : quality.tier === 'BALANCED' ? 3 : 2,
      lightParent: this.scene,
      onDoor: (doorId, blocks) => { if (this.walk) setDoorClosed(this.walk.model, doorId, blocks); },
      onChange: () => { if (this.aimed) this.onAimChange?.(this.hintFor(this.aimed)); this.requestRender(); },
    });
    this.buildLighting();
    this.scene.add(this.spaceGroup, this.fixturesGroup, this.modelGroup, this.objectsGroup, this.overlayGroup, this.handleGroup);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mount);
    this.requestRender();
  }

  // ── Frame loop, on demand ───────────────────────────────────────────

  requestRender = () => {
    if (this.frameQueued || this.disposed) return;
    this.frameQueued = true;
    requestAnimationFrame(this.frame);
  };

  private frame = (now: number) => {
    this.frameQueued = false;
    if (this.disposed) return;
    let moving = false;
    if (this.transition) {
      const t = Math.min(1, (now - this.transition.start) / this.transition.duration);
      const k = ease(t);
      this.camera.position.lerpVectors(this.transition.from.pos, this.transition.to.pos, k);
      this.controls.target.lerpVectors(this.transition.from.target, this.transition.to.target, k);
      if (t >= 1) this.transition = null;
      moving = true;
    }
    this.living.setFocus(this.walk ? this.camera.position : this.controls.target);
    if (this.living.step(now)) { moving = true; this.refreshAimBox(); }
    if (this.stepEnvironment(now)) moving = true;
    if (this.walk) {
      if (this.stepWalk(now)) moving = true;
    } else if (this.controls.update()) {
      // update() returns true while damping is still moving the camera.
      moving = true;
    }
    this.updateCutaway();
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.listeners) fn();
    if (moving) this.requestRender();
  };

  /**
   * THE CUTAWAY. A wall standing between the camera and what it looks at is
   * hidden (its thin edge lines stay), the way an architectural model is cut
   * open — otherwise the nearest wall would hide the very room being
   * designed. Off in walkthrough, where walls are walls.
   */
  setCutaway(enabled: boolean) {
    this.cutawayEnabled = enabled;
    this.cutawayKey = '';
    this.requestRender();
  }

  private updateCutaway() {
    if (!this.wallParts.size) return;
    const cam = { x: this.camera.position.x, y: -this.camera.position.z };
    const tgt = { x: this.controls.target.x, y: -this.controls.target.z };
    const key = `${this.cutawayEnabled}|${this.focusRadius}|${cam.x.toFixed(2)},${cam.y.toFixed(2)}|${tgt.x.toFixed(2)},${tgt.y.toFixed(2)}`;
    if (key === this.cutawayKey) return;
    this.cutawayKey = key;
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const intersects = (p1: { x: number; y: number }, p2: { x: number; y: number }, q1: { x: number; y: number }, q2: { x: number; y: number }) =>
      cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0;
    const distanceToSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x; const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    };
    for (const part of this.wallParts.values()) {
      // In front = the camera and the look-at point are on opposite sides of
      // the wall's line, and the wall is either on the sight line or within
      // the focused area (a room's own walls, when a room is focused).
      const opposite = cross(part.start, part.end, cam) * cross(part.start, part.end, tgt) < 0;
      const hide = this.cutawayEnabled && opposite
        && (intersects(cam, tgt, part.start, part.end) || distanceToSegment(tgt, part.start, part.end) < this.focusRadius);
      for (const m of part.meshes) m.visible = !hide;
    }
  }

  /** Called after every drawn frame (overlay labels follow the camera). */
  onFrame(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private resize() {
    const width = this.mount.clientWidth || 1;
    const height = this.mount.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  // ── Lighting ────────────────────────────────────────────────────────

  private hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.6);
  private sun = new THREE.DirectionalLight(0xffffff, 1.7);
  private interior = new THREE.AmbientLight(0xfff1dc, 0.0);

  private buildLighting() {
    this.sun.position.set(8, 14, 6);
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.interior);
    // A neutral studio room as image-based light: wood, fabric and glass get
    // real reflections and soft fill instead of flat plastic shading.
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.scene.environment = this.envTexture;
      this.scene.environmentIntensity = 0.4;
    } catch { /* no environment on a context that cannot build one */ }
    const aniso = this.quality.tier === 'HIGH' ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : this.quality.tier === 'BALANCED' ? 4 : 1;
    this.finishSize = Math.min(this.quality.maxTextureSize, this.quality.tier === 'LOW' ? 256 : 512);
    this.finishAniso = aniso;
    setFinishBudget(this.finishSize, aniso);
  }

  private envTexture: THREE.Texture | null = null;
  private finishSize = 512;
  private finishAniso = 1;

  /**
   * The design's own lighting (time of day, interior light colour). In the
   * walkthrough a visitor's time of day overrides it until they leave.
   */
  setLighting(l: { timeOfDay: TimeOfDayEnv; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interiorIntensity: number }) {
    this.designLighting = { timeOfDay: l.timeOfDay, temperature: l.temperature, interiorIntensity: l.interiorIntensity };
    if (!this.envTween) this.applyRig(lightRig({ ...l, timeOfDay: this.envOverride ?? l.timeOfDay }));
    this.requestRender();
  }

  // ── Building the space ──────────────────────────────────────────────

  private track<T extends { dispose: () => void }>(x: T): T {
    this.disposables.add(x);
    return x;
  }

  private clearGroup(group: THREE.Group) {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    group.clear();
  }

  loadSpace(space: SpaceModel) {
    this.clearGroup(this.spaceGroup);
    this.surfaceMeshes.clear();
    this.surfaceMaterials.clear();
    this.ceilingMeshes = [];
    this.wallBodies = [];
    this.wallParts.clear();
    this.cutawayKey = '';
    this.space = space;

    const extent = Math.max(space.extent.width, space.extent.depth);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(extent * 4 + 20, extent * 4 + 20),
      new THREE.MeshStandardMaterial({ color: TONE.ground, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(space.extent.width / 2, -0.03, -space.extent.depth / 2);
    ground.receiveShadow = this.quality.shadows;
    this.spaceGroup.add(ground);

    const surfaceMaterial = (id: string, color: number) => {
      let m = this.surfaceMaterials.get(id);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
        m.userData.baseColor = color;
        this.surfaceMaterials.set(id, m);
      }
      return m;
    };
    const register = (id: string, mesh: THREE.Mesh) => {
      const list = this.surfaceMeshes.get(id) ?? [];
      list.push(mesh);
      this.surfaceMeshes.set(id, list);
    };

    // Floors and ceilings, one polygon per room.
    for (const room of space.rooms) {
      const shape = new THREE.Shape();
      room.polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
      shape.closePath();
      const geometry = new THREE.ShapeGeometry(shape);

      const floorId = floorSurfaceId(room.id);
      const floor = new THREE.Mesh(geometry, surfaceMaterial(floorId, room.outdoor ? TONE.outdoor : TONE.floor));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.002;
      floor.receiveShadow = this.quality.shadows;
      floor.userData = { pick: { kind: 'surface', id: floorId, roomId: room.id } } satisfies PickData;
      this.spaceGroup.add(floor);
      register(floorId, floor);

      if (!room.outdoor) {
        const ceilingId = ceilingSurfaceId(room.id);
        const ceilingMat = surfaceMaterial(ceilingId, TONE.ceiling);
        // The floor's polygon, lifted to the ceiling and seen from below.
        ceilingMat.side = THREE.BackSide;
        const ceiling = new THREE.Mesh(geometry, ceilingMat);
        ceiling.rotation.x = -Math.PI / 2;
        ceiling.position.y = space.ceilingHeightM;
        ceiling.visible = false; // cutaway in overview; shown from inside
        ceiling.userData = { pick: { kind: 'surface', id: ceilingId, roomId: room.id } } satisfies PickData;
        this.spaceGroup.add(ceiling);
        this.ceilingMeshes.push(ceiling);
        register(ceilingId, ceiling);
      }
    }

    // Walls: a structural body cut around its openings, and a thin design
    // face on each side per room segment, which is what paint and materials
    // are applied to. The body is structure; it is not a design surface.
    const bodyMat = new THREE.MeshStandardMaterial({ color: TONE.wallBody, roughness: 0.95 });
    const topMat = new THREE.MeshStandardMaterial({ color: TONE.wallTop, roughness: 1 });
    const edgeMat = new THREE.LineBasicMaterial({ color: TONE.wallEdge, transparent: true, opacity: 0.55 });
    const skirting: THREE.BufferGeometry[] = [];
    for (const wall of space.walls) {
      const parts: THREE.Object3D[] = [];
      this.wallParts.set(wall.id, { start: wall.mesh.start, end: wall.mesh.end, meshes: parts });
      const slabs = sliceWall(wall.mesh);
      for (const slab of slabs) {
        if (slab.lengthM <= 0 || slab.heightM <= 0) continue;
        const box = new THREE.BoxGeometry(slab.lengthM, slab.heightM, wall.mesh.thicknessM);
        // +y face (index 2) is the wall top, seen from the overview camera.
        const mesh = new THREE.Mesh(box, [bodyMat, bodyMat, topMat, bodyMat, bodyMat, bodyMat]);
        const place = wallSlabPlacement(wall.mesh, slab.u, slab.v, slab.lengthM, slab.heightM);
        mesh.position.set(place.position.x, place.position.y, place.position.z);
        mesh.rotation.y = place.rotationY;
        mesh.castShadow = this.quality.shadows;
        mesh.receiveShadow = this.quality.shadows;
        this.spaceGroup.add(mesh);
        this.wallBodies.push(mesh);
        parts.push(mesh);
        // Crisp architectural edges: the drawn line that makes a model read as a plan.
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box, 30), edgeMat);
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        this.spaceGroup.add(edges);
      }

      for (const seg of wall.segments) {
        const pieces = clipSlabs(slabs, seg.from, seg.to);
        const offset = (wall.mesh.thicknessM / 2 + 0.003) * (seg.side === 'R' ? 1 : -1);
        const indoor = !space.rooms.find((r) => r.id === seg.roomId)?.outdoor;
        for (const piece of pieces) {
          // A skirting board where an indoor wall face meets the floor (not across a doorway).
          if (indoor && piece.v < 0.01 && piece.lengthM > 0.08) {
            const place = wallSlabPlacement(wall.mesh, piece.u, 0, piece.lengthM, SKIRT_H);
            const out = offset + (seg.side === 'R' ? 1 : -1) * (SKIRT_D / 2);
            const g = new RoundedBoxGeometry(piece.lengthM, SKIRT_H, SKIRT_D, 1, 0.003);
            g.rotateY(place.rotationY);
            g.translate(place.position.x + Math.sin(place.rotationY) * out, SKIRT_H / 2, place.position.z + Math.cos(place.rotationY) * out);
            skirting.push(g);
          }
          const plane = new THREE.PlaneGeometry(piece.lengthM, piece.heightM);
          const face = new THREE.Mesh(plane, surfaceMaterial(seg.surfaceId, TONE.wallFace));
          const place = wallSlabPlacement(wall.mesh, piece.u, piece.v, piece.lengthM, piece.heightM);
          face.rotation.y = place.rotationY + (seg.side === 'R' ? 0 : Math.PI);
          // Local +z of the rotated slab is the R normal: (sin a, 0, cos a).
          face.position.set(
            place.position.x + Math.sin(place.rotationY) * offset,
            place.position.y,
            place.position.z + Math.cos(place.rotationY) * offset,
          );
          face.receiveShadow = this.quality.shadows;
          face.userData = { pick: { kind: 'surface', id: seg.surfaceId, roomId: seg.roomId } } satisfies PickData;
          this.spaceGroup.add(face);
          register(seg.surfaceId, face);
          parts.push(face);
        }
      }
    }

    if (skirting.length) {
      const merged = mergeGeometries(skirting, false);
      skirting.forEach((g) => g.dispose());
      if (merged) {
        const mesh = new THREE.Mesh(this.track(merged), this.track(new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.45 })));
        mesh.receiveShadow = this.quality.shadows;
        mesh.raycast = () => {};
        mesh.userData.decor = true;
        this.spaceGroup.add(mesh);
      }
    }

    this.buildOpenings(space);

    this.sun.target.position.set(space.extent.width / 2, 0, -space.extent.depth / 2);
    this.sun.position.set(space.extent.width / 2 + 6, 14, -space.extent.depth / 2 + 8);
    const s = Math.max(space.extent.width, space.extent.depth);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 0.5; cam.far = 60;
    cam.updateProjectionMatrix();

    this.frameAll(false);
    this.requestRender();
  }

  /**
   * A model source (developer apartment, uploaded GLB). An uploaded model
   * is turned upright, scaled to metres and stood on the floor at the
   * origin (the stored transform, never an edit of the file). Identified
   * parts get their own materials so they can be dressed or hidden; every
   * other mesh stays exactly as modelled.
   */
  setModel(object: THREE.Object3D, options: { transform?: ModelTransform; parts?: ModelPartBinding[] } = {}) {
    this.clearGroup(this.modelGroup);
    this.partMeshes.clear();
    this.partMaterials.clear();
    this.partRoots.clear();
    this.ceilingMeshes = [];
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = this.quality.shadows;
        mesh.receiveShadow = this.quality.shadows;
        mesh.userData = { ...mesh.userData, pick: { kind: 'model' } } satisfies PickData & Record<string, unknown>;
      }
    });

    for (const part of options.parts ?? []) {
      const paintable = PAINTABLE_ROLES.has(part.role);
      const pick: PickTarget = paintable ? { kind: 'surface', id: part.id, roomId: null } : part.role === 'FURNITURE' ? { kind: 'part', id: part.id } : { kind: 'model' };
      const meshes: THREE.Mesh[] = [];
      const materials: PartMaterial[] = [];
      part.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        meshes.push(mesh);
        mesh.userData = { ...mesh.userData, pick } satisfies PickData & Record<string, unknown>;
        if (!paintable) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const own = list.map((m) => {
          const std = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial
            ? (m as THREE.MeshStandardMaterial).clone()
            : new THREE.MeshStandardMaterial({ color: (m as THREE.MeshBasicMaterial).color ?? 0xdddddd });
          this.track(std);
          materials.push({ material: std, original: { color: std.color.clone(), map: std.map, roughness: std.roughness, metalness: std.metalness } });
          return std;
        });
        mesh.material = Array.isArray(mesh.material) ? own : own[0];
      });
      this.partMeshes.set(part.id, meshes);
      if (materials.length) this.partMaterials.set(part.id, materials);
      // Only furniture can be hidden by the customer; a ceiling is lifted
      // off for the view from outside, exactly as a floor-plan space's is.
      if (part.role === 'FURNITURE') this.partRoots.set(part.id, part.object);
      if (part.role === 'CEILING') this.ceilingMeshes.push(...meshes);
    }

    let root: THREE.Object3D = object;
    const tf = options.transform;
    if (tf) {
      const upright = new THREE.Group();
      upright.add(object);
      if (tf.upAxis === 'Z') object.rotation.x = -Math.PI / 2;
      upright.scale.setScalar(tf.scale > 0 && Number.isFinite(tf.scale) ? tf.scale : 1);
      upright.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(upright);
      if (!box.isEmpty()) {
        const centre = box.getCenter(new THREE.Vector3());
        upright.position.set(-centre.x, -box.min.y, -centre.z);
      }
      root = upright;
    }
    this.modelGroup.add(root);
    this.setCeilings(false);
    this.frameObject(this.modelGroup, false);
    this.requestRender();
  }

  /** The identified parts that exist in the loaded model. */
  partIds(): string[] {
    return [...this.partMeshes.keys()];
  }

  // ── Surfaces ────────────────────────────────────────────────────────

  /** Paint one surface. `null` restores the neutral base. */
  setSurfaceColor(surfaceId: string, color: string | null, params: { roughness?: number; metalness?: number } = {}) {
    const m = this.surfaceMaterials.get(surfaceId);
    if (!m) return;
    m.color.set(color ?? (m.userData.baseColor as number));
    if (params.roughness != null) m.roughness = params.roughness;
    if (params.metalness != null) m.metalness = params.metalness;
    m.needsUpdate = true;
    this.requestRender();
  }

  hasSurface(surfaceId: string): boolean {
    return this.surfaceMeshes.has(surfaceId);
  }

  // ── Picking ─────────────────────────────────────────────────────────

  pick(clientX: number, clientY: number): { target: PickTarget; point: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.handleGroup, this.spaceGroup, this.modelGroup, this.objectsGroup], true);
    for (const hit of hits) {
      // Hidden things (cut-away walls, ceilings seen from above) are not there to be clicked.
      if (!hit.object.visible) continue;
      let o: THREE.Object3D | null = hit.object;
      let target: PickTarget | null = null;
      while (o) {
        if (!o.visible) break;
        const data = o.userData as Partial<PickData>;
        if (data.pick) { target = data.pick; break; }
        o = o.parent;
      }
      if (target && target.kind !== 'surface') return { target, point: hit.point.clone() };
      // A floor, wall or ceiling was reached first. A piece is a solid thing to the eye even
      // where it is built of separate boxes: if the ray passed through a piece's outline on
      // its way, that piece is what was clicked (a sofa's seat-to-back gap is still the sofa).
      if (target) return this.pieceAlong(hit.distance) ?? { target, point: hit.point.clone() };
      // A wall body (structure) stops the ray: whatever is behind it is hidden.
      if (this.wallBodies.includes(hit.object as THREE.Mesh)) return this.pieceAlong(hit.distance);
    }
    return this.pieceAlong(Infinity);
  }

  /** Each piece's world outline, for picking; rebuilt only after pieces move. */
  private pickBoxes: Map<string, THREE.Box3> | null = null;

  private pieceAlong(limit: number): { target: PickTarget; point: THREE.Vector3 } | null {
    if (!this.pickBoxes) {
      this.pickBoxes = new Map();
      for (const [id, node] of this.objectsById) {
        if (!node.visible) continue;
        node.updateMatrixWorld(true);
        const box = solidBox(node);
        if (!box.isEmpty()) this.pickBoxes.set(id, box);
      }
    }
    const ray = this.raycaster.ray;
    const at = new THREE.Vector3();
    let best: { id: string; d: number; point: THREE.Vector3 } | null = null;
    for (const [id, box] of this.pickBoxes) {
      if (!ray.intersectBox(box, at)) continue;
      const d = at.distanceTo(ray.origin);
      if (d < limit && (!best || d < best.d)) best = { id, d, point: at.clone() };
    }
    if (!best) return null;
    const pick = (this.objectsById.get(best.id)?.userData as Partial<PickData> | undefined)?.pick;
    return pick ? { target: pick, point: best.point } : null;
  }

  /** Project a plan point to screen pixels, or null when it is behind the camera. */
  project(p: { x: number; y: number }, height = 0): { x: number; y: number } | null {
    const v = new THREE.Vector3(p.x, height, -p.y).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  /** Where a screen point meets the floor plane, in plan metres. */
  floorPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    return ok ? { x: hit.x, y: -hit.z } : null;
  }

  // ── Selection and hover ─────────────────────────────────────────────

  private tinted = new Map<THREE.MeshStandardMaterial, { color: number; intensity: number }>();

  /** Warm the selected surfaces themselves, so the selection reads through the material. */
  private tint(target: PickTarget | null, strength: number) {
    for (const [m, prev] of this.tinted) {
      m.emissive.setHex(prev.color);
      m.emissiveIntensity = prev.intensity;
    }
    this.tinted.clear();
    if (!target) return;
    const ids = target.kind === 'surface' ? [target.id] : target.kind === 'room' ? [floorSurfaceId(target.id)] : [];
    for (const id of ids) {
      const list = this.surfaceMaterials.has(id) ? [this.surfaceMaterials.get(id)!] : (this.partMaterials.get(id) ?? []).map((p) => p.material);
      for (const m of list) {
        this.tinted.set(m, { color: m.emissive.getHex(), intensity: m.emissiveIntensity });
        m.emissive.setHex(TONE.select);
        m.emissiveIntensity = strength;
      }
    }
  }

  private outlineFor(target: PickTarget | null, color: number): THREE.Object3D | null {
    if (!target) return null;
    // Surfaces are outlined where they are visible (depth-tested); objects
    // keep their box on top so a selected sofa behind a wall can be found.
    const onTop = target.kind === 'object' || target.kind === 'model' || target.kind === 'part';
    const material = new THREE.LineBasicMaterial({ color, depthTest: !onTop, transparent: true, opacity: 0.95 });
    const group = new THREE.Group();
    group.renderOrder = 10;
    const addEdges = (mesh: THREE.Mesh) => {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), material);
      mesh.updateWorldMatrix(true, false);
      edges.applyMatrix4(mesh.matrixWorld);
      edges.renderOrder = 10;
      group.add(edges);
    };
    if (target.kind === 'surface' || target.kind === 'part') {
      for (const mesh of this.surfaceMeshes.get(target.id) ?? this.partMeshes.get(target.id) ?? []) addEdges(mesh);
    } else if (target.kind === 'room') {
      for (const mesh of this.surfaceMeshes.get(floorSurfaceId(target.id)) ?? []) addEdges(mesh);
    } else if (target.kind === 'object') {
      const obj = this.objectsById.get(target.id);
      if (obj) {
        const box = solidBox(obj);
        const helper = new THREE.Box3Helper(box, new THREE.Color(color));
        (helper.material as THREE.LineBasicMaterial).depthTest = false;
        helper.renderOrder = 10;
        group.add(helper);
      }
    } else if (target.kind === 'model') {
      const box = new THREE.Box3().setFromObject(this.modelGroup);
      if (!box.isEmpty()) group.add(new THREE.Box3Helper(box, new THREE.Color(color)));
    }
    return group.children.length ? group : null;
  }

  private dropOutline(o: THREE.Object3D | null) {
    if (!o) return;
    o.traverse((c) => {
      const line = c as THREE.LineSegments;
      line.geometry?.dispose();
      (line.material as THREE.Material | undefined)?.dispose();
    });
    this.overlayGroup.remove(o);
  }

  setSelection(target: PickTarget | null) {
    this.tint(target, 0.22);
    this.dropOutline(this.selectionOutline);
    this.selectionOutline = this.outlineFor(target, TONE.select);
    if (this.selectionOutline) this.overlayGroup.add(this.selectionOutline);
    this.requestRender();
  }

  setHover(target: PickTarget | null) {
    this.dropOutline(this.hoverOutline);
    this.hoverOutline = this.outlineFor(target, TONE.hover);
    if (this.hoverOutline) this.overlayGroup.add(this.hoverOutline);
    this.requestRender();
  }

  // ── The design layer ────────────────────────────────────────────────

  readonly objectsGroup = new THREE.Group();
  readonly objectsById = new Map<string, THREE.Object3D>();
  private objectSignature = new Map<string, string>();

  /**
   * Draw a design state: surface colours and materials, placed objects and
   * lighting. Objects are diffed by instance, so a move updates a transform
   * and only a changed asset/colour rebuilds geometry.
   */
  applyDesign(state: DesignState, assets: Map<string, CatalogAsset>, materials: Map<string, CatalogMaterial>) {
    // Model parts: a colour or material replaces the modelled finish (and
    // its texture) for the preview; removing it brings the original back.
    for (const [id, list] of this.partMaterials) {
      const a = state.surfaces[id];
      const mat = a?.materialId ? materials.get(a.materialId) : undefined;
      const color = a?.color ?? mat?.pbr.baseColor ?? null;
      const finishRoughness = a?.finish === 'GLOSS' ? 0.25 : a?.finish === 'SATIN' ? 0.55 : a?.finish === 'MATTE' ? 0.95 : undefined;
      for (const { material: m, original } of list) {
        if (color) {
          m.color.set(color);
          m.map = null;
          m.roughness = finishRoughness ?? mat?.pbr.roughness ?? 0.9;
          m.metalness = mat?.pbr.metalness ?? 0;
        } else {
          m.color.copy(original.color);
          m.map = original.map;
          m.roughness = original.roughness;
          m.metalness = original.metalness;
        }
        m.needsUpdate = true;
      }
    }
    const hidden = new Set(state.hiddenParts ?? []);
    for (const [id, node] of this.partRoots) node.visible = !hidden.has(id);

    for (const [id, m] of this.surfaceMaterials) {
      const a = state.surfaces[id];
      const mat = a?.materialId ? materials.get(a.materialId) : undefined;
      const color = a?.color ?? mat?.pbr.baseColor ?? null;
      const finishRoughness = a?.finish === 'GLOSS' ? 0.25 : a?.finish === 'SATIN' ? 0.55 : a?.finish === 'MATTE' ? 0.95 : undefined;
      m.color.set(color ?? (m.userData.baseColor as number));
      m.roughness = finishRoughness ?? mat?.pbr.roughness ?? 0.9;
      m.metalness = mat?.pbr.metalness ?? 0;
      // A floor wears its pattern: the chosen material's own kind, else what
      // the reading saw (herringbone, tile…). No pattern is ever invented.
      if (id.startsWith('floor:')) {
        const own = mat ? patternOfMaterial(mat, 'FLOOR') : null;
        const seen = (a?.pattern ?? null) as SurfacePattern | null;
        // What the reading saw wins while the material is of the same family
        // (herringbone oak stays herringbone); a different material brings its own.
        const family = (x: SurfacePattern) => (x.startsWith('WOOD') ? 'WOOD' : x);
        const pattern: SurfacePattern | null = seen && (!own || family(own) === family(seen)) ? seen : own ?? seen;
        applyFinish(m, pattern, this.finishSize, true, this.finishAniso);
        if (pattern) m.roughness = finishRoughness ?? mat?.pbr.roughness ?? m.roughness;
      }
      m.needsUpdate = true;
    }

    const live = new Set<string>();
    for (const obj of state.objects) {
      live.add(obj.instanceId);
      const asset = assets.get(obj.assetId);
      const sig = `${obj.assetId}|${obj.materialVariant ?? ''}|${obj.colorOverride ?? ''}`;
      let node = this.objectsById.get(obj.instanceId);
      if (!node || this.objectSignature.get(obj.instanceId) !== sig) {
        if (node) this.disposeObject(obj.instanceId);
        node = this.buildObject(obj, asset);
        this.objectsById.set(obj.instanceId, node);
        this.objectSignature.set(obj.instanceId, sig);
        this.objectsGroup.add(node);
      }
      this.placeNode(node, obj.position.x, obj.position.z, obj.rotationY, obj.position.y);
      this.restoreEmissive(node);
      node.userData = { pick: { kind: 'object', id: obj.instanceId, roomId: obj.roomId } } satisfies PickData;
    }
    for (const id of [...this.objectsById.keys()]) if (!live.has(id)) this.disposeObject(id);
    if (this.handleFor) this.updateHandle();

    this.setLighting(state.lighting);
    this.requestRender();
  }

  private buildObject(obj: ObjectInstance, asset: CatalogAsset | undefined): THREE.Object3D {
    if (asset?.procedural) {
      const node = buildProcedural(asset.procedural.kind, asset, slotColors(asset, obj.materialVariant, obj.colorOverride));
      if (asset.placement === 'FLOOR') node.add(contactShadow(asset.widthM, asset.depthM));
      // A concept block's moving parts come with it; a model declares them.
      const specs = validateInteractions(node.userData.interactions ?? asset.interactions);
      this.living.register(`obj:${obj.instanceId}`, node, specs, asset.capabilities, { objectId: obj.instanceId });
      return node;
    }
    // A real model loads asynchronously (catalogue models arrive with the
    // licensed library); until then — or when an asset is missing — a
    // labelled neutral block holds its footprint so the design never breaks.
    const w = asset?.widthM ?? 0.6;
    const d = asset?.depthM ?? 0.6;
    const h = asset?.heightM ?? 0.6;
    const g = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.9, transparent: true, opacity: 0.75 }),
    );
    m.position.y = h / 2;
    g.add(m);
    return g;
  }

  private placeNode(node: THREE.Object3D, planX: number, planY: number, rotation: number, elevation = 0) {
    this.pickBoxes = null;
    node.position.set(planX, elevation, -planY);
    node.rotation.set(0, rotation, 0);
  }

  private disposeObject(id: string) {
    const node = this.objectsById.get(id);
    if (!node) return;
    this.pickBoxes = null;
    this.living.clear(id);
    if (this.aimed?.objectId === id) this.setAim(null);
    if (this.walk?.seated?.objectId === id) this.standUp();
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!o.userData.decor) mesh.geometry?.dispose(); // the contact shadow's plane is shared
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    this.objectsGroup.remove(node);
    this.objectsById.delete(id);
    this.objectSignature.delete(id);
  }

  private restoreEmissive(node: THREE.Object3D) {
    node.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.userData?.baseEmissive === undefined) return;
      m.emissive.setHex(m.userData.baseEmissive as number);
      m.emissiveIntensity = (m.userData.baseEmissiveIntensity as number | undefined) ?? 1;
    });
  }

  /** Move an object's drawing without touching the design (live drag feedback). */
  previewObject(instanceId: string, at: { x: number; y: number }, rotation: number, valid: boolean) {
    const node = this.objectsById.get(instanceId);
    if (!node) return;
    this.placeNode(node, at.x, at.y, rotation);
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!m || !('emissive' in m)) return;
      if (m.userData.baseEmissive === undefined) {
        m.userData.baseEmissive = m.emissive.getHex();
        m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      }
      m.emissive.setHex(valid ? (m.userData.baseEmissive as number) : 0xb3261e);
      m.emissiveIntensity = valid ? (m.userData.baseEmissiveIntensity as number) : 0.35;
    });
    if (this.handleFor === instanceId) this.updateHandle();
    this.setSelection({ kind: 'object', id: instanceId, roomId: null });
  }

  /** Stop the camera from orbiting while an object is being dragged. */
  setOrbitEnabled(enabled: boolean) {
    this.controls.enabled = enabled;
  }

  /** A downscaled WebP still of the current view, for version thumbnails. */
  captureThumbnail(maxWidth = 480): Promise<Blob | null> {
    try {
      this.renderer.render(this.scene, this.camera);
      const src = this.renderer.domElement;
      const scale = Math.min(1, maxWidth / src.width);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(src.width * scale));
      out.height = Math.max(1, Math.round(src.height * scale));
      out.getContext('2d')?.drawImage(src, 0, 0, out.width, out.height);
      return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/webp', 0.82));
    } catch {
      return Promise.resolve(null);
    }
  }

  // ── Camera ──────────────────────────────────────────────────────────

  // ── The picture's own view ──────────────────────────────────────────
  //
  // "Match reference view" puts the camera where the customer's picture was
  // taken from (sourceCamera.ts). An orthographic picture is matched by a far
  // camera with a narrow lens, which needs a tight near/far range to keep
  // depth precision; every other camera move, and the customer starting to
  // orbit, puts the ordinary range back.

  private matchedFrustum = false;

  private normalFrustum() {
    if (!this.matchedFrustum) return;
    this.matchedFrustum = false;
    this.camera.near = 0.05;
    this.camera.far = 500;
    this.camera.updateProjectionMatrix();
  }

  matchSourceView(view: { position: [number, number, number]; target: [number, number, number]; fov: number; near: number; far: number }) {
    const position = new THREE.Vector3(...view.position);
    const target = new THREE.Vector3(...view.target);
    // Lift the orbit limit FIRST: moving the camera updates the controls, which clamp to it.
    this.controls.maxDistance = Math.max(this.controls.maxDistance, position.distanceTo(target) + 20);
    this.moveCamera(position, target, false);
    this.camera.fov = view.fov;
    this.camera.near = view.near;
    this.camera.far = view.far;
    this.camera.updateProjectionMatrix();
    this.matchedFrustum = true;
    this.requestRender();
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    this.normalFrustum();
    if (!animate || this.reducedMotion) {
      this.transition = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.transition = {
      from: { pos: this.camera.position.clone(), target: this.controls.target.clone() },
      to: { pos, target },
      start: performance.now(),
      duration: 520,
    };
    this.requestRender();
  }

  private distanceFor(radius: number) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.5, this.camera.aspect);
    const fit = radius / Math.sin(fov / 2);
    return aspect < 1 ? fit / aspect : fit;
  }

  private setCeilings(visible: boolean) {
    this.ceilingsShown = visible;
    for (const c of this.ceilingMeshes) c.visible = visible;
    this.fixturesGroup.visible = visible;
  }

  frameAll(animate = true) {
    if (!this.space) {
      this.frameObject(this.modelGroup, animate);
      return;
    }
    const { width, depth } = this.space.extent;
    const target = new THREE.Vector3(width / 2, 0.6, -depth / 2);
    const radius = Math.hypot(width, depth) / 2;
    const d = this.distanceFor(radius) * 0.95;
    const pos = new THREE.Vector3(target.x + d * 0.45, d * 0.78, target.z + d * 0.55);
    this.view = 'OVERVIEW';
    this.focusRadius = 0;
    this.setCeilings(false);
    this.moveCamera(pos, target, animate);
  }

  topView(animate = true) {
    const w = this.space?.extent.width ?? 10;
    const dpt = this.space?.extent.depth ?? 10;
    const target = new THREE.Vector3(w / 2, 0, -dpt / 2);
    const d = this.distanceFor(Math.max(w, dpt) / 2) * 1.05;
    // Straight down would lock OrbitControls' azimuth; a hair of tilt keeps it usable.
    const pos = new THREE.Vector3(target.x, d, target.z + 0.001);
    this.view = 'TOP';
    this.focusRadius = 0;
    this.setCeilings(false);
    this.moveCamera(pos, target, animate);
  }

  focusRoom(room: SpaceRoom, animate = true) {
    const b = room.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const target = new THREE.Vector3(cx, 0.9, -cy);
    const radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 0.4;
    const d = this.distanceFor(radius) * 0.9;
    const pos = new THREE.Vector3(cx + d * 0.42, Math.max(3.6, d * 0.72), -cy + d * 0.55);
    this.view = 'ROOM';
    this.focusRadius = radius;
    this.setCeilings(false);
    this.moveCamera(pos, target, animate);
  }

  private frameObject(object: THREE.Object3D, animate: boolean) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const d = this.distanceFor(Math.max(size.x, size.y, size.z) * 0.6 || 5);
    this.moveCamera(new THREE.Vector3(centre.x + d * 0.5, centre.y + d * 0.6, centre.z + d * 0.6), centre, animate);
  }

  getView(): ViewMode {
    return this.view;
  }

  snapshot(): CameraSnapshot {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      fov: this.camera.fov,
    };
  }

  restore(s: CameraSnapshot, animate = true) {
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.moveCamera(new THREE.Vector3(...s.position), new THREE.Vector3(...s.target), animate);
  }

  // ── The rotate handle ───────────────────────────────────────────────
  //
  // A gold ring on the floor around the selected piece, with a grip. Dragging
  // it turns the piece (the canvas previews, the design commits one
  // ROTATE_OBJECT on release). It follows the piece and hides while walking.

  private handleGroup = new THREE.Group();
  private handleFor: string | null = null;

  showRotateHandle(instanceId: string | null) {
    this.handleFor = instanceId;
    this.updateHandle();
  }

  private updateHandle() {
    for (const c of [...this.handleGroup.children]) {
      this.handleGroup.remove(c);
      c.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    }
    const node = this.handleFor ? this.objectsById.get(this.handleFor) : null;
    if (!node || this.walk) { this.requestRender(); return; }
    const box = new THREE.Box3().setFromObject(node);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) / 2 + 0.3;
    const pick = { pick: { kind: 'handle', id: this.handleFor! } } satisfies PickData;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.022, 8, 72),
      new THREE.MeshBasicMaterial({ color: TONE.select, transparent: true, opacity: 0.9, depthTest: false }),
    );
    // A wider, invisible band makes the ring easy to grab with a finger.
    const grip = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.14, 6, 48),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 12),
      new THREE.MeshBasicMaterial({ color: TONE.select, depthTest: false }),
    );
    for (const m of [ring, grip]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 20; m.userData = pick; }
    knob.userData = pick;
    knob.renderOrder = 21;
    // The grip sits in front of the piece (its local -z in the world).
    const front = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), node.rotation.y);
    knob.position.set(front.x * r, 0, front.z * r);
    const g = new THREE.Group();
    g.position.set(node.position.x, node.position.y + 0.03, node.position.z);
    g.add(ring, grip, knob);
    this.handleGroup.add(g);
    this.requestRender();
  }

  // ── The living engine (walkthrough only; never part of the design) ───
  //
  // Floor-plan doors, windows, balcony doors and room lights are registered
  // here; catalogue pieces register what they declare as they are built.
  // The LivingRuntime performs every one of them the same way.

  private living: LivingRuntime;
  private fixturesGroup = new THREE.Group();

  /** Doors, windows and balcony doors of a floor-plan space, and a ceiling light in every indoor room. */
  private buildOpenings(space: SpaceModel) {
    this.living.clear(null);
    this.clearGroup(this.fixturesGroup);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xece7df, roughness: 0.7 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe0ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28 });
    this.track(leafMat); this.track(frameMat); this.track(glassMat);
    const outdoor = new Set(space.rooms.filter((r) => r.outdoor).map((r) => r.id));
    for (const wall of space.walls) {
      const f = wallFrame(wall.mesh);
      for (const o of wall.mesh.openings) {
        const jamb = { x: wall.mesh.start.x + f.dir.x * (o.offsetM - o.widthM / 2), y: wall.mesh.start.y + f.dir.y * (o.offsetM - o.widthM / 2) };
        const at = (seg: { from: number; to: number }) => o.offsetM >= seg.from - 0.05 && o.offsetM <= seg.to + 0.05;
        // Swing toward a room (the left face when it looks into one).
        const intoLeft = wall.segments.some((seg) => seg.side === 'L' && at(seg) && !outdoor.has(seg.roomId));
        const sign = intoLeft ? 1 : -1;
        // A door between a room and a balcony or terrace slides, glazed.
        const balcony = o.kind === 'DOOR' && wall.segments.some((seg) => at(seg) && outdoor.has(seg.roomId));
        const pivot = new THREE.Group();
        pivot.name = `ix:${o.id}`;
        pivot.position.set(jamb.x, o.sillM, -jamb.y);
        pivot.rotation.y = f.angle;
        const w = o.widthM;
        const h = o.heightM;
        const glazed = (panelW: number, x0: number) => {
          const t = 0.05;
          for (const [bw, bh, x, y] of [[panelW, t, x0 + panelW / 2, t / 2], [panelW, t, x0 + panelW / 2, h - t / 2], [t, h, x0 + t / 2, h / 2], [t, h, x0 + panelW - t / 2, h / 2]]) {
            const bar = new THREE.Mesh(this.track(new THREE.BoxGeometry(bw, bh, 0.05)), frameMat);
            bar.position.set(x, y, 0);
            pivot.add(bar);
          }
          const glass = new THREE.Mesh(this.track(new THREE.PlaneGeometry(panelW - 2 * t, h - 2 * t)), glassMat);
          glass.position.set(x0 + panelW / 2, h / 2, 0);
          pivot.add(glass);
        };
        let spec: InteractionSpec;
        if (balcony) {
          glazed(w * 0.52, w * 0.02);
          // Slides along the wall, behind the fixed half.
          spec = { id: o.id, kind: 'SLIDING', role: 'BALCONY_DOOR', axis: 'x', open: w * 0.46, durationMs: 1100 };
        } else if (o.kind === 'DOOR') {
          const leaf = new THREE.Mesh(this.track(new THREE.BoxGeometry(w - 0.02, h - 0.02, 0.04)), leafMat);
          leaf.position.set(w / 2, h / 2, 0);
          leaf.castShadow = this.quality.shadows;
          pivot.add(leaf);
          const handle = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.12, 0.02, 0.08)), frameMat);
          handle.position.set(w - 0.1, 1.0, 0);
          pivot.add(handle);
          spec = { id: o.id, kind: 'HINGED', role: 'DOOR', axis: 'y', open: 1.5 * sign, durationMs: 900, initiallyOpen: true };
        } else {
          glazed(w, 0);
          spec = { id: o.id, kind: 'HINGED', role: 'WINDOW', axis: 'y', open: 1.1 * sign, durationMs: 800 };
        }
        this.spaceGroup.add(pivot);
        const prefix = o.kind === 'DOOR' ? 'door' : 'window';
        this.living.register(prefix, pivot, [spec], null, { objectId: null, doorId: () => (o.kind === 'DOOR' ? o.id : null) });
      }
    }
    // A balcony or terrace edge with no wall is a railing: glass, a top rail,
    // posts — so standing outside looks and feels bounded (the walk model
    // already keeps the body on the balcony's floor).
    const railMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.45, metalness: 0.4 }));
    const railGlass = this.track(new THREE.MeshStandardMaterial({ color: 0xcfe0ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22 }));
    const onWall = (a: Point, b: Point) => space.walls.some((w) => {
      const s = w.mesh.start; const e = w.mesh.end;
      const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
      const dist = (p: Point) => Math.abs((e.x - s.x) * (s.y - p.y) - (s.x - p.x) * (e.y - s.y)) / len;
      const along = (p: Point) => ((p.x - s.x) * (e.x - s.x) + (p.y - s.y) * (e.y - s.y)) / (len * len);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return dist(a) < 0.08 && dist(b) < 0.08 && along(m) > 0 && along(m) < 1;
    });
    for (const room of space.rooms) {
      if (!room.outdoor) continue;
      for (let i = 0; i < room.polygon.length; i += 1) {
        const a = room.polygon[i];
        const b = room.polygon[(i + 1) % room.polygon.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.3 || onWall(a, b)) continue;
        const rail = new THREE.Group();
        rail.position.set(a.x, 0, -a.y);
        rail.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
        const glass = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, 0.95, 0.02)), railGlass);
        glass.position.set(len / 2, 0.52, 0);
        const top = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, 0.05, 0.06)), railMat);
        top.position.set(len / 2, 1.02, 0);
        rail.add(glass, top);
        const posts = Math.max(2, Math.round(len / 1.5) + 1);
        for (let k = 0; k < posts; k += 1) {
          const post = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.04, 1.0, 0.04)), railMat);
          post.position.set((len * k) / (posts - 1), 0.5, 0);
          rail.add(post);
        }
        this.spaceGroup.add(rail);
      }
    }
    // A ceiling light in every indoor room: switchable, and on by itself after dark.
    const fixtureMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.6 }));
    for (const room of space.rooms) {
      if (room.outdoor) continue;
      const node = new THREE.Group();
      node.name = 'ix:fixture';
      node.position.set(room.centroid.x, space.ceilingHeightM - 0.035, -room.centroid.y);
      const disc = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.16, 0.19, 0.05, 28)), fixtureMat);
      node.add(disc);
      this.fixturesGroup.add(node);
      const reach = Math.max(3, Math.hypot(room.bounds.maxX - room.bounds.minX, room.bounds.maxY - room.bounds.minY));
      this.living.register(`light:${room.id}`, node, [{
        id: 'ceiling', kind: 'SWITCH', role: 'LIGHT', durationMs: 350,
        effects: [{ id: 'light', type: 'LIGHT', part: 'fixture', color: '#ffe2bd', intensity: Math.min(9, 2.2 + room.areaM2 * 0.22), distance: reach * 1.1 }],
      }], null, { objectId: null });
    }
    this.fixturesGroup.visible = this.ceilingsShown;
  }

  /** What the pointer rests on: a machine's part, or a whole piece (for seats and one-machine pieces). */
  private aimed: { entry: LiveEntry | null; objectId: string | null; node: THREE.Object3D } | null = null;
  private aimBox: THREE.Box3Helper | null = null;
  private aimQueued = false;
  private lastPointer: { x: number; y: number } | null = null;
  private onAimChange?: (hint: AimHint | null) => void;
  private onSeatChange?: (posture: 'SIT' | 'LIE' | null) => void;

  private objectIdOf(node: THREE.Object3D): string | null {
    for (let o: THREE.Object3D | null = node; o; o = o.parent) {
      const pick = (o.userData as PickData | undefined)?.pick;
      if (pick?.kind === 'object') return pick.id;
      if (o === this.objectsGroup) return null;
    }
    return null;
  }

  private targetAt(clientX: number, clientY: number): { entry: LiveEntry | null; objectId: string | null; node: THREE.Object3D } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = REACH_M;
    const hits = this.raycaster.intersectObjects([this.spaceGroup, this.fixturesGroup, this.objectsGroup, this.modelGroup], true);
    this.raycaster.far = Infinity;
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      const entry = this.living.entryForPart(hit.object);
      const objectId = entry?.objectId ?? this.objectIdOf(hit.object);
      if (entry) return { entry, objectId, node: [...entry.parts.values()][0].node };
      if (objectId) {
        const own = this.living.entriesOf(objectId);
        const seats = this.living.seatsOf(objectId);
        if (own.length === 1 || seats) {
          return { entry: own.length === 1 ? own[0] : null, objectId, node: this.objectsById.get(objectId) ?? hit.object };
        }
        return null;
      }
      // The nearest solid thing decides: a part behind a wall is not reachable.
      const mat = (hit.object as THREE.Mesh).material as THREE.Material | undefined;
      if ((hit.object as THREE.Mesh).isMesh && mat && !mat.transparent) return null;
    }
    return null;
  }

  /** The actions on offer for a target, in the order a person would reach for them. */
  private actionsFor(t: { entry: LiveEntry | null; objectId: string | null }): ActionCode[] {
    const out: ActionCode[] = [];
    if (t.entry) out.push(...this.living.actions(t.entry));
    const seats = t.objectId ? this.living.seatsOf(t.objectId) : undefined;
    if (seats && !this.walk?.seated) {
      if (seats.seats.some((s) => s.posture === 'SIT')) out.push('SIT');
      if (seats.seats.some((s) => s.posture === 'LIE')) out.push('LIE_DOWN');
    }
    return [...new Set(out)];
  }

  private hintFor(t: { entry: LiveEntry | null; objectId: string | null } | null): AimHint | null {
    if (!t) return null;
    const actions = this.actionsFor(t);
    if (!actions.length) return null;
    const seats = t.objectId ? this.living.seatsOf(t.objectId) : undefined;
    const role: InteractionRole = t.entry?.machine.role ?? (seats?.seats.some((s) => s.posture === 'LIE') ? 'BED' : 'SEAT');
    const state = t.entry ? (t.entry.target ?? t.entry.state) : null;
    return { role, open: t.entry ? isActiveState(t.entry.machine, state!) : false, actions };
  }

  private setAim(t: { entry: LiveEntry | null; objectId: string | null; node: THREE.Object3D } | null) {
    const same = this.aimed && t && this.aimed.entry === t.entry && this.aimed.objectId === t.objectId;
    if (same || (!this.aimed && !t)) return;
    this.aimed = t && this.hintFor(t) ? t : null;
    if (this.aimBox) { this.overlayGroup.remove(this.aimBox); this.aimBox.geometry.dispose(); (this.aimBox.material as THREE.Material).dispose(); this.aimBox = null; }
    if (this.aimed) {
      this.aimBox = new THREE.Box3Helper(new THREE.Box3().setFromObject(this.aimed.node), new THREE.Color(TONE.select));
      (this.aimBox.material as THREE.LineBasicMaterial).transparent = true;
      (this.aimBox.material as THREE.LineBasicMaterial).opacity = 0.55;
      this.overlayGroup.add(this.aimBox);
    }
    this.renderer.domElement.style.cursor = this.aimed ? 'pointer' : (this.walk ? 'crosshair' : '');
    this.onAimChange?.(this.hintFor(this.aimed));
    this.requestRender();
  }

  private refreshAimBox() {
    if (this.aimBox && this.aimed) this.aimBox.box.setFromObject(this.aimed.node);
  }

  /** Aim at the screen centre (keyboard) or at the pointer, at most once a frame. */
  private queueAim() {
    if (this.aimQueued) return;
    this.aimQueued = true;
    requestAnimationFrame(() => {
      this.aimQueued = false;
      if (!this.walk) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const p = this.lastPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = this.targetAt(p.x, p.y);
      // A hovering mouse on its way to the hint's buttons crosses bare floor:
      // the aim lingers briefly so the button is still there when it arrives.
      if (!hit && this.lastPointer && this.aimed) {
        if (this.aimClear === null) this.aimClear = window.setTimeout(() => { this.aimClear = null; this.setAim(null); }, AIM_LINGER_MS);
        return;
      }
      if (this.aimClear !== null) { window.clearTimeout(this.aimClear); this.aimClear = null; }
      this.setAim(hit);
    });
  }

  private aimClear: number | null = null;

  /**
   * Do something with what the visitor is aiming at (a hint button, E, a
   * tap). Without an action, the first one on offer.
   */
  performAimed(action?: ActionCode): boolean {
    const t = this.aimed;
    if (!t || !this.walk) return false;
    const code = action ?? this.actionsFor(t)[0];
    if (!code) return false;
    let done = false;
    if ((code === 'SIT' || code === 'LIE_DOWN') && t.objectId) done = this.sitOn(t.objectId, code === 'SIT' ? 'SIT' : 'LIE');
    else if (t.entry) done = this.living.act(t.entry.key, code);
    if (done) this.onAimChange?.(this.hintFor(this.aimed));
    this.requestRender();
    return done;
  }

  /** The old name, kept for the overlay's single-button path. */
  toggleAimed(): boolean {
    return this.performAimed();
  }

  /** Take the first action a machine offers (QA and tests). Walkthrough only. */
  toggleInteractive(key: string): boolean {
    const e = this.living.get(key);
    if (!e || !this.walk) return false;
    const code = this.living.actions(e)[0];
    const ok = code ? this.living.act(key, code) : false;
    this.requestRender();
    return ok;
  }

  /** Take a named action on a machine (Live Here, QA). Walkthrough only. */
  act(key: string, action: ActionCode): boolean {
    if (!this.walk) return false;
    const ok = this.living.act(key, action);
    if (ok && this.aimed?.entry?.key === key) this.onAimChange?.(this.hintFor(this.aimed));
    this.requestRender();
    return ok;
  }

  /** Every part back to where the design has it: nothing a visitor opened survives. */
  private resetInteractives() {
    this.living.reset();
    this.setAim(null);
  }

  /** Every machine's key, role and state (Live Here, tests and diagnostics). */
  interactiveStates(): Array<{
    key: string; role: InteractionRole; state: string; open: boolean; objectId: string | null;
    actions: ActionCode[]; allActions: ActionCode[]; at: Point; outdoor: boolean;
  }> {
    return this.living.states().map((s) => {
      const e = this.living.get(s.key)!;
      const at = this.entryPoint(e);
      return {
        ...s, objectId: e.objectId, actions: this.living.actions(e),
        allActions: [...new Set(e.machine.transitions.map((t) => t.action))],
        at, outdoor: this.isOutdoor(at),
      };
    });
  }

  /** Where an entry is in plan (its first part's centre). */
  private entryPoint(e: LiveEntry): Point {
    const node = [...e.parts.values()][0]?.node;
    const c = node ? new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()) : new THREE.Vector3();
    return { x: c.x, y: -c.z };
  }

  private isOutdoor(p: Point): boolean {
    if (!this.space) return false;
    const id = roomContaining(this.space, p);
    return !!id && !!this.space.rooms.find((r) => r.id === id)?.outdoor;
  }

  /** Pieces a visitor can sit or lie on: object id and postures. */
  seatables(): Array<{ objectId: string; postures: Array<'SIT' | 'LIE'>; at: Point; outdoor: boolean }> {
    const out: Array<{ objectId: string; postures: Array<'SIT' | 'LIE'>; at: Point; outdoor: boolean }> = [];
    for (const [id, node] of this.objectsById) {
      const s = this.living.seatsOf(id);
      if (!s) continue;
      const at = { x: node.position.x, y: -node.position.z };
      out.push({ objectId: id, postures: [...new Set(s.seats.map((a) => a.posture))], at, outdoor: this.isOutdoor(at) });
    }
    return out;
  }

  // ── Walking somewhere on purpose (Live Here) ───────────────────────
  //
  // A real route over the free space (never through a wall), walked at a
  // person's pace, turning to face the way; a closed door on the way is
  // opened as the visitor reaches it. Any step or look by the visitor takes
  // over at once.

  /** Walk to stand in front of a machine's part or a piece, facing it. Resolves true on arrival. */
  approach(target: { key?: string; objectId?: string }): Promise<boolean> {
    const w = this.walk;
    if (!w) return Promise.resolve(false);
    if (w.seated) this.standUp();
    let at: Point | null = null;
    let stand: Point | null = null;
    let height = 0.8;
    if (target.objectId && this.objectsById.has(target.objectId)) {
      const pose = this.objectPose(target.objectId)!;
      at = { x: pose.x, y: pose.y };
      height = new THREE.Box3().setFromObject(this.objectsById.get(target.objectId)!).getCenter(new THREE.Vector3()).y;
      const front = { x: -Math.sin(pose.rotation), y: Math.cos(pose.rotation) };
      stand = { x: at.x + front.x * (pose.depth / 2 + 0.7), y: at.y + front.y * (pose.depth / 2 + 0.7) };
    }
    const e = target.key ? this.living.get(target.key) : undefined;
    if (e) {
      at = this.entryPoint(e);
      const node = [...e.parts.values()][0]?.node;
      if (node) height = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()).y;
      if (!stand) {
        const d = Math.hypot(w.pos.x - at.x, w.pos.y - at.y) || 1;
        stand = { x: at.x + ((w.pos.x - at.x) / d) * 0.95, y: at.y + ((w.pos.y - at.y) / d) * 0.95 };
      }
    }
    if (!at || !stand) return Promise.resolve(false);
    return this.startRoute(stand, at, height);
  }

  /** Walk (a real route) to a Camera Director pose — the guided tour. Without a route, a cut. */
  routeTo(pose: WalkPose): Promise<boolean> {
    const w = this.walk;
    if (!w) return Promise.resolve(false);
    if (w.seated) this.standUp();
    this.normalFrustum();
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    return this.startRoute(pose.position, pose.target, EYE_HEIGHT_M - 0.25).then((ok) => {
      if (!ok && this.walk && !this.walk.route) this.walkTo(pose);
      return ok;
    });
  }

  private startRoute(stand: Point, face: Point, faceHeight: number): Promise<boolean> {
    const w = this.walk;
    if (!w) return Promise.resolve(false);
    if (w.route) this.cancelRoute(false);
    const goal = nearestFree(w.model, stand, 1.5);
    const route = goal ? findPath(w.model, w.pos, goal, { throughDoors: true }) : null;
    if (!route) return Promise.resolve(false);
    const doors = new Set(doorsOnRoute(w.model, w.pos, route));
    return new Promise((resolve) => {
      w.route = { points: route, i: 0, doors, face, faceHeight, done: resolve };
      w.vel = { x: 0, y: 0 };
      w.glide = null;
      this.requestRender();
    });
  }

  /** True while the visitor is being walked somewhere (tour, Live Here). */
  get routing(): boolean {
    return !!this.walk?.route;
  }

  private cancelRoute(arrived = false) {
    const w = this.walk;
    if (!w?.route) return;
    const done = w.route.done;
    w.route = null;
    done(arrived);
  }

  /** One frame of a route: walk toward the next point; open a closed door ahead. */
  private stepRoute(dt: number): boolean {
    const w = this.walk!;
    const r = w.route!;
    for (const id of r.doors) {
      const leaf = w.model.doorways.get(id);
      if (!leaf || !w.model.closedDoors.has(id)) { r.doors.delete(id); continue; }
      if (Math.hypot(leaf.cx - w.pos.x, leaf.cy - w.pos.y) < 1.4) {
        const e = [...this.living.all()].find((x) => x.doorId === id);
        if (e) this.living.act(e.key, 'OPEN');
        r.doors.delete(id);
      }
    }
    const target = r.points[r.i];
    if (!target) {
      // Arrived: stop, and look at what we came for (its middle, not over it).
      w.vel = { x: 0, y: 0 };
      const yaw = Math.atan2(r.face.y - w.pos.y, r.face.x - w.pos.x);
      const dist = Math.max(0.3, Math.hypot(r.face.x - w.pos.x, r.face.y - w.pos.y));
      const pitch = Math.max(-0.9, Math.min(0.35, Math.atan2(r.faceHeight - w.eye, dist)));
      this.glideTo(w.pos, yaw, w.eye, pitch, 450);
      this.cancelRoute(true);
      return true;
    }
    const dx = target.x - w.pos.x;
    const dy = target.y - w.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.12) { r.i += 1; return true; }
    // Turn toward the way at a comfortable rate, then walk.
    const want = Math.atan2(dy, dx);
    const turn = Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw));
    w.yaw += Math.sign(turn) * Math.min(Math.abs(turn), 2.4 * dt);
    const speed = Math.min(1, dist / 0.5) * 1.2 * this.settings.speed;
    const wish = { x: (dx / dist) * speed, y: (dy / dist) * speed };
    const before = w.pos;
    const body = stepBody(w.model, w.pos, w.vel, Math.abs(turn) > 1.2 ? { x: 0, y: 0 } : wish, dt);
    w.pos = body.pos;
    w.vel = body.vel;
    // Held by a door still swinging: wait, the route continues when it is open.
    if (Math.hypot(w.pos.x - before.x, w.pos.y - before.y) < 1e-4 && Math.abs(turn) < 0.2 && r.doors.size === 0 && !this.living.step(performance.now())) {
      r.stuck = (r.stuck ?? 0) + dt;
      if (r.stuck > 2.5) { this.cancelRoute(false); return false; }
    } else {
      r.stuck = 0;
    }
    this.placeWalkCamera();
    this.reportRoom();
    return true;
  }

  /** Attach the page's walkthrough callbacks (the overlay mounts after the walk begins). */
  setWalkCallbacks(on: WalkCallbacks) {
    const w = this.walk;
    if (!w) return;
    w.onRoom = on.onRoom;
    this.onAimChange = on.onAim;
    this.onSeatChange = on.onSeat;
    this.onMenu = on.onMenu;
    this.onLockChange = on.onLock;
    this.onPostureChange = on.onPosture;
    on.onRoom?.(w.room);
    on.onAim?.(this.hintFor(this.aimed));
    on.onPosture?.(w.posture);
    on.onLock?.(this.pointerLocked);
  }

  /** QA harness: aim at a machine by key, or at a piece by id, as if the visitor pointed at it. */
  debugAim(key: string): boolean {
    if (!this.walk) return false;
    const e = this.living.get(key);
    if (e) { this.setAim({ entry: e, objectId: e.objectId, node: [...e.parts.values()][0].node }); return !!this.aimed; }
    const node = this.objectsById.get(key);
    if (!node) return false;
    const own = this.living.entriesOf(key);
    this.setAim({ entry: own.length === 1 ? own[0] : null, objectId: key, node });
    return !!this.aimed;
  }

  /** Where a plan point (at a height) is on screen; null when behind the camera. */
  screenOf(p: { x: number; y: number }, height = 1): { x: number; y: number } | null {
    const v = new THREE.Vector3(p.x, height, -p.y).project(this.camera);
    if (v.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Where the rotate handle's grip is on screen (QA and accessibility tooling). */
  rotateHandleScreen(): { x: number; y: number } | null {
    const knob = this.handleGroup.children[0]?.children[2];
    if (!knob) return null;
    const p = knob.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** The plan position and facing of a piece (Live Here walks the visitor to it). */
  objectPose(id: string): { x: number; y: number; rotation: number; depth: number } | null {
    const node = this.objectsById.get(id);
    if (!node) return null;
    const box = new THREE.Box3().setFromObject(node);
    const size = box.getSize(new THREE.Vector3());
    return { x: node.position.x, y: -node.position.z, rotation: node.rotation.y, depth: Math.min(size.x, size.z) };
  }

  // ── Sitting and lying down ────────────────────────────────────────

  /** Sit or lie on a piece: the view glides to its seat; any step stands up again. */
  sitOn(objectId: string, posture: 'SIT' | 'LIE'): boolean {
    const w = this.walk;
    const set = this.living.seatsOf(objectId);
    if (!w || !set) return false;
    const anchors = set.seats.filter((s) => s.posture === posture);
    if (!anchors.length) return false;
    // The nearest seat of that kind (a three-seat sofa has three).
    const seats = anchors.map((a) => this.living.worldSeat(set, a));
    seats.sort((a, b) => Math.hypot(a.x - w.pos.x, a.y - w.pos.y) - Math.hypot(b.x - w.pos.x, b.y - w.pos.y));
    const s = seats[0];
    w.seated = { objectId, posture, returnTo: w.seated?.returnTo ?? { ...w.pos } };
    w.vel = { x: 0, y: 0 };
    this.setPosture(postureTransition(w.posture, posture));
    this.glideTo({ x: s.x, y: s.y }, s.yaw, s.eye, s.pitch, posture === 'LIE' ? 1300 : 900);
    this.setAim(null);
    this.onSeatChange?.(posture);
    return true;
  }

  /** Back on your feet where you were standing. */
  standUp(): boolean {
    const w = this.walk;
    if (!w?.seated) return false;
    const back = w.seated.returnTo;
    w.seated = null;
    this.setPosture(postureTransition(w.posture, 'STAND'));
    this.glideTo(back, w.yaw, EYE_HEIGHT_M, -0.06, 700);
    this.onSeatChange?.(null);
    return true;
  }

  get seatedPosture(): 'SIT' | 'LIE' | null {
    return this.walk?.seated?.posture ?? null;
  }

  /** Sit or lie on the aimed piece, or stand up (the overlay's Stand up). */
  standIfSeated(): boolean {
    return this.standUp();
  }

  private glideTo(to: Point, toYaw: number, toEye: number, toPitch: number, durationMs: number) {
    const w = this.walk;
    if (!w) return;
    if (durationMs > 0 && !this.reducedMotion) {
      w.glide = { from: { ...w.pos }, fromYaw: w.yaw, to, toYaw, fromEye: w.eye, toEye, fromPitch: w.pitch, toPitch, start: performance.now(), duration: durationMs };
    } else {
      w.glide = null;
      w.pos = to; w.yaw = toYaw; w.eye = toEye; w.pitch = toPitch;
      this.setPosture(postureTransition(w.posture, 'ARRIVED'));
      this.placeWalkCamera();
      this.reportRoom();
    }
    this.requestRender();
  }

  // ── The environment: time of day ─────────────────────────────────

  private envOverride: TimeOfDayEnv | null = null;
  private envTween: { from: LightRig; to: LightRig; start: number; duration: number } | null = null;
  private designLighting: { timeOfDay: TimeOfDayEnv; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interiorIntensity: number } | null = null;

  /**
   * The walkthrough's time of day (temporary, never saved). Light eases to
   * it, and room lights come on after dark unless the visitor switched them.
   */
  setEnvironment(timeOfDay: TimeOfDayEnv | null, animate = true) {
    this.envOverride = timeOfDay;
    const base = this.designLighting ?? { timeOfDay: 'DAY' as const, temperature: 'NEUTRAL' as const, interiorIntensity: 0.6 };
    const to = lightRig({ ...base, timeOfDay: timeOfDay ?? base.timeOfDay });
    if (animate && !this.reducedMotion) {
      this.envTween = { from: this.currentRig(), to, start: performance.now(), duration: 1400 };
    } else {
      this.envTween = null;
      this.applyRig(to);
    }
    this.followDaylight(timeOfDay ?? base.timeOfDay);
    this.requestRender();
  }

  get environment(): TimeOfDayEnv {
    return this.envOverride ?? this.designLighting?.timeOfDay ?? 'DAY';
  }

  private followDaylight(tod: TimeOfDayEnv) {
    if (!this.walk) return;
    const dark = tod === 'EVENING' || tod === 'NIGHT';
    for (const e of this.living.all()) {
      if (e.machine.role !== 'LIGHT' || e.objectId || e.touched) continue;
      this.living.force(e.key, dark ? 'ON' : 'OFF');
    }
  }

  private currentRig(): LightRig {
    return {
      sun: this.sun.intensity, sunColor: this.sun.color.clone(), sunPos: this.sun.position.clone(),
      hemi: this.hemi.intensity, interior: this.interior.intensity, interiorColor: this.interior.color.clone(),
      background: (this.scene.background as THREE.Color | null)?.clone() ?? new THREE.Color(TONE.background),
      env: this.scene.environmentIntensity,
    };
  }

  private applyRig(r: LightRig) {
    this.sun.intensity = r.sun;
    this.sun.color.copy(r.sunColor);
    this.sun.position.copy(r.sunPos);
    this.hemi.intensity = r.hemi;
    this.interior.intensity = r.interior;
    this.interior.color.copy(r.interiorColor);
    this.scene.background = r.background.clone();
    this.scene.environmentIntensity = r.env;
  }

  private stepEnvironment(now: number): boolean {
    const tw = this.envTween;
    if (!tw) return false;
    const t = Math.min(1, (now - tw.start) / tw.duration);
    const k = ease(t);
    this.applyRig({
      sun: tw.from.sun + (tw.to.sun - tw.from.sun) * k,
      sunColor: tw.from.sunColor.clone().lerp(tw.to.sunColor, k),
      sunPos: tw.from.sunPos.clone().lerp(tw.to.sunPos, k),
      hemi: tw.from.hemi + (tw.to.hemi - tw.from.hemi) * k,
      interior: tw.from.interior + (tw.to.interior - tw.from.interior) * k,
      interiorColor: tw.from.interiorColor.clone().lerp(tw.to.interiorColor, k),
      background: tw.from.background.clone().lerp(tw.to.background, k),
      env: tw.from.env + (tw.to.env - tw.from.env) * k,
    });
    if (t >= 1) this.envTween = null;
    return true;
  }

  // ── Stills for export ───────────────────────────────────────────────
  //
  // A high-resolution JPEG of one view: the overview, the plan from above,
  // or an eye-level Camera Director shot (ceilings on, no cutaway — the room
  // as a person standing in it sees it). The live view is restored exactly.

  async renderStill(
    view: { kind: 'OVERVIEW' | 'TOP' | 'CURRENT' } | { kind: 'EYE'; pose: WalkPose },
    width: number, height: number, quality = 0.92,
  ): Promise<Blob | null> {
    // The current view is taken exactly as it is — in the walkthrough too.
    if (this.walk && view.kind !== 'CURRENT') return null;
    const current = view.kind === 'CURRENT';
    const saved = this.snapshot();
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    const aspect = this.camera.aspect;
    const cutaway = this.cutawayEnabled;
    const focus = this.focusRadius;
    const viewMode = this.view;
    try {
      this.transition = null;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      if (view.kind === 'EYE') {
        this.cutawayEnabled = false;
        this.setCeilings(true);
        this.normalFrustum();
        this.camera.fov = view.pose.fov;
        this.camera.position.set(view.pose.position.x, EYE_HEIGHT_M, -view.pose.position.y);
        this.camera.lookAt(view.pose.target.x, EYE_HEIGHT_M - 0.15, -view.pose.target.y);
      } else if (!current) {
        this.cutawayEnabled = true;
        this.normalFrustum();
        this.camera.fov = 45;
        if (view.kind === 'TOP') this.topView(false); else this.frameAll(false);
      }
      this.camera.updateProjectionMatrix();
      this.cutawayKey = '';
      this.updateCutaway();
      this.renderer.render(this.scene, this.camera);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(this.renderer.domElement, 0, 0, width, height);
      return await new Promise<Blob | null>((resolve) => out.toBlob((b) => resolve(b), 'image/jpeg', quality));
    } catch {
      return null;
    } finally {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(size.x, size.y, false);
      this.camera.aspect = aspect;
      this.cutawayEnabled = cutaway;
      this.focusRadius = focus;
      this.view = viewMode;
      if (!current) {
        this.setCeilings(false);
        this.restore(saved, false);
      } else {
        this.camera.updateProjectionMatrix();
      }
      this.cutawayKey = '';
      this.requestRender();
    }
  }

  // ── Walkthrough ─────────────────────────────────────────────────────
  //
  // Eye height, the current design, real walls: the body moves only where
  // navigation.ts allows (walls, door gaps, furniture). Rendering runs
  // continuously only while the visitor is moving or looking around.

  get walking(): boolean {
    return !!this.walk;
  }

  /**
   * Enter the apartment as a person: eye height, the current design, real
   * walls. Desktop looks with the mouse (captured on a click, released with
   * Esc, which opens the menu) or by dragging; touch looks by dragging the
   * right of the screen while the overlay's left-thumb stick walks.
   */
  enterWalkthrough(model: WalkModel, pose: WalkPose, on: WalkCallbacks = {}) {
    if (this.walk) this.exitWalkthrough();
    const saved = this.snapshot();
    this.transition = null;
    this.controls.enabled = false;
    this.setCutaway(false);
    this.setCeilings(true);
    this.view = 'WALK';
    this.walk = {
      model, pos: pose.position, yaw: Math.atan2(pose.target.y - pose.position.y, pose.target.x - pose.position.x), pitch: -0.06,
      keys: new Set(), stick: { x: 0, y: 0 }, last: performance.now(), saved, room: null, onRoom: on.onRoom, glide: null,
      eye: EYE_HEIGHT_M, seated: null, vel: { x: 0, y: 0 }, brisk: false, posture: 'STANDING', route: null,
    };
    this.onSeatChange = on.onSeat;
    this.onMenu = on.onMenu;
    this.onLockChange = on.onLock;
    this.onPostureChange = on.onPosture;
    this.normalFrustum();
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.onAimChange = on.onAim;
    this.lastPointer = null;
    // Doors start as the design shows them: closed doors block from the first step.
    for (const e of this.living.all()) if (e.doorId) setDoorClosed(model, e.doorId, !!e.machine.states.get(e.target ?? e.state)?.blocks);
    this.followDaylight(this.environment);
    this.renderer.domElement.style.cursor = 'crosshair';
    this.updateHandle();
    window.addEventListener('keydown', this.onWalkKey);
    window.addEventListener('keyup', this.onWalkKey);
    window.addEventListener('blur', this.clearWalkInput);
    document.addEventListener('pointerlockchange', this.onLockEvent);
    document.addEventListener('mousemove', this.onLockedMouse);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onLookDown);
    el.addEventListener('pointermove', this.onLookMove);
    el.addEventListener('pointerup', this.onLookUp);
    el.addEventListener('pointercancel', this.onLookCancel);
    this.placeWalkCamera();
    this.reportRoom();
    this.requestRender();
  }

  exitWalkthrough() {
    const w = this.walk;
    if (!w) return;
    if (w.route) { const done = w.route.done; w.route = null; done(false); }
    this.walk = null;
    this.leavingLock = true;
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
    window.removeEventListener('keydown', this.onWalkKey);
    window.removeEventListener('keyup', this.onWalkKey);
    window.removeEventListener('blur', this.clearWalkInput);
    document.removeEventListener('pointerlockchange', this.onLockEvent);
    document.removeEventListener('mousemove', this.onLockedMouse);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onLookDown);
    el.removeEventListener('pointermove', this.onLookMove);
    el.removeEventListener('pointerup', this.onLookUp);
    el.removeEventListener('pointercancel', this.onLookCancel);
    this.gestures.clear();
    this.controls.enabled = true;
    this.setCutaway(true);
    this.setCeilings(false);
    this.view = 'OVERVIEW';
    this.resetInteractives();
    this.onAimChange = undefined;
    this.onSeatChange = undefined;
    this.onMenu = undefined;
    this.onLockChange = undefined;
    this.onPostureChange = undefined;
    if (this.envOverride) this.setEnvironment(null, false);
    this.renderer.domElement.style.cursor = '';
    this.restore(w.saved, false);
  }

  /**
   * Stand somewhere else (a room from the tour, or back at the entry). With
   * a duration the visitor glides there — a straight path between two free
   * points of the same space (the guided tour); without, it is a cut.
   */
  walkTo(pose: WalkPose, durationMs = 0) {
    const w = this.walk;
    if (!w) return;
    if (w.seated) { w.seated = null; this.onSeatChange?.(null); this.setPosture('STANDING'); }
    w.vel = { x: 0, y: 0 };
    this.normalFrustum();
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    const toYaw = Math.atan2(pose.target.y - pose.position.y, pose.target.x - pose.position.x);
    this.glideTo(pose.position, toYaw, EYE_HEIGHT_M, -0.06, durationMs);
  }

  /** True while a glide is under way (the guided tour waits for it). */
  get gliding(): boolean {
    return !!this.walk?.glide;
  }

  /** The on-screen joystick: x strafes, y walks (up = forward), each −1…1. */
  setWalkStick(x: number, y: number) {
    if (!this.walk) return;
    this.walk.stick = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    if (x || y) this.walk.glide = this.walk.seated ? this.walk.glide : null;
    this.requestRender();
  }

  /** Touch look from the overlay (a drag that began over the stick zone). */
  lookBy(dxPx: number, dyPx: number) {
    const w = this.walk;
    if (!w) return;
    const next = look(w.yaw, w.pitch, dxPx, dyPx, this.settings);
    w.yaw = next.yaw; w.pitch = next.pitch;
    this.placeWalkCamera();
    this.lastPointer = null;
    this.queueAim();
    this.requestRender();
  }

  /** Interact with whatever is at a screen point (a tap the overlay received). */
  tapAt(clientX: number, clientY: number): boolean {
    if (!this.walk) return false;
    const hit = this.targetAt(clientX, clientY);
    if (!hit) return false;
    this.setAim(hit);
    return this.performAimed();
  }

  walkPosition(): Point | null {
    return this.walk ? { ...this.walk.pos } : null;
  }

  /** Where the visitor is and how (tests, Live Here). */
  playerState(): { pos: Point; yaw: number; pitch: number; eye: number; posture: Posture; speed: number; locked: boolean } | null {
    const w = this.walk;
    if (!w) return null;
    return { pos: { ...w.pos }, yaw: w.yaw, pitch: w.pitch, eye: w.eye, posture: w.posture, speed: Math.hypot(w.vel.x, w.vel.y), locked: this.pointerLocked };
  }

  // ── Settings ──────────────────────────────────────────────────────

  private settings: PlayerSettings = DEFAULT_SETTINGS;
  private baseReducedMotion = false;

  setPlayerSettings(s: Partial<PlayerSettings>) {
    this.settings = normalizeSettings({ ...this.settings, ...s });
    this.reducedMotion = this.baseReducedMotion || this.settings.reducedMotion;
    this.living.setReducedMotion(this.reducedMotion);
  }

  // ── Input ─────────────────────────────────────────────────────────

  private onMenu?: () => void;
  private onLockChange?: (locked: boolean) => void;
  private onPostureChange?: (posture: Posture) => void;
  private pointerLocked = false;
  private lockUnavailable = false;
  private leavingLock = false;

  private setPosture(p: Posture) {
    const w = this.walk;
    if (!w || w.posture === p) return;
    w.posture = p;
    this.onPostureChange?.(p);
  }

  /** Capture the mouse for looking (desktop). Must be called from a click. */
  lockPointer(): boolean {
    const el = this.renderer.domElement as HTMLCanvasElement & { requestPointerLock?: () => Promise<void> | void };
    if (!this.walk || this.lockUnavailable || !el.requestPointerLock) return false;
    try {
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { this.lockUnavailable = true; });
      return true;
    } catch {
      this.lockUnavailable = true;
      return false;
    }
  }

  private onLockEvent = () => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (locked === this.pointerLocked) return;
    this.pointerLocked = locked;
    this.renderer.domElement.style.cursor = locked ? 'none' : (this.walk ? 'crosshair' : '');
    this.lastPointer = null;
    this.onLockChange?.(locked);
    // Esc released the mouse: the menu opens (unless we are leaving on purpose).
    if (!locked && this.walk && !this.leavingLock) this.onMenu?.();
    this.leavingLock = false;
    this.queueAim();
  };

  /** Release the mouse without opening the menu (the menu's own buttons). */
  releasePointer() {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.leavingLock = true;
    document.exitPointerLock?.();
  }

  private onWalkKey = (e: KeyboardEvent) => {
    const w = this.walk;
    if (!w) return;
    const el = e.target as HTMLElement | null;
    const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (typing) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { w.brisk = e.type === 'keydown'; return; }
    if (e.type === 'keydown' && e.code === 'Escape') {
      // Locked, the browser takes Esc to release the mouse (and we open the menu then).
      if (!this.pointerLocked) { e.preventDefault(); this.onMenu?.(); }
      return;
    }
    if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') && e.type === 'keydown') {
      // Enter and Space already press a focused button; E never does.
      if (el && e.code !== 'KeyE' && /^(BUTTON|A)$/.test(el.tagName)) return;
      e.preventDefault();
      if (!this.aimed || this.pointerLocked) {
        this.lastPointer = null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.setAim(this.targetAt(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }
      this.performAimed();
      return;
    }
    if (!WALK_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.type === 'keydown') {
      if (!w.keys.size) w.last = performance.now();
      w.keys.add(e.code);
    } else {
      w.keys.delete(e.code);
    }
    w.brisk = e.shiftKey;
    this.requestRender();
  };

  private clearWalkInput = () => {
    if (!this.walk) return;
    this.walk.keys.clear();
    this.walk.brisk = false;
    this.walk.stick = { x: 0, y: 0 };
  };

  /**
   * One pointer's gesture on the canvas. Starting on a part that opens by
   * hand (a door, a drawer, a sliding door) and dragging moves the part;
   * starting anywhere else and dragging looks around; a short press
   * without movement interacts with what it lands on (or, on empty space
   * with a mouse, captures the mouse for looking).
   */
  private gestures = new Map<number, {
    x: number; y: number; t: number; lastX: number; lastY: number; moved: number; locked: boolean; mouse: boolean;
    part: { key: string; t0: number; dir: { x: number; y: number }; lenSq: number; lastT: number; lastAt: number; fling: number } | null;
    scrubbing: boolean; total: { x: number; y: number };
  }>();

  /** The screen direction a two-state part travels as it opens, and how far (px). */
  private scrubAxis(key: string): { dir: { x: number; y: number }; lenSq: number; t0: number } | null {
    const e = this.living.get(key);
    if (!e || !this.living.canScrub(e)) return null;
    const node = [...e.parts.values()][0]?.node;
    if (!node) return null;
    const t0 = this.living.progress(e);
    const at = (t: number) => {
      this.living.scrubTo(key, t);
      const c = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()).project(this.camera);
      const rect = this.renderer.domElement.getBoundingClientRect();
      return { x: ((c.x + 1) / 2) * rect.width, y: ((1 - c.y) / 2) * rect.height };
    };
    const a = at(0);
    const b = at(1);
    this.living.scrubTo(key, t0);
    let dir = { x: b.x - a.x, y: b.y - a.y };
    let lenSq = dir.x * dir.x + dir.y * dir.y;
    // Seen edge-on a part barely moves on screen; a sensible minimum keeps it draggable.
    if (lenSq < 90 * 90) {
      const len = Math.sqrt(lenSq) || 1;
      dir = lenSq > 1 ? { x: (dir.x / len) * 90, y: (dir.y / len) * 90 } : { x: 90, y: 0 };
      lenSq = 90 * 90;
    }
    return { dir, lenSq, t0 };
  }

  private beginGesture(id: number, x: number, y: number, mouse: boolean) {
    const locked = this.pointerLocked && mouse;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = locked ? rect.left + rect.width / 2 : x;
    const py = locked ? rect.top + rect.height / 2 : y;
    const hit = this.targetAt(px, py);
    let part: NonNullable<ReturnType<typeof this.gestures.get>>['part'] = null;
    if (hit?.entry && this.living.canScrub(hit.entry)) {
      const axis = this.scrubAxis(hit.entry.key);
      if (axis) part = { key: hit.entry.key, ...axis, lastT: axis.t0, lastAt: performance.now(), fling: 0 };
    }
    this.gestures.set(id, { x, y, t: performance.now(), lastX: x, lastY: y, moved: 0, locked, mouse, part, scrubbing: false, total: { x: 0, y: 0 } });
  }

  private moveGesture(id: number, dx: number, dy: number) {
    const g = this.gestures.get(id);
    const w = this.walk;
    if (!g || !w) return;
    g.moved += Math.hypot(dx, dy);
    g.total = { x: g.total.x + dx, y: g.total.y + dy };
    if (g.part && g.moved > 6) {
      // The part is in the visitor's hand: it follows the drag exactly.
      g.scrubbing = true;
      const p = g.part;
      const t = Math.max(0, Math.min(1, p.t0 + (g.total.x * p.dir.x + g.total.y * p.dir.y) / p.lenSq));
      const now = performance.now();
      if (now > p.lastAt) p.fling = ((t - p.lastT) / (now - p.lastAt)) * 1000;
      p.lastT = t;
      p.lastAt = now;
      this.living.scrubTo(p.key, t);
      this.refreshAimBox();
      this.requestRender();
      return;
    }
    if (g.part) return;
    if (w.route && g.moved > 6) this.cancelRoute(false);
    const next = look(w.yaw, w.pitch, dx, dy, this.settings);
    w.yaw = next.yaw;
    w.pitch = next.pitch;
    this.placeWalkCamera();
    this.requestRender();
  }

  private endGesture(id: number, x: number, y: number) {
    const g = this.gestures.get(id);
    this.gestures.delete(id);
    if (!g || !this.walk) return;
    if (g.scrubbing && g.part) {
      this.living.scrubEnd(g.part.key, g.part.fling);
      this.requestRender();
      return;
    }
    const quick = performance.now() - g.t < 450 && g.moved < 8;
    if (!quick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = g.locked ? rect.left + rect.width / 2 : x;
    const py = g.locked ? rect.top + rect.height / 2 : y;
    const hit = this.targetAt(px, py);
    if (hit) {
      this.setAim(hit);
      this.performAimed();
      return;
    }
    // A click on empty space captures the mouse for looking (desktop).
    if (g.mouse && !g.locked) this.lockPointer();
  }

  private onLookDown = (e: PointerEvent) => {
    if (!this.walk || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.beginGesture(e.pointerId, e.clientX, e.clientY, e.pointerType === 'mouse');
    if (!this.pointerLocked) this.renderer.domElement.setPointerCapture?.(e.pointerId);
  };

  private onLookMove = (e: PointerEvent) => {
    const w = this.walk;
    if (!w) return;
    if (e.pointerType === 'mouse' && this.pointerLocked) return; // handled as raw mouse movement
    const g = this.gestures.get(e.pointerId);
    if (!g) {
      if (e.pointerType === 'mouse') {
        // Hover: point at something that can be used, and it says so.
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.queueAim();
      }
      return;
    }
    const dx = e.clientX - g.lastX;
    const dy = e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    this.moveGesture(e.pointerId, dx, dy);
  };

  /** Raw mouse movement while the mouse is captured: look (or drag a part being held). */
  private onLockedMouse = (e: MouseEvent) => {
    if (!this.walk || !this.pointerLocked) return;
    const held = [...this.gestures.entries()].find(([, g]) => g.locked);
    if (held) { this.moveGesture(held[0], e.movementX, e.movementY); return; }
    const w = this.walk;
    const next = look(w.yaw, w.pitch, e.movementX, e.movementY, this.settings);
    w.yaw = next.yaw;
    w.pitch = next.pitch;
    this.placeWalkCamera();
    this.lastPointer = null;
    this.queueAim();
    this.requestRender();
  };

  private onLookUp = (e: PointerEvent) => {
    this.endGesture(e.pointerId, e.clientX, e.clientY);
  };

  private onLookCancel = (e: PointerEvent) => {
    const g = this.gestures.get(e.pointerId);
    this.gestures.delete(e.pointerId);
    if (g?.scrubbing && g.part) this.living.scrubEnd(g.part.key, 0);
  };

  private placeWalkCamera() {
    const w = this.walk;
    if (!w) return;
    this.camera.position.set(w.pos.x, w.eye, -w.pos.y);
    const cp = Math.cos(w.pitch);
    this.camera.lookAt(w.pos.x + Math.cos(w.yaw) * cp, w.eye + Math.sin(w.pitch), -(w.pos.y + Math.sin(w.yaw) * cp));
  }

  private reportRoom() {
    const w = this.walk;
    if (!w || !this.space) return;
    const room = roomContaining(this.space, w.pos);
    if (room !== w.room) {
      w.room = room;
      w.onRoom?.(room);
    }
  }

  /** One frame of walking. Returns true while the body is moving or input is active (keep drawing). */
  private stepWalk(now: number): boolean {
    const w = this.walk!;
    const dt = Math.min(0.05, Math.max(0, (now - w.last) / 1000));
    w.last = now;
    if (w.glide) {
      const g = w.glide;
      const t = g.duration <= 0 ? 1 : Math.min(1, (now - g.start) / g.duration);
      const k = easeInOutCubic(t);
      w.pos = { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k };
      w.yaw = g.fromYaw + Math.atan2(Math.sin(g.toYaw - g.fromYaw), Math.cos(g.toYaw - g.fromYaw)) * k;
      w.eye = g.fromEye + (g.toEye - g.fromEye) * k;
      w.pitch = g.fromPitch + (g.toPitch - g.fromPitch) * k;
      if (t >= 1) {
        w.glide = null;
        this.setPosture(postureTransition(w.posture, 'ARRIVED'));
      }
      this.placeWalkCamera();
      this.reportRoom();
      return true;
    }
    const k = (code: string) => (w.keys.has(code) ? 1 : 0);
    const input = {
      forward: Math.max(-1, Math.min(1, k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - w.stick.y)),
      strafe: Math.max(-1, Math.min(1, k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + w.stick.x)),
      // A full push of the stick is a brisk walk, like Shift on a keyboard.
      brisk: w.brisk || Math.hypot(w.stick.x, w.stick.y) > 0.96,
    };
    const wantsToMove = input.forward !== 0 || input.strafe !== 0;
    if (w.route) {
      if (wantsToMove) this.cancelRoute(false);
      else return this.stepRoute(dt);
    }
    // Seated, a step means getting up first.
    if (!canWalk(w.posture)) {
      if (wantsToMove && (w.posture === 'SEATED' || w.posture === 'LYING')) this.standUp();
      return wantsToMove;
    }
    const wish = wishVelocity(input, w.yaw, this.settings);
    const moving = Math.hypot(w.vel.x, w.vel.y) > 1e-3;
    if (!wantsToMove && !moving) return false;
    const body = stepBody(w.model, w.pos, w.vel, wish, dt);
    w.pos = body.pos;
    w.vel = body.vel;
    this.placeWalkCamera();
    this.reportRoom();
    this.lastPointer = this.pointerLocked ? null : this.lastPointer;
    this.queueAim();
    return true;
  }

  // ── Teardown ────────────────────────────────────────────────────────

  dispose() {
    if (this.walk) this.exitWalkthrough();
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.dropOutline(this.selectionOutline);
    this.dropOutline(this.hoverOutline);
    this.clearGroup(this.spaceGroup);
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.objectsGroup);
    this.clearGroup(this.fixturesGroup);
    this.living.dispose();
    this.envTexture?.dispose();
    for (const d of this.disposables) d.dispose();
    this.listeners.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentNode === this.mount) this.mount.removeChild(this.renderer.domElement);
  }
}

/** The parts of a wall's slabs that fall within [from, to] along the wall. */
export function clipSlabs(slabs: WallSlab[], from: number, to: number): WallSlab[] {
  const out: WallSlab[] = [];
  for (const s of slabs) {
    const a = Math.max(s.u, from);
    const b = Math.min(s.u + s.lengthM, to);
    if (b - a > 0.001) out.push({ ...s, u: a, lengthM: b - a });
  }
  return out;
}

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
import {
  ceilingSurfaceId, floorSurfaceId, wallSlabPlacement, type SpaceModel, type SpaceRoom,
} from '@/lib/designStudio/space';
import { sliceWall, type WallSlab } from '@/lib/floorplan/slabs';
import type { QualityProfile } from '@/lib/designStudio/quality';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import type { DesignState, ObjectInstance } from '@/lib/designStudio/designState';
import { PAINTABLE_ROLES, type PartRole } from '@/lib/designStudio/modelParts';
import { EYE_HEIGHT_M, move as walkMove, type WalkModel } from '@/lib/designStudio/navigation';
import { roomContaining, type Point } from '@/lib/designStudio/space';
import { buildProcedural, slotColors } from './procedural';

export type PickTarget =
  | { kind: 'surface'; id: string; roomId: string | null }
  | { kind: 'object'; id: string; roomId: string | null }
  | { kind: 'room'; id: string }
  /** An identified piece of furniture inside an uploaded model. */
  | { kind: 'part'; id: string }
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

const WALK_SPEED_M_S = 1.4;
const TURN_RAD_S = 1.9;
const LOOK_RAD_PER_PX = 0.005;
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

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
    drag: { id: number; x: number; y: number } | null;
  } | null = null;

  constructor(mount: HTMLElement, quality: QualityProfile, options: { reducedMotion?: boolean } = {}) {
    this.mount = mount;
    this.quality = quality;
    this.reducedMotion = !!options.reducedMotion;

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

    this.buildLighting();
    this.scene.add(this.spaceGroup, this.modelGroup, this.objectsGroup, this.overlayGroup);

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
  }

  /**
   * A design-preview lighting setup: the time of day and the colour of the
   * interior light. Not a lux calculation, and never presented as one.
   */
  setLighting(l: { timeOfDay: 'DAY' | 'EVENING' | 'NIGHT'; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interiorIntensity: number }) {
    const kelvinColor = l.temperature === 'WARM' ? 0xffd8a8 : l.temperature === 'COOL' ? 0xdfe9ff : 0xfff3e2;
    const day = l.timeOfDay === 'DAY' ? 1 : l.timeOfDay === 'EVENING' ? 0.45 : 0.08;
    this.sun.intensity = 1.5 * day;
    this.sun.color.set(l.timeOfDay === 'EVENING' ? 0xffc59a : 0xffffff);
    this.hemi.intensity = 0.35 + 1.0 * day;
    this.interior.color.set(kelvinColor);
    this.interior.intensity = (1 - day) * 1.6 * Math.max(0, Math.min(1, l.interiorIntensity)) + 0.1;
    this.scene.background = new THREE.Color(l.timeOfDay === 'NIGHT' ? 0x1c2230 : l.timeOfDay === 'EVENING' ? 0xd9d2cb : TONE.background);
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
        for (const piece of pieces) {
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
    const hits = this.raycaster.intersectObjects([this.spaceGroup, this.modelGroup, this.objectsGroup], true);
    for (const hit of hits) {
      // Hidden things (cut-away walls, ceilings seen from above) are not there to be clicked.
      if (!hit.object.visible) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (!o.visible) break;
        const data = o.userData as Partial<PickData>;
        if (data.pick) return { target: data.pick, point: hit.point.clone() };
        o = o.parent;
      }
      // A wall body (structure) stops the ray: whatever is behind it is hidden.
      if (this.wallBodies.includes(hit.object as THREE.Mesh)) return null;
    }
    return null;
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
        const box = new THREE.Box3().setFromObject(obj);
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

    this.setLighting(state.lighting);
    this.requestRender();
  }

  private buildObject(obj: ObjectInstance, asset: CatalogAsset | undefined): THREE.Object3D {
    if (asset?.procedural) {
      return buildProcedural(asset.procedural.kind, asset, slotColors(asset, obj.materialVariant, obj.colorOverride));
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
    node.position.set(planX, elevation, -planY);
    node.rotation.set(0, rotation, 0);
  }

  private disposeObject(id: string) {
    const node = this.objectsById.get(id);
    if (!node) return;
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
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

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
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
    for (const c of this.ceilingMeshes) c.visible = visible;
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

  // ── Walkthrough ─────────────────────────────────────────────────────
  //
  // Eye height, the current design, real walls: the body moves only where
  // navigation.ts allows (walls, door gaps, furniture). Rendering runs
  // continuously only while the visitor is moving or looking around.

  get walking(): boolean {
    return !!this.walk;
  }

  enterWalkthrough(model: WalkModel, pose: WalkPose, onRoom?: (roomId: string | null) => void) {
    if (this.walk) this.exitWalkthrough();
    const saved = this.snapshot();
    this.transition = null;
    this.controls.enabled = false;
    this.setCutaway(false);
    this.setCeilings(true);
    this.view = 'WALK';
    this.walk = {
      model, pos: pose.position, yaw: Math.atan2(pose.target.y - pose.position.y, pose.target.x - pose.position.x), pitch: -0.06,
      keys: new Set(), stick: { x: 0, y: 0 }, last: performance.now(), saved, room: null, onRoom, drag: null,
    };
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    window.addEventListener('keydown', this.onWalkKey);
    window.addEventListener('keyup', this.onWalkKey);
    window.addEventListener('blur', this.clearWalkInput);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onLookDown);
    el.addEventListener('pointermove', this.onLookMove);
    el.addEventListener('pointerup', this.onLookUp);
    el.addEventListener('pointercancel', this.onLookUp);
    this.placeWalkCamera();
    this.reportRoom();
    this.requestRender();
  }

  exitWalkthrough() {
    const w = this.walk;
    if (!w) return;
    this.walk = null;
    window.removeEventListener('keydown', this.onWalkKey);
    window.removeEventListener('keyup', this.onWalkKey);
    window.removeEventListener('blur', this.clearWalkInput);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onLookDown);
    el.removeEventListener('pointermove', this.onLookMove);
    el.removeEventListener('pointerup', this.onLookUp);
    el.removeEventListener('pointercancel', this.onLookUp);
    this.controls.enabled = true;
    this.setCutaway(true);
    this.setCeilings(false);
    this.view = 'OVERVIEW';
    this.restore(w.saved, false);
  }

  /** Stand somewhere else (a room from the tour, or back at the entry). */
  walkTo(pose: WalkPose) {
    const w = this.walk;
    if (!w) return;
    w.pos = pose.position;
    w.yaw = Math.atan2(pose.target.y - pose.position.y, pose.target.x - pose.position.x);
    w.pitch = -0.06;
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.placeWalkCamera();
    this.reportRoom();
    this.requestRender();
  }

  /** The on-screen joystick: x strafes, y walks (up = forward), each −1…1. */
  setWalkStick(x: number, y: number) {
    if (!this.walk) return;
    this.walk.stick = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    this.walk.last = performance.now();
    this.requestRender();
  }

  walkPosition(): Point | null {
    return this.walk ? { ...this.walk.pos } : null;
  }

  private onWalkKey = (e: KeyboardEvent) => {
    const w = this.walk;
    if (!w || !WALK_KEYS.has(e.code)) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    e.preventDefault();
    if (e.type === 'keydown') {
      if (!w.keys.size) w.last = performance.now();
      w.keys.add(e.code);
    } else {
      w.keys.delete(e.code);
    }
    this.requestRender();
  };

  private clearWalkInput = () => {
    if (!this.walk) return;
    this.walk.keys.clear();
    this.walk.stick = { x: 0, y: 0 };
  };

  private onLookDown = (e: PointerEvent) => {
    if (!this.walk || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.walk.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  };

  private onLookMove = (e: PointerEvent) => {
    const w = this.walk;
    if (!w?.drag || w.drag.id !== e.pointerId) return;
    const dx = e.clientX - w.drag.x;
    const dy = e.clientY - w.drag.y;
    w.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    w.yaw -= dx * LOOK_RAD_PER_PX;
    w.pitch = Math.max(-0.9, Math.min(0.6, w.pitch - dy * LOOK_RAD_PER_PX));
    this.placeWalkCamera();
    this.requestRender();
  };

  private onLookUp = (e: PointerEvent) => {
    if (this.walk?.drag?.id === e.pointerId) this.walk.drag = null;
  };

  private placeWalkCamera() {
    const w = this.walk;
    if (!w) return;
    this.camera.position.set(w.pos.x, EYE_HEIGHT_M, -w.pos.y);
    const cp = Math.cos(w.pitch);
    this.camera.lookAt(w.pos.x + Math.cos(w.yaw) * cp, EYE_HEIGHT_M + Math.sin(w.pitch), -(w.pos.y + Math.sin(w.yaw) * cp));
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

  /** One frame of walking. Returns true while input is active (keep drawing). */
  private stepWalk(now: number): boolean {
    const w = this.walk!;
    const dt = Math.min(0.05, Math.max(0, (now - w.last) / 1000));
    w.last = now;
    const k = (code: string) => (w.keys.has(code) ? 1 : 0);
    const forward = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - w.stick.y;
    const strafe = k('KeyD') - k('KeyA') + w.stick.x;
    const turn = k('ArrowRight') + k('KeyE') - k('ArrowLeft') - k('KeyQ');
    const active = forward !== 0 || strafe !== 0 || turn !== 0;
    if (!active) return false;
    w.yaw -= turn * TURN_RAD_S * dt;
    const f = { x: Math.cos(w.yaw), y: Math.sin(w.yaw) };
    const r = { x: Math.sin(w.yaw), y: -Math.cos(w.yaw) };
    let mx = f.x * forward + r.x * strafe;
    let my = f.y * forward + r.y * strafe;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    w.pos = walkMove(w.model, w.pos, { x: mx * WALK_SPEED_M_S * dt, y: my * WALK_SPEED_M_S * dt });
    this.placeWalkCamera();
    this.reportRoom();
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

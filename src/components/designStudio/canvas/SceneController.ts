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

export type PickTarget =
  | { kind: 'surface'; id: string; roomId: string | null }
  | { kind: 'object'; id: string; roomId: string | null }
  | { kind: 'room'; id: string }
  | { kind: 'model' };

export type ViewMode = 'OVERVIEW' | 'TOP' | 'ROOM';

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
  private raycaster = new THREE.Raycaster();

  private transition: {
    from: { pos: THREE.Vector3; target: THREE.Vector3 };
    to: { pos: THREE.Vector3; target: THREE.Vector3 };
    start: number; duration: number;
  } | null = null;

  private selectionOutline: THREE.Object3D | null = null;
  private hoverOutline: THREE.Object3D | null = null;
  private view: ViewMode = 'OVERVIEW';

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
    // update() returns true while damping is still moving the camera.
    if (this.controls.update()) moving = true;
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.listeners) fn();
    if (moving) this.requestRender();
  };

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

  /** A model source (developer apartment, uploaded GLB): shown as given. */
  setModel(object: THREE.Object3D) {
    this.clearGroup(this.modelGroup);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = this.quality.shadows;
        mesh.receiveShadow = this.quality.shadows;
        mesh.userData = { ...mesh.userData, pick: { kind: 'model' } } satisfies PickData & Record<string, unknown>;
      }
    });
    this.modelGroup.add(object);
    this.frameObject(this.modelGroup, false);
    this.requestRender();
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
      const m = this.surfaceMaterials.get(id);
      if (!m) continue;
      this.tinted.set(m, { color: m.emissive.getHex(), intensity: m.emissiveIntensity });
      m.emissive.setHex(TONE.select);
      m.emissiveIntensity = strength;
    }
  }

  private outlineFor(target: PickTarget | null, color: number): THREE.Object3D | null {
    if (!target) return null;
    // Surfaces are outlined where they are visible (depth-tested); objects
    // keep their box on top so a selected sofa behind a wall can be found.
    const onTop = target.kind === 'object' || target.kind === 'model';
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
    if (target.kind === 'surface') {
      for (const mesh of this.surfaceMeshes.get(target.id) ?? []) addEdges(mesh);
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

  // ── Objects (design layer) ──────────────────────────────────────────

  readonly objectsGroup = new THREE.Group();
  readonly objectsById = new Map<string, THREE.Object3D>();

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

  // ── Teardown ────────────────────────────────────────────────────────

  dispose() {
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

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { GeneratedScene } from '@/lib/floorplan/geometry';
import { sliceWall } from '@/lib/floorplan/slabs';

/**
 * THE STRUCTURAL SHELL.
 *
 * The first question the 2D → 3D pipeline has to answer is not "is it
 * beautiful" but "is it RIGHT": does the space this renders actually match the
 * verified plan? So this draws white walls, a floor per room, real holes where
 * the verified doors and windows are, and nothing else. No furniture, no
 * materials, no mood — anything decorative here would make an inaccurate shell
 * harder to spot, which is the opposite of what this component is for.
 *
 * IT INVENTS NOTHING. Every box below is a number the geometry generator
 * produced from a verified plan. Where a wall was not verified there is a gap,
 * and the panel over the canvas says how many gaps there are, because a shell
 * that quietly closes them is a shell that lies about what was checked.
 *
 * RENDERING IS ON DEMAND. No permanent animation frame: the scene is drawn
 * when the camera moves and when the geometry changes, and otherwise the tab
 * costs nothing. A viewer left open on a phone must not hold the GPU awake.
 */

const TONE = {
  wall: 0xf2efe9,
  reveal: 0xe6e1d8,
  floor: 0xd8d2c6,
  outdoor: 0xc8cfc4,
  ground: 0xeceae5,
};

export function FloorPlanShell({
  scene: plan, className, onReady,
}: {
  scene: GeneratedScene;
  className?: string;
  onReady?: () => void;
}) {
  const { t } = useLanguage();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglMissing, setWebglMissing] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setWebglMissing(true);
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth || 1, mount.clientHeight || 1, false);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f6f3);

    const camera = new THREE.PerspectiveCamera(
      50, (mount.clientWidth || 1) / (mount.clientHeight || 1), 0.05, 400,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;

    // ── Lighting: enough to read a corner, not enough to flatter it ────────
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b3a7, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
    const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
      disposables.push(x);
      return x;
    };

    const wallMat = track(new THREE.MeshStandardMaterial({ color: TONE.wall, roughness: 0.92 }));
    const revealMat = track(new THREE.MeshStandardMaterial({ color: TONE.reveal, roughness: 0.95 }));
    const floorMat = track(new THREE.MeshStandardMaterial({ color: TONE.floor, roughness: 0.95 }));
    const outdoorMat = track(new THREE.MeshStandardMaterial({ color: TONE.outdoor, roughness: 0.98 }));

    // ── The ground the building stands on ──────────────────────────────────
    const ground = new THREE.Mesh(
      track(new THREE.PlaneGeometry(
        Math.max(plan.extent.width, plan.extent.depth) * 3 + 10,
        Math.max(plan.extent.width, plan.extent.depth) * 3 + 10,
      )),
      track(new THREE.MeshStandardMaterial({ color: TONE.ground, roughness: 1 })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    // ── Floors, one polygon per verified room ──────────────────────────────
    for (const floor of plan.floors) {
      const shape = new THREE.Shape();
      floor.polygon.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, p.y);
        else shape.lineTo(p.x, p.y);
      });
      shape.closePath();
      const geometry = track(new THREE.ShapeGeometry(shape));
      const mesh = new THREE.Mesh(geometry, floor.outdoor ? outdoorMat : floorMat);
      // The shape is drawn in XY; the floor lies in XZ.
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = floor.outdoor ? 0.005 : 0.01;
      scene.add(mesh);
    }

    // ── Walls, cut into solid pieces around their openings ─────────────────
    for (const wall of plan.walls) {
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const angle = Math.atan2(dy, dx);

      for (const slab of sliceWall(wall)) {
        if (slab.lengthM <= 0 || slab.heightM <= 0) continue;
        const box = track(new THREE.BoxGeometry(slab.lengthM, slab.heightM, wall.thicknessM));
        const mesh = new THREE.Mesh(box, slab.role === 'SOLID' ? wallMat : revealMat);
        // Along the wall to the slab's centre, then up to its middle.
        const mid = slab.u + slab.lengthM / 2;
        mesh.position.set(
          wall.start.x + Math.cos(angle) * mid,
          slab.v + slab.heightM / 2,
          // Three's Z runs opposite the plan's forward axis.
          -(wall.start.y + Math.sin(angle) * mid),
        );
        mesh.rotation.y = -angle;
        scene.add(mesh);
      }
    }

    // ── Frame the whole apartment ──────────────────────────────────────────
    const w = plan.extent.width;
    const d = plan.extent.depth;
    const radius = Math.hypot(w, d, plan.ceilingHeightM) / 2;
    const distance = (radius / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 0.95;
    controls.target.set(w / 2, plan.ceilingHeightM / 2, -d / 2);
    camera.position.set(w / 2 + distance * 0.55, distance * 0.62, -d / 2 + distance * 0.62);
    camera.updateProjectionMatrix();
    controls.update();

    /* ON DEMAND. A frame is drawn when something changed, never on a loop. */
    let queued = false;
    const draw = () => {
      queued = false;
      controls.update();
      renderer.render(scene, camera);
    };
    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(draw);
    };
    controls.addEventListener('change', request);

    const ro = new ResizeObserver(() => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      request();
    });
    ro.observe(mount);

    draw();
    onReady?.();

    return () => {
      ro.disconnect();
      controls.removeEventListener('change', request);
      controls.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [plan, onReady]);

  const missing = plan.skipped.walls + plan.skipped.doors + plan.skipped.windows
    + plan.skipped.rooms + plan.skipped.balconies;

  return (
    <div className={cn('relative w-full overflow-hidden rounded-lg bg-sand/40', className)}>
      <div
        ref={mountRef}
        className="h-full w-full"
        role="application"
        aria-label={t('dev_fp_shell_label')}
      />

      {webglMissing && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-muted-foreground">{t('twin_no_webgl')}</p>
        </div>
      )}

      {/* WHAT WAS BUILT, AND WHAT WAS NOT. A shell that hides its gaps is
          worse than one that has them. */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-[18rem] rounded-md border border-border bg-background/90 px-2.5 py-1.5 backdrop-blur">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('dev_fp_shell_badge')}
        </p>
        <p className="mt-0.5 tabular text-2xs text-muted-foreground">
          {t('dev_fp_shell_built')
            .replace('{walls}', String(plan.built.walls))
            .replace('{rooms}', String(plan.built.rooms))
            .replace('{doors}', String(plan.built.doors))
            .replace('{windows}', String(plan.built.windows))}
        </p>
        {missing > 0 && (
          <p className="mt-0.5 text-2xs text-amber-700 dark:text-amber-400">
            {t('dev_fp_shell_skipped').replace('{n}', String(missing))}
          </p>
        )}
      </div>
    </div>
  );
}

export default FloorPlanShell;

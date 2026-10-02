// A STILL FROM THE PICTURE'S OWN CAMERA, WITHOUT A VISIBLE CANVAS.
//
// The hybrid engine's visual check compares the customer's picture with the
// rebuilt scene seen from exactly that camera. The scene is drawn once in a
// detached, invisible canvas (the same SceneController as the editor, so the
// still is what the customer will see), turned into a JPEG, and thrown away.

import type { DesignState } from '@/lib/designStudio/designState';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import { chooseQuality, readDeviceSignals } from '@/lib/designStudio/quality';
import type { SpaceModel } from '@/lib/designStudio/space';
import { viewForCanvas, type CameraFit } from '@/lib/designStudio/sourceCamera';
import { SceneController } from './SceneController';

export interface StillRequest {
  space: SpaceModel;
  state: DesignState;
  assets: CatalogAsset[];
  materials: CatalogMaterial[];
  /** The picture's camera, already scaled to the space. */
  fit: CameraFit;
  centre: [number, number];
  cut: { exteriorM: number; interiorM: number } | null;
  background: string | null;
  /** Longer edge in pixels. */
  edge?: number;
}

/** A JPEG data URL of the scene from the picture's camera; null when WebGL or the camera is unavailable. */
export async function offscreenSourceStill(req: StillRequest): Promise<string | null> {
  const edge = req.edge ?? 1280;
  const width = req.fit.aspect >= 1 ? edge : Math.round(edge * req.fit.aspect);
  const height = req.fit.aspect >= 1 ? Math.round(edge / req.fit.aspect) : edge;
  const pose = viewForCanvas(req.fit, width, height, req.centre);
  if (!pose) return null;
  const mount = document.createElement('div');
  mount.setAttribute('aria-hidden', 'true');
  mount.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;opacity:0`;
  document.body.appendChild(mount);
  let controller: SceneController | null = null;
  try {
    controller = new SceneController(mount, chooseQuality(readDeviceSignals()), { reducedMotion: true });
    controller.loadSpace(req.space);
    controller.applyDesign(req.state, new Map(req.assets.map((a) => [a.code, a])), new Map(req.materials.map((m) => [m.id, m])));
    await controller.generatedSettled();
    const blob = await controller.renderStill({ kind: 'SOURCE', pose, background: req.background, cut: req.cut }, width, height, 0.85);
    if (!blob) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  } finally {
    controller?.dispose();
    mount.remove();
  }
}

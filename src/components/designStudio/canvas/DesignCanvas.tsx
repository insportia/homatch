import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { chooseQuality, readDeviceSignals } from '@/lib/designStudio/quality';
import type { SpaceModel } from '@/lib/designStudio/space';
import { SceneController, type CameraSnapshot, type PickTarget } from './SceneController';

export interface DesignCanvasProps {
  space: SpaceModel | null;
  /** Loads a model for sources that are a model rather than generated geometry. */
  loadModel?: (controller: SceneController) => Promise<void>;
  selection: PickTarget | null;
  onPick: (target: PickTarget | null) => void;
  onReady?: (controller: SceneController) => void;
  onModelError?: () => void;
  /** Room names over the floor, following the camera. */
  roomLabel?: (roomId: string) => string;
  /** A catalogue piece dropped from the library at a screen point. */
  onDropAsset?: (code: string, point: { x: number; y: number } | null) => void;
  /** Direct manipulation: dragging a placed piece across the floor. */
  objectDrag?: {
    canDrag: (instanceId: string) => boolean;
    /** `free`: the override key is held — no snapping, still no invalid spot. */
    onMove: (instanceId: string, point: { x: number; y: number }, free: boolean) => { at: { x: number; y: number }; rotation: number; valid: boolean } | null;
    onDrop: (instanceId: string, point: { x: number; y: number }) => void;
    onCancel: (instanceId: string) => void;
  };
  /** Direct manipulation: turning a selected piece by its rotate handle. */
  objectRotate?: {
    canRotate: (instanceId: string) => boolean;
    pose: (instanceId: string) => { at: { x: number; y: number }; rotation: number } | null;
    onRotate: (instanceId: string, rotation: number, free: boolean) => { rotation: number; valid: boolean };
    onRotateEnd: (instanceId: string, rotation: number, valid: boolean) => void;
    onCancel: (instanceId: string) => void;
  };
  /** Where the camera should be once the space is built (same view across versions). */
  initialCamera?: CameraSnapshot | null;
  className?: string;
}

/**
 * The canvas: owns a SceneController for its lifetime, turns pointer input
 * into picks (a tap selects, a drag orbits), and draws room names over the
 * floor. Everything else — what is selected, what the design is — comes in
 * through props.
 */
export function DesignCanvas({
  space, loadModel, selection, onPick, onReady, onModelError, roomLabel, onDropAsset, objectDrag, objectRotate, initialCamera, className,
}: DesignCanvasProps) {
  const rotateRef = useRef(objectRotate);
  rotateRef.current = objectRotate;
  const initialCameraRef = useRef(initialCamera);
  const { t } = useLanguage();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [webglMissing, setWebglMissing] = useState(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const dragRef = useRef(objectDrag);
  dragRef.current = objectDrag;
  const onDropRef = useRef(onDropAsset);
  onDropRef.current = onDropAsset;

  // One controller per mount.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let controller: SceneController;
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('no webgl');
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      controller = new SceneController(mount, chooseQuality(readDeviceSignals()), { reducedMotion: reduced });
    } catch {
      setWebglMissing(true);
      return undefined;
    }
    controllerRef.current = controller;
    // The QA harness drives the scene directly; production builds drop this.
    if (import.meta.env.MODE === 'harness') (window as unknown as { __dsScene?: SceneController }).__dsScene = controller;

    /* A tap selects; a drag is the camera. Distinguished by distance and time. */
    let down: { x: number; y: number; t: number } | null = null;
    /* A press on a movable piece is a drag of that piece, not of the camera. */
    let dragging: { id: string; started: boolean } | null = null;
    /* A press on the rotate handle turns the piece. */
    let rotating: { id: string; startAngle: number; startRotation: number; centre: { x: number; y: number }; last: { rotation: number; valid: boolean } | null } | null = null;
    const el = controller.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (e.button !== 0) return;
      const hit = controller.pick(e.clientX, e.clientY);
      if (hit?.target.kind === 'handle' && rotateRef.current?.canRotate(hit.target.id)) {
        const pose = rotateRef.current.pose(hit.target.id);
        const p = controller.floorPoint(e.clientX, e.clientY);
        if (pose && p) {
          rotating = { id: hit.target.id, startAngle: Math.atan2(p.y - pose.at.y, p.x - pose.at.x), startRotation: pose.rotation, centre: pose.at, last: null };
          controller.setOrbitEnabled(false);
          el.setPointerCapture(e.pointerId);
          return;
        }
      }
      if (!dragRef.current) return;
      if (hit?.target.kind === 'object' && dragRef.current.canDrag(hit.target.id)) {
        dragging = { id: hit.target.id, started: false };
        controller.setOrbitEnabled(false);
        el.setPointerCapture(e.pointerId);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (rotating) {
        const r = rotating;
        rotating = null;
        controller.setOrbitEnabled(true);
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        // One turn, one step: the release commits, the preview frames do not.
        if (r.last) rotateRef.current?.onRotateEnd(r.id, r.last.rotation, r.last.valid);
        else rotateRef.current?.onCancel(r.id);
        return;
      }
      if (dragging) {
        const d = dragging;
        dragging = null;
        controller.setOrbitEnabled(true);
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        if (d.started) {
          const p = controller.floorPoint(e.clientX, e.clientY);
          if (p) dragRef.current?.onDrop(d.id, p);
          else dragRef.current?.onCancel(d.id);
          return;
        }
      }
      if (moved > 6 || !quick) return;
      const hit = controller.pick(e.clientX, e.clientY);
      onPickRef.current(hit?.target ?? null);
    };
    const onDragMove = (e: PointerEvent) => {
      if (rotating) {
        const p = controller.floorPoint(e.clientX, e.clientY);
        if (!p) return;
        const angle = Math.atan2(p.y - rotating.centre.y, p.x - rotating.centre.x);
        const res = rotateRef.current?.onRotate(rotating.id, rotating.startRotation + (angle - rotating.startAngle), e.altKey);
        if (res) {
          rotating.last = res;
          controller.previewObject(rotating.id, rotating.centre, res.rotation, res.valid);
        }
        return;
      }
      if (!dragging || !down) return;
      if (!dragging.started && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      if (!dragging.started) {
        dragging.started = true;
        onPickRef.current({ kind: 'object', id: dragging.id, roomId: null });
      }
      const p = controller.floorPoint(e.clientX, e.clientY);
      const preview = p ? dragRef.current?.onMove(dragging.id, p, e.altKey) : null;
      if (preview) controller.previewObject(dragging.id, preview.at, preview.rotation, preview.valid);
    };
    const onCancelDrag = () => {
      if (rotating) {
        controller.setOrbitEnabled(true);
        rotateRef.current?.onCancel(rotating.id);
        rotating = null;
        return;
      }
      if (!dragging) return;
      controller.setOrbitEnabled(true);
      dragRef.current?.onCancel(dragging.id);
      dragging = null;
    };
    el.addEventListener('pointermove', onDragMove);
    el.addEventListener('pointercancel', onCancelDrag);
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('application/x-homatch-asset')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDrop = (e: DragEvent) => {
      const code = e.dataTransfer?.getData('application/x-homatch-asset');
      if (!code) return;
      e.preventDefault();
      onDropRef.current?.(code, controller.floorPoint(e.clientX, e.clientY));
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    let hoverQueued = false;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || down || dragging || rotating || hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const hit = controller.pick(e.clientX, e.clientY);
        controller.setHover(hit?.target ?? null);
        el.style.cursor = hit?.target.kind === 'handle' ? 'ew-resize' : hit ? 'pointer' : 'grab';
      });
    };
    const onLeave = () => controller.setHover(null);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    onReady?.(controller);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointermove', onDragMove);
      el.removeEventListener('pointercancel', onCancelDrag);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The space (or model) this canvas shows.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (space) {
      controller.loadSpace(space);
      if (initialCameraRef.current) controller.restore(initialCameraRef.current, false);
    } else if (loadModel) {
      loadModel(controller)
        .then(() => { if (initialCameraRef.current) controller.restore(initialCameraRef.current, false); })
        .catch(() => onModelError?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, loadModel]);

  useEffect(() => {
    controllerRef.current?.setSelection(selection);
    const id = selection?.kind === 'object' ? selection.id : null;
    controllerRef.current?.showRotateHandle(id && rotateRef.current?.canRotate(id) ? id : null);
  }, [selection]);

  // Room labels, repositioned after every drawn frame.
  useEffect(() => {
    const controller = controllerRef.current;
    const layer = labelsRef.current;
    if (!controller || !layer || !space || !roomLabel) return undefined;
    layer.replaceChildren();
    const nodes = space.rooms.map((room) => {
      const node = document.createElement('span');
      node.className = 'ds-room-label pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-md bg-white/90 '
        + 'px-2 py-0.5 text-[13px] font-medium text-[#0C1119] shadow-sm ring-1 ring-black/5';
      node.textContent = roomLabel(room.id);
      layer.appendChild(node);
      return { room, node };
    });
    const place = () => {
      for (const { room, node } of nodes) {
        const p = controller.project(room.centroid, 0.05);
        if (!p) { node.style.display = 'none'; continue; }
        node.style.display = '';
        node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      }
    };
    place();
    const off = controller.onFrame(place);
    return () => { off(); layer.replaceChildren(); };
  }, [space, roomLabel]);

  return (
    <div className={className ?? 'relative h-full w-full'}>
      <div
        ref={mountRef}
        className="absolute inset-0"
        role="application"
        aria-label={t('ds_canvas_label')}
        aria-roledescription={t('ds_canvas_role')}
      />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />
      {webglMissing ? (
        <div className="absolute inset-0 grid place-items-center bg-[#E9EBEE] px-6 text-center">
          <p className="max-w-sm text-[15px] text-[#0C1119]">{t('ds_webgl_missing')}</p>
        </div>
      ) : null}
    </div>
  );
}

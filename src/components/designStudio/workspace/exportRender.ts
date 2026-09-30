// Rendering the downloadable files: the stills (from the real renderer and
// the Camera Director) and the presentation pages (drawn in the browser, so
// every language renders with real fonts, right-to-left where it should).

import type { CatalogAsset } from '@/lib/designStudio/catalog';
import { roomGraph, roomShot, tourOrder } from '@/lib/designStudio/cameraDirector';
import type { DesignState } from '@/lib/designStudio/designState';
import type { DesignSummary } from '@/lib/designStudio/designSummary';
import { buildWalkModel } from '@/lib/designStudio/navigation';
import type { SpaceModel } from '@/lib/designStudio/space';
import type { SceneController } from '../canvas/SceneController';

export const STILL_W = 2560;
export const STILL_H = 1440;

export interface Still { key: string; roomId: string | null; blob: Blob }

/** The overview, the plan from above, and every room from eye level, in tour order. */
export async function renderStills(
  controller: SceneController, space: SpaceModel, state: DesignState, assets: Map<string, CatalogAsset>,
  onProgress?: (done: number, total: number) => void,
): Promise<Still[]> {
  const walk = buildWalkModel(space, state.objects, assets);
  const order = tourOrder(space, roomGraph(space));
  const total = 2 + order.length;
  const out: Still[] = [];
  const add = async (key: string, roomId: string | null, view: Parameters<SceneController['renderStill']>[0]) => {
    const blob = await controller.renderStill(view, STILL_W, STILL_H);
    if (blob) out.push({ key, roomId, blob });
    onProgress?.(out.length, total);
    // Let the page breathe between frames.
    await new Promise((r) => setTimeout(r, 0));
  };
  await add('overview', null, { kind: 'OVERVIEW' });
  await add('plan', null, { kind: 'TOP' });
  for (const roomId of order) {
    const pose = roomShot(space, walk, roomId, STILL_W / STILL_H) ?? null;
    if (pose) await add(`room-${roomId}`, roomId, { kind: 'EYE', pose });
  }
  return out;
}

export interface PageText {
  brand: string;
  title: string;
  subtitle: string;
  note: string;
  truth: string;
  palette: string;
  walls: string;
  floor: string;
  furniture: string;
  none: string;
  plan: string;
  pieces: string;
  roomName: (roomId: string) => string;
  area: (m2: number) => string;
}

const PAGE_W = 1754;
const PAGE_H = 1240;
const GOLD = '#9a6a12';
const INK = '#0C1119';
const MUTED = '#4A5263';

async function bitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  return img;
}

function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap | HTMLImageElement, x: number, y: number, w: number, h: number) {
  const iw = img.width; const ih = img.height;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s; const sh = h / s;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect?.(x, y, w, h, 18);
  ctx.clip();
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

/** Text that wraps within `width`, returning the y after the last line. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines = 6): number {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = w;
      lines += 1;
      if (lines >= maxLines) return y;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineHeight; }
  return y;
}

function swatch(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, size = 36) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect?.(x, y, size, size, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** The presentation, one JPEG per page: cover, one page per room, the plan. */
export async function renderPages(stills: Still[], summary: DesignSummary, text: PageText, rtl: boolean): Promise<Blob[]> {
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const pages: Blob[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  const M = 96;
  const start = rtl ? PAGE_W - M : M;
  const setText = (size: number, weight: number, color: string) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  };
  const begin = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); };
  const footer = (n: number) => {
    setText(20, 500, MUTED);
    ctx.fillText(`${text.brand} · ${text.title}`, start, PAGE_H - 48);
    ctx.textAlign = 'end';
    ctx.fillText(String(n), rtl ? M : PAGE_W - M, PAGE_H - 48);
  };
  const finish = async () => {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.9));
    if (blob) pages.push(blob);
  };

  // Cover.
  const overview = stills.find((s) => s.key === 'overview');
  begin();
  setText(22, 700, GOLD);
  ctx.fillText(text.brand.toUpperCase(), start, M + 10);
  setText(64, 700, INK);
  let y = wrap(ctx, text.title, start, M + 96, PAGE_W - 2 * M, 72, 2);
  setText(28, 500, MUTED);
  y = wrap(ctx, text.subtitle, start, y + 4, PAGE_W - 2 * M, 36, 2);
  if (overview) cover(ctx, await bitmap(overview.blob), M, y + 16, PAGE_W - 2 * M, PAGE_H - y - 16 - 190);
  setText(22, 600, INK);
  ctx.fillText(text.palette, start, PAGE_H - 132);
  summary.palette.slice(0, 8).forEach((c, i) => swatch(ctx, c, rtl ? PAGE_W - M - 40 - i * 48 - 200 : M + 200 + i * 48, PAGE_H - 160));
  setText(20, 400, MUTED);
  wrap(ctx, `${text.truth} ${text.note}`, start, PAGE_H - 90, PAGE_W - 2 * M, 26, 1);
  await finish();

  // One page per room with a render.
  let n = 2;
  for (const still of stills.filter((s) => s.roomId)) {
    const room = summary.rooms.find((r) => r.roomId === still.roomId);
    if (!room) continue;
    begin();
    const imgW = 1100;
    const imgX = rtl ? PAGE_W - M - imgW : M;
    cover(ctx, await bitmap(still.blob), imgX, M, imgW, PAGE_H - 2 * M - 40);
    const colX = rtl ? imgX - 48 : imgX + imgW + 48;
    const colW = PAGE_W - M - imgW - 48 - M;
    setText(44, 700, INK);
    let cy = wrap(ctx, text.roomName(room.roomId), colX, M + 44, colW, 52, 2);
    setText(26, 500, MUTED);
    ctx.fillText(text.area(room.areaM2), colX, cy + 4);
    cy += 70;
    const finishLine = (label: string, f: typeof room.walls) => {
      setText(20, 700, GOLD);
      ctx.fillText(label.toUpperCase(), colX, cy);
      cy += 40;
      if (f?.color) swatch(ctx, f.color, rtl ? colX - 36 : colX, cy - 28, 32);
      setText(24, 500, INK);
      ctx.fillText(f ? (f.materialName ?? f.color ?? '') : text.none, rtl ? colX - (f?.color ? 48 : 0) : colX + (f?.color ? 48 : 0), cy);
      cy += 56;
    };
    finishLine(text.walls, room.walls);
    finishLine(text.floor, room.floor);
    setText(20, 700, GOLD);
    ctx.fillText(text.furniture.toUpperCase(), colX, cy);
    cy += 40;
    setText(24, 500, INK);
    if (!room.furniture.length) { ctx.fillText(text.none, colX, cy); cy += 36; }
    for (const f of room.furniture.slice(0, 12)) {
      ctx.fillText(f.count > 1 ? `${f.name} × ${f.count}` : f.name, colX, cy);
      cy += 36;
    }
    footer(n);
    n += 1;
    await finish();
  }

  // The plan from above.
  const plan = stills.find((s) => s.key === 'plan');
  if (plan) {
    begin();
    setText(44, 700, INK);
    ctx.fillText(text.plan, start, M + 30);
    setText(26, 500, MUTED);
    ctx.fillText(text.pieces, start, M + 76);
    cover(ctx, await bitmap(plan.blob), M, M + 110, PAGE_W - 2 * M, PAGE_H - 2 * M - 160);
    footer(n);
    await finish();
  }
  return pages;
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

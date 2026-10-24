// EMAIL STUDIO — image edits done in the browser BEFORE upload: crop, and the video play mark.
//
// Both work on the author's own file (a canvas cannot read an image already served from storage,
// which sends no CORS headers), and both produce a new file that goes through the normal upload
// (prepareImage → asset_upload → R2). The play mark is drawn INTO the thumbnail, so every mail
// client shows it: email has no reliable overlay or inline video.

export interface CropRect { x: number; y: number; w: number; h: number } /* fractions of the image, 0..1 */

async function bitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function toFile(canvas: HTMLCanvasElement, name: string, type: string): Promise<File> {
  const out = type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(new File([b], name.replace(/\.[a-z0-9]+$/i, out === 'image/png' ? '.png' : '.jpg'), { type: out })) : reject(new Error('ENCODE_FAILED'))), out, 0.9));
}

/** The image's natural size (for the crop dialog's aspect maths). */
export async function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  const b = await bitmap(file);
  const s = { width: b.width, height: b.height };
  b.close();
  return s;
}

export async function cropImage(file: File, r: CropRect): Promise<File> {
  const b = await bitmap(file);
  const sx = Math.round(r.x * b.width), sy = Math.round(r.y * b.height);
  const sw = Math.max(1, Math.round(r.w * b.width)), sh = Math.max(1, Math.round(r.h * b.height));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d')!.drawImage(b, sx, sy, sw, sh, 0, 0, sw, sh);
  b.close();
  return toFile(c, file.name, file.type);
}

/** A centred play button (dark disc, white triangle) drawn into the thumbnail. */
export async function addPlayMark(file: File): Promise<File> {
  const b = await bitmap(file);
  const c = document.createElement('canvas');
  c.width = b.width; c.height = b.height;
  const g = c.getContext('2d')!;
  g.drawImage(b, 0, 0);
  b.close();
  const r = Math.max(18, Math.round(Math.min(c.width, c.height) * 0.11));
  const cx = c.width / 2, cy = c.height / 2;
  g.fillStyle = 'rgba(12, 17, 25, 0.62)';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(2, r * 0.08); g.strokeStyle = 'rgba(255, 255, 255, 0.9)'; g.stroke();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.moveTo(cx - r * 0.32, cy - r * 0.45); g.lineTo(cx + r * 0.5, cy); g.lineTo(cx - r * 0.32, cy + r * 0.45);
  g.closePath(); g.fill();
  return toFile(c, file.name, 'image/jpeg');
}

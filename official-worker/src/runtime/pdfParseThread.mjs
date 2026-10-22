// Worker thread: PDF text extraction off the main event loop (AI TALK speech relays frames there).
import { parentPort } from 'node:worker_threads';
import { Buffer } from 'node:buffer';
import { parseIn } from './pdfParseCore.mjs';

parentPort.on('message', async ({ id, mode, bytes }) => {
  try {
    parentPort.postMessage({ id, ok: true, result: await parseIn(mode, Buffer.from(bytes)) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
});

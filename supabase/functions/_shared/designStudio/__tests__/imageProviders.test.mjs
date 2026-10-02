// The image providers' requests (field names are the contract with each
// provider), their usage → cost arithmetic, unknown prices kept unknown, and
// keys that never leave the request headers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  costOf, DEFAULT_MODEL, geminiAspect, geminiProvider, geminiRequest, geminiUsage, openAiEditRequest, openAiMaskRgba, openAiProvider,
  openAiSize, openAiUsage, PRICE_TABLE, priceTable, selectProvider, whiteMaskRgba,
} from '../imageProviders.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (u8) => Buffer.from(u8).toString('base64');
const KEY = 'sk-test-SECRET-never-returned';

function mockFetch(answer) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  return { f, calls };
}
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const depsOf = (fetchFn, env = {}) => ({ fetch: fetchFn, env: (k) => env[k], encodePng: (rgba, w, h) => Uint8Array.from([0x89, 0x50, w, h, rgba.length & 255]) });

test('OpenAI size: the picture\'s own aspect, multiples of 16, within the documented pixel bounds', () => {
  for (const [w, h] of [[1536, 1024], [1280, 720], [800, 600], [4000, 3000], [3000, 900], [512, 512]]) {
    const [W, H] = openAiSize({ width: w, height: h }).split('x').map(Number);
    assert.equal(W % 16, 0); assert.equal(H % 16, 0);
    assert.ok(W * H >= 655_360 && W * H <= 8_294_400, `${W}x${H} in bounds`);
    assert.ok(W <= 3840 && H <= 3840);
    assert.ok(Math.abs(W / H - Math.min(3, Math.max(1 / 3, w / h))) / (w / h) < 0.03, `${w}x${h} → ${W}x${H} keeps aspect`);
  }
  assert.equal(openAiSize({ width: 1536, height: 1024 }), '1536x1024');
});

test('Gemini aspect: the nearest documented ratio', () => {
  assert.equal(geminiAspect({ width: 1536, height: 1024 }), '3:2');
  assert.equal(geminiAspect({ width: 1920, height: 1080 }), '16:9');
  assert.equal(geminiAspect({ width: 1000, height: 1000 }), '1:1');
  assert.equal(geminiAspect({ width: 768, height: 1024 }), '3:4');
});

test('masks: OpenAI transparent where editable; the contract\'s white where editable', () => {
  const m = { width: 2, height: 1, data: Uint8Array.from([1, 0]) };
  assert.deepEqual([...openAiMaskRgba(m)], [0, 0, 0, 0, 0, 0, 0, 255]);
  assert.deepEqual([...whiteMaskRgba(m)], [255, 255, 255, 255, 0, 0, 0, 255]);
});

test('OpenAI edit request: the documented multipart fields', async () => {
  const form = openAiEditRequest({ model: 'gpt-image-2', prompt: 'p', image: { bytes: PNG, mime: 'image/png' }, maskPng: PNG, size: { width: 1536, height: 1024 }, quality: 'high' });
  assert.deepEqual([...form.keys()], ['model', 'prompt', 'image', 'mask', 'size', 'quality', 'output_format', 'n']);
  assert.equal(form.get('size'), '1536x1024');
  assert.equal(form.get('output_format'), 'png');
  assert.equal(form.get('image').type, 'image/png');
  const finish = openAiEditRequest({ model: 'gpt-image-2', prompt: 'p', image: { bytes: PNG, mime: 'image/png' }, maskPng: null, size: { width: 1536, height: 1024 }, quality: 'high' });
  assert.equal(finish.has('mask'), false, 'a finish edits the whole picture');
});

test('OpenAI: bytes, usage and a measured cost; the key only in the Authorization header', async () => {
  const { f, calls } = mockFetch(() => reply(200, {
    data: [{ b64_json: b64(PNG) }],
    usage: { input_tokens: 1500, input_tokens_details: { text_tokens: 300, image_tokens: 1200 }, output_tokens: 5500 },
  }, { 'x-request-id': 'req_1' }));
  const p = openAiProvider('gpt-image-2', depsOf(f, { OPENAI_API_KEY: KEY }));
  const r = await p.edit({ image: { bytes: PNG, mime: 'image/png' }, mask: { width: 2, height: 2, data: new Uint8Array(4) }, prompt: 'repaint', size: { width: 1536, height: 1024 } });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(calls[0].init.body.has('mask'));
  assert.deepEqual([...r.bytes], [...PNG]);
  assert.equal(r.mime, 'image/png');
  assert.equal(r.requestId, 'req_1');
  // 300×5 + 1200×8 + 5500×30 per 1M = 0.0015 + 0.0096 + 0.165
  assert.equal(r.cost.basis, 'ESTIMATED');
  assert.equal(r.cost.usd, 0.1761);
  assert.ok(!JSON.stringify(r).includes(KEY), 'the key is never in the result');
});

test('OpenAI: a refusal is an error code (never a picture), and no key means not configured', async () => {
  const { f } = mockFetch(() => reply(400, { error: { message: 'bad mask' } }));
  const r = await openAiProvider('gpt-image-2', depsOf(f, { OPENAI_API_KEY: KEY })).finish({ base: { bytes: PNG, mime: 'image/png' }, prompt: 'x', size: { width: 1024, height: 1024 } });
  assert.deepEqual([r.ok, r.error, r.cost.usd], [false, 'PROVIDER_REFUSED_400', null]);
  const { f: f2, calls } = mockFetch(() => reply(200, {}));
  const r2 = await openAiProvider('gpt-image-2', depsOf(f2, {})).finish({ base: { bytes: PNG, mime: 'image/png' }, prompt: 'x', size: { width: 1024, height: 1024 } });
  assert.deepEqual([r2.ok, r2.error, calls.length], [false, 'PROVIDER_NOT_CONFIGURED', 0]);
});

test('Gemini request: generateContent parts, IMAGE modality, aspect and size; the mask as a second image with its instruction', () => {
  const body = geminiRequest({ prompt: 'repaint', image: { bytes: PNG, mime: 'image/png' }, maskPng: PNG, size: { width: 1536, height: 1024 }, imageSize: '2K' });
  const parts = body.contents[0].parts;
  assert.equal(parts.length, 3);
  assert.match(parts[0].text, /SECOND image is a mask/);
  assert.deepEqual(parts[1].inlineData, { mimeType: 'image/png', data: b64(PNG) });
  assert.deepEqual(body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } });
  const finish = geminiRequest({ prompt: 'finish', image: { bytes: PNG, mime: 'image/png' }, maskPng: null, size: { width: 1, height: 1 }, imageSize: '2K' });
  assert.equal(finish.contents[0].parts.length, 2);
});

test('Gemini: endpoint, key header, inline image answer and the modality-split cost', async () => {
  const { f, calls } = mockFetch(() => reply(200, {
    candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: b64(PNG) } }] } }],
    usageMetadata: { promptTokenCount: 1300, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 300 }, { modality: 'IMAGE', tokenCount: 1000 }],
      candidatesTokenCount: 1130, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'TEXT', tokenCount: 10 }] },
  }));
  const p = geminiProvider('gemini-3-pro-image', depsOf(f, { GEMINI_API_KEY: KEY }));
  const r = await p.finish({ base: { bytes: PNG, mime: 'image/png' }, prompt: 'finish', size: { width: 1536, height: 1024 } });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent');
  assert.equal(calls[0].init.headers['x-goog-api-key'], KEY);
  assert.ok(!calls[0].url.includes(KEY), 'never in the URL');
  // 300×2 + 1000×2 + 1120×120 + 10×12 per 1M
  assert.equal(r.cost.usd, Math.round((600 + 2000 + 134400 + 120) / 1e6 * 1e6) / 1e6);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('unknown prices stay unknown: an unpriced model, missing usage, a missing rate', () => {
  const usage = { inputTextTokens: 10, inputImageTokens: null, cachedInputTokens: null, outputImageTokens: 100, outputTextTokens: null };
  assert.deepEqual(costOf('gemini-3.1-flash-lite-image', usage, PRICE_TABLE).usd, null);
  assert.equal(costOf('gemini-3.1-flash-lite-image', usage, PRICE_TABLE).basis, 'UNPRICED');
  assert.equal(costOf('gpt-image-2', null, PRICE_TABLE).basis, 'UNPRICED');
  assert.equal(costOf('gpt-image-2', { ...usage, outputTextTokens: 5 }, PRICE_TABLE).basis, 'UNPRICED', 'gpt-image has no text-out rate');
  assert.equal(openAiUsage({}), null);
  assert.equal(geminiUsage({}), null);
});

test('prices can be overridden by DS_RENDER_PRICES; a malformed override is ignored whole', () => {
  const t = priceTable((k) => (k === 'DS_RENDER_PRICES' ? JSON.stringify({ 'gemini-3.1-flash-lite-image': { textIn: 0.1, imageIn: 0.1, imageOut: 20 } }) : undefined));
  assert.equal(t['gemini-3.1-flash-lite-image'].imageOut, 20);
  assert.equal(t['gpt-image-2'].imageOut, 30);
  assert.deepEqual(priceTable((k) => (k === 'DS_RENDER_PRICES' ? '{nope' : undefined)), { ...PRICE_TABLE });
});

test('selection: env choice, safe default, admin override validated, no key → none', () => {
  const f = async () => reply(200, {});
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY })).model, DEFAULT_MODEL.OPENAI);
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY, DS_RENDER_MODEL: 'gpt-image-2.5-flare' })).model, 'gpt-image-2.5-flare');
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY, DS_RENDER_MODEL: 'dall-e-9' })).model, 'gpt-image-2', 'an unknown model falls back');
  // OpenAI only: no environment, setting or override can select Gemini for a customer job.
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY, GEMINI_API_KEY: KEY, DS_RENDER_PROVIDER: 'gemini' })).id, 'OPENAI');
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY, GEMINI_API_KEY: KEY }), { provider: 'GEMINI', model: 'gemini-3.1-flash-image' }).id, 'OPENAI');
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY, GEMINI_API_KEY: KEY }), null, { provider: 'GEMINI', model: 'gemini-3-pro-image' }).id, 'OPENAI');
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY }), null, { provider: 'GEMINI', model: 'gemini-3-pro-image' }).model, 'gpt-image-2', 'a Gemini model name never leaks into the OpenAI call');
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY }), { model: 'gpt-image-2.5-sunburst' }).model, 'gpt-image-2.5-sunburst', 'the OpenAI model stays configurable');
  assert.equal(selectProvider(depsOf(f, { OPENAI_API_KEY: KEY }), null, { model: 'gpt-image-2.5-flare' }).model, 'gpt-image-2.5-flare');
  assert.equal(selectProvider(depsOf(f, { GEMINI_API_KEY: KEY })), null, 'no OpenAI key: no render, never a fallback to Gemini');
  assert.equal(selectProvider(depsOf(f, {})), null);
});

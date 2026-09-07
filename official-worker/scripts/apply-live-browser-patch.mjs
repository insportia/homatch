import fs from 'node:fs';

function patch(path, edits) {
  let s = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of edits) {
    if (!s.includes(from)) throw new Error(`Patch anchor missing: ${label} in ${path}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(path, s);
  console.log(`patched ${path}`);
}

patch('src/browser/BrowserSession.ts', [[
  "      '[class*=\"captcha\" i]',\n      '[id*=\"captcha\" i]',",
  "      '[class*=\"captcha\" i]',\n      '[id*=\"captcha\" i]',\n      '#capture_gate',\n      'img[src*=\"icaptcha.php\" i]',",
  'ENREG image CAPTCHA selectors'
]]);

patch('src/orchestrator/ResearchOrchestrator.ts', [
  ["const TTL = 15 * 60 * 1000;","const TTL = 30 * 60 * 1000;\n\nasync function connectResearchBrowser(): Promise<any> {\n  const bridgeUrl = process.env.BROWSERLESS_TOKEN_BRIDGE_URL || '';\n  const bridgeKey = process.env.BROWSERLESS_TOKEN_BRIDGE_KEY || '';\n  if (!bridgeUrl || !bridgeKey) throw new Error('remote browser bridge is not configured');\n  const r = await fetch(bridgeUrl, { method: 'POST', headers: { Authorization: `Bearer ${bridgeKey}` }, signal: AbortSignal.timeout(10000) });\n  if (!r.ok) throw new Error(`remote browser bridge unavailable (${r.status})`);\n  const body = await r.json() as any;\n  const token = String(body?.token || '').trim();\n  if (!token) throw new Error('remote browser credential unavailable');\n  const endpoint = `wss://production-sfo.browserless.io/chromium/stealth?token=${encodeURIComponent(token)}`;\n  return chromium.connectOverCDP(endpoint, { timeout: 30000 });\n}",'Browserless connector helper'],
  ["browser = browser || (await chromium.launch({ headless: false, args: ['--disable-dev-shm-usage', '--no-sandbox'] }));","browser = browser || (await connectResearchBrowser());",'remote browser launch'],
  ["const ctx = await browser.newContext({ locale: 'ka-GE', acceptDownloads: true, viewport: { width: 1440, height: 1000 } });\n    const page = await ctx.newPage();","const ctx = browser.contexts()[0] || (await browser.newContext({ locale: 'ka-GE', acceptDownloads: true, viewport: { width: 1440, height: 1000 } }));\n    const stalePages = ctx.pages();\n    for (const oldPage of stalePages) await oldPage.close().catch(() => {});\n    const page = await ctx.newPage();\n    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});",'Browserless default context'],
  ["await ctx.close().catch(() => {});\n      return { result, keep: false };","for (const p of ctx.pages()) await p.close().catch(() => {});\n      return { result, keep: false };",'keep remote default context alive between source steps'],
  ["await ctx.close().catch(() => {});\n      return {\n        result:","for (const p of ctx.pages()) await p.close().catch(() => {});\n      return {\n        result:",'keep remote context on workflow exception'],
  ["await session.ctx.close().catch(() => {});\n    this.sessions.delete(jobId);","for (const p of session.ctx.pages()) await p.close().catch(() => {});\n    this.sessions.delete(jobId);",'resume cleanup without killing Browserless context'],
  ["await session.ctx.close().catch(() => {});\n    const browser = session.browser;","for (const p of session.ctx.pages()) await p.close().catch(() => {});\n    const browser = session.browser;",'skip cleanup without killing Browserless context']
]);

patch('src/index.ts', [
  ["    humanSessionControls: true,","    humanSessionControls: true,\n    liveInteractiveBrowser: true,\n    browserRuntime: 'browserless-cdp',",'health capability flags'],
  ["app.get('/research/:id/screenshot', auth, async (req: any, res: any) => {","app.post('/research/:id/live', auth, async (req: any, res: any) => {\n  const s = orchestrator.getSession(req.params.id);\n  if (!s) return res.status(404).json({ error: 'active human session not found' });\n  try {\n    const cdp = await s.ctx.newCDPSession(s.page);\n    const out: any = await cdp.send('Browserless.liveURL', { interactable: true, resizable: true, showBrowserInterface: false, quality: 70, type: 'jpeg', timeout: 900000 });\n    await cdp.detach().catch(() => {});\n    if (out?.error || !out?.liveURL) { console.error(`[live ${req.params.id}] ${String(out?.error || 'missing liveURL')}`); return res.status(503).json({ error: 'could not open the live verification browser right now — try again' }); }\n    s.expires = Date.now() + 30 * 60 * 1000;\n    return res.json({ liveURL: out.liveURL, expiresAt: new Date(s.expires).toISOString(), source: s.step.type === 'entity' ? s.step.source : s.step.key });\n  } catch (e) { console.error(`[live ${req.params.id}] ${String(e)}`); return res.status(500).json({ error: 'could not open the live verification browser right now — try again' }); }\n});\n\napp.get('/research/:id/screenshot', auth, async (req: any, res: any) => {",'live browser endpoint']
]);

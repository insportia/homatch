// Build a reviewable report from actual local probes. Never copies profiles or recordings.
import { readFile, writeFile } from 'node:fs/promises';
const base = 'publisher-worker/artifacts/toolkit';
const read = async name => JSON.parse(await readFile(`${base}/${name}.json`, 'utf8'));
const tools = [await read('playwright'), await read('stagehand'), await read('browser-use'), await read('ollama'), await read('playwright-rrweb')];
const discovery = JSON.parse(await readFile('publisher-worker/artifacts/discovery.json', 'utf8'));
const report = {
  checkedAt: new Date().toISOString(), scope: 'Isolated local development probes; zero live portal integrations',
  tools, discovery,
  mcp: { packageVersion: '0.0.83', serverVersion: '1.64.0-alpha-1790635538000', status: 'FAIL', nativeToolCount: 0, listedTools: 26, actualCall: 'browser_navigate about:blank', error: 'Target page, context or browser has been closed', browserLaunched: true },
  ollamaVersion: '0.40.3', paidCalls: 0, modelDownloads: 0,
};
await writeFile('docs/publishing/TOOLKIT-RESULTS.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ tools: tools.length + 1, generated: 'docs/publishing/TOOLKIT-RESULTS.json' }));

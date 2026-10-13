// Diagnostic client for the already-installed local Playwright MCP. No npm download.
// Starts an isolated browser, optionally navigates once, and always closes the server.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const domain = process.argv[2];
if (domain && !['myhome.ge', 'ss.ge'].includes(domain))
  throw new Error('UNKNOWN_PROBE_TARGET');
const toolkit = process.env.HOMATCH_AUTOMATION_ROOT || 'C:/HOMATCH-Automation';
const child = spawn(
  process.execPath,
  [
    resolve(toolkit, 'node_modules/@playwright/mcp/cli.js'),
    '--headless',
    '--isolated',
    '--browser',
    'chrome',
    '--block-service-workers',
    '--timeout-navigation',
    '20000',
    '--output-dir',
    resolve('publisher-worker/artifacts/mcp'),
  ],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);
const pending = new Map();
let id = 0;
let buffer = '';
child.stderr.on('data', () => {}); // Never relay arbitrary browser/server diagnostics.
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const at = buffer.indexOf('\n');
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    try {
      const message = JSON.parse(line);
      if (message.method && message.id != null) {
        child.stdin.write(
          JSON.stringify(
            message.method === 'roots/list'
              ? {
                  jsonrpc: '2.0',
                  id: message.id,
                  result: {
                    roots: [
                      {
                        uri: pathToFileURL(process.cwd()).href,
                        name: 'homatch',
                      },
                    ],
                  },
                }
              : {
                  jsonrpc: '2.0',
                  id: message.id,
                  error: {
                    code: -32601,
                    message: 'Unsupported client request',
                  },
                },
          ) + '\n',
        );
        continue;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        message.error
          ? waiter.reject(new Error('MCP_PROTOCOL_ERROR'))
          : waiter.resolve(message.result);
      }
    } catch {}
  }
});
child.on('error', () => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('MCP_START_FAILED'));
  }
  pending.clear();
});
child.on('exit', () => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('MCP_EXITED'));
  }
  pending.clear();
});
function request(method, params = {}) {
  return new Promise((resolveResult, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('MCP_TIMEOUT'));
    }, 30_000);
    pending.set(requestId, { resolve: resolveResult, reject, timer });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n',
    );
  });
}
try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { roots: { listChanged: false } },
    clientInfo: { name: 'homatch-readonly-probe', version: '1' },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
      '\n',
  );
  const listed = await request('tools/list');
  console.log(
    JSON.stringify({
      server: init.serverInfo,
      tools: listed.tools.map((tool) => tool.name),
    }),
  );
  if (domain) {
    const result = await request('tools/call', {
      name: 'browser_navigate',
      arguments: { url: `https://${domain}` },
    });
    const output = JSON.stringify(result);
    console.log(
      JSON.stringify({
        domain,
        isError: Boolean(result.isError),
        networkDenied: output.includes('ERR_NETWORK_ACCESS_DENIED'),
        result: output.includes('ERR_NETWORK_ACCESS_DENIED')
          ? 'ENVIRONMENT_NETWORK_DENIED'
          : result,
      }),
    );
  }
} finally {
  try {
    await request('tools/call', { name: 'browser_close', arguments: {} });
  } catch {}
  child.stdin.end();
  child.kill();
}

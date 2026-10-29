// NO-MODEL GUARD — a runtime refusal of language-model requests.
//
// Find Property's search path makes zero AI calls (owner, 2026-10-29). The source-graph
// test (tests/matrix/findPropertyZeroAi.test.mjs) proves no module on the path calls a
// model; this guard is the runtime half. A function that installs it wraps the isolate's
// fetch so a request to a model provider is refused before it leaves the process, counted,
// and logged as `model_call_blocked` (function_logs), whatever code path made it: a future
// import, a fallback, an error branch.
//
// It never touches any other request.

const MODEL_HOSTS = [
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.mistral.ai',
  'api.groq.com', 'openrouter.ai', 'api.cohere.ai', 'api.cohere.com', 'api.together.xyz', 'api.deepseek.com',
];

const state = { count: 0, functionName: null as string | null };

/** True for a URL on a model provider's API host (or a subdomain of one). */
export function isModelEndpoint(url: string): boolean {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return MODEL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** How many model requests this isolate refused. */
export const modelCallsBlocked = () => ({ count: state.count, functionName: state.functionName });

/** Install once per isolate; later calls are no-ops. */
export function installNoModelGuard(functionName: string): void {
  const g = globalThis as unknown as { fetch: typeof fetch; __homatchNoModelGuard?: string };
  if (g.__homatchNoModelGuard) return;
  g.__homatchNoModelGuard = functionName;
  state.functionName = functionName;
  const original = g.fetch.bind(globalThis);
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (isModelEndpoint(url)) {
      state.count += 1;
      console.error(JSON.stringify({ event: 'model_call_blocked', function: functionName, host: new URL(url).hostname, blocked: state.count }));
      return Promise.reject(new Error('MODEL_CALL_BLOCKED'));
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}

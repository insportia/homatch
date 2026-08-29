import ky, { type AfterResponseHook } from 'ky';
import { createParser } from 'eventsource-parser';

export interface SSEOptions {
  onData: (data: string) => void;
  onEvent?: (event: unknown) => void;
  onCompleted?: (error?: Error) => void;
  onAborted?: () => void;
}

export function createSSEHook(options: SSEOptions): AfterResponseHook {
  return async (request, _opts, response) => {
    if (!response.ok) return;

    let done = false;
    const finish = (err?: Error) => {
      if (!done) { done = true; options.onCompleted?.(err); }
    };

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const payload = await response.clone().json() as { text?: string };
        if (payload?.text) {
          options.onData(JSON.stringify({
            candidates: [{ content: { parts: [{ text: payload.text }] } }],
          }));
        }
        finish();
      } catch (err) {
        finish(err as Error);
      }
      return response;
    }

    if (!response.body) { finish(); return response; }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf8');
    const parser = createParser({
      onEvent: (event) => {
        if (!event.data) return;
        options.onEvent?.(event);
        for (const chunk of event.data.split('\n')) options.onData(chunk);
      },
    });

    const read = (): void => {
      reader.read().then(({ done: streamDone, value }) => {
        if (streamDone) { finish(); return; }
        parser.feed(decoder.decode(value, { stream: true }));
        read();
      }).catch((err) => {
        if (request.signal.aborted) { options.onAborted?.(); return; }
        finish(err as Error);
      });
    };
    read();
    return response;
  };
}

export interface StreamRequestOptions {
  functionUrl: string;
  requestBody: unknown;
  supabaseAnonKey: string;
  accessToken?: string;
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function sendStreamRequest(options: StreamRequestOptions): Promise<void> {
  const { functionUrl, requestBody, supabaseAnonKey, accessToken, onData, onComplete, onError, signal } = options;

  const sseHook = createSSEHook({
    onData,
    onCompleted: (err) => (err ? onError(err) : onComplete()),
    onAborted: () => console.log('Stream aborted'),
  });

  try {
    await ky.post(functionUrl, {
      json: requestBody,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      timeout: 90_000,
      signal,
      hooks: { afterResponse: [sseHook] },
    });
  } catch (err) {
    if (!signal?.aborted) onError(err as Error);
  }
}

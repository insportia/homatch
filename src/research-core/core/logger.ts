// HOMATCH RESEARCH CORE — diagnostics.
//
// No `process`, no `Deno`, no environment read. The core cannot know which
// runtime it is inside, and a module that reaches for `process.env` at import
// time fails to load in an Edge Function — which is the one place this code
// most needs to work.
//
// So the sink is injected and defaults to silence. A host that wants logs
// passes one in. Silence-by-default is also the right posture for a module
// that handles URLs: a log line is the easiest place for a query-string token
// to escape, and `redact` below is the only thing that should ever print one.

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export interface Logger {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export type LogSink = (line: string) => void;

export const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  child: () => silentLogger,
};

function format(
  scope: string,
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): string {
  const base = `[${level}] ${scope ? `${scope} ` : ''}${message}`;
  if (!fields || Object.keys(fields).length === 0) return base;
  let encoded: string;
  try {
    encoded = JSON.stringify(fields);
  } catch {
    encoded = '{"fields":"unserializable"}';
  }
  return `${base} ${encoded}`;
}

export function createLogger(
  scope = '',
  options: { level?: LogLevel; sink?: LogSink } = {},
): Logger {
  const level: LogLevel = options.level ?? 'silent';
  const sink = options.sink;
  const threshold = ORDER[level];

  const emit = (lvl: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (!sink || ORDER[lvl] > threshold) return;
    sink(format(scope, lvl, message, fields));
  };

  return {
    error: (m, f) => emit('error', m, f),
    warn: (m, f) => emit('warn', m, f),
    info: (m, f) => emit('info', m, f),
    debug: (m, f) => emit('debug', m, f),
    child: (childScope: string) =>
      createLogger(scope ? `${scope}:${childScope}` : childScope, options),
  };
}

// dwr.ts — Direct Web Remoting (DWR 2/3 "plaincall") request serialisation
// and a COMPLETE response object-graph evaluator for TAS's public
// docs.tbilisi.gov.ge application.
//
// WHY A REAL PARSER, NOT REGEXES
//
// A DWR reply is a small JavaScript program: it declares variables
// (`var s0={};`), assigns properties onto them (`s0.attachedFileId=123;`),
// links them into arrays (`s3[0]=s0;`) and finally hands the root to
// `dwr.engine._remoteHandleCallback('1','0',s9);`. The same object can be
// referenced from several places (a case-level attachment and the motion
// that later cites it), objects are declared before or after the arrays that
// hold them, and string values legally contain `;`, `=` and quotes.
//
// The historical regression this file exists for: TAS document 1161121
// exposed 22 attachment objects, including case-level ones whose `motionId`
// is null. A narrow `attachedFileId=…,motionId=…` regex found 21. Evaluating
// the reply as the object graph it is — every statement, every reference —
// makes "how many attachment objects exist" a question about the graph, not
// about how a regex happened to line up with the text.
//
// Pure: no I/O, no clock. Untrusted input never reaches `eval`/`Function`.

export type DwrValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | Date
  | DwrValue[]
  | { [key: string]: DwrValue };

// ─────────────────────────────── request side ───────────────────────────────

export type DwrParam =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'array'; items: DwrParam[] }
  | { kind: 'object'; fields: Record<string, DwrParam> };

export const dwr = {
  str: (value: string): DwrParam => ({ kind: 'string', value }),
  num: (value: number): DwrParam => ({ kind: 'number', value }),
  bool: (value: boolean): DwrParam => ({ kind: 'boolean', value }),
  nil: (): DwrParam => ({ kind: 'null' }),
  arr: (items: DwrParam[]): DwrParam => ({ kind: 'array', items }),
  obj: (fields: Record<string, DwrParam>): DwrParam => ({ kind: 'object', fields }),
};

/** DWR's own escaping for `string:` values: percent-encode everything that
 * is not unreserved, which the servlet decodes back. */
function encodeDwrString(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface DwrCall {
  scriptName: string;
  methodName: string;
  params: DwrParam[];
}

export interface DwrRequestOptions {
  /** The page DWR believes it is serving, e.g. /architect/publicInformation.html */
  page: string;
  batchId: number;
  scriptSessionId?: string;
  httpSessionId?: string;
}

/**
 * Serialise one plaincall batch body (text/plain). Nested arrays/objects are
 * emitted as `c0-eN` reference lines exactly as the DWR client does, so the
 * server's converter reconstructs the same graph.
 */
export function serializeDwrCall(call: DwrCall, opts: DwrRequestOptions): string {
  const lines: string[] = [];
  const extra: string[] = [];
  let e = 0;
  const enc = (p: DwrParam): string => {
    switch (p.kind) {
      case 'string':
        return `string:${encodeDwrString(p.value)}`;
      case 'number':
        if (!Number.isFinite(p.value)) throw new Error('DWR_NUMBER_NOT_FINITE');
        return `number:${p.value}`;
      case 'boolean':
        return `boolean:${p.value}`;
      case 'null':
        return 'null:null';
      case 'array': {
        const refs = p.items.map((item) => ref(item));
        // Live-verified browser form (tas-worker/TASK.md): lowercase `array:`.
        return `array:[${refs.join(',')}]`;
      }
      case 'object': {
        const parts = Object.entries(p.fields).map(([k, v]) => `${k}:${ref(v)}`);
        return `Object_Object:{${parts.join(',')}}`;
      }
    }
  };
  const ref = (p: DwrParam): string => {
    // Numbered parent-first (c0-e14 for an array, c0-e15.. for its items),
    // but emitted children-first — the exact order the public page sends.
    e += 1;
    const name = `c0-e${e}`;
    const value = enc(p);
    extra.push(`${name}=${value}`);
    return `reference:${name}`;
  };

  // Line order and fields as the public page sends them (live-verified
  // without cookies, with empty httpSessionId/scriptSessionId).
  lines.push('callCount=1');
  lines.push('windowName=');
  lines.push(`c0-scriptName=${call.scriptName}`);
  lines.push(`c0-methodName=${call.methodName}`);
  lines.push('c0-id=0');
  const paramLines = call.params.map((p, i) => `c0-param${i}=${enc(p)}`);
  lines.push(...extra, ...paramLines);
  lines.push(`batchId=${opts.batchId}`);
  lines.push(`page=${encodeDwrString(opts.page)}`);
  lines.push(`httpSessionId=${opts.httpSessionId ?? ''}`);
  lines.push(`scriptSessionId=${opts.scriptSessionId ?? ''}`);
  return lines.join('\n') + '\n';
}

// ─────────────────────────────── response side ──────────────────────────────

export class DwrParseError extends Error {
  constructor(message: string, public offset: number) {
    super(`${message} @${offset}`);
  }
}

export interface DwrReply {
  /** The value passed to the callback, with every reference resolved. */
  data: DwrValue;
  /** True when the server answered through a callback (not an exception). */
  ok: boolean;
  exception: { javaClassName: string | null; message: string | null } | null;
  /** Number of distinct objects/arrays the reply declared or built. */
  objectCount: number;
  /** Statements the evaluator recognised but deliberately ignored. */
  ignoredStatements: number;
}

const CALLBACK_NAMES = new Set([
  'dwr.engine._remoteHandleCallback',
  'dwr.engine.remote.handleCallback',
  'r.handleCallback',
]);
const EXCEPTION_NAMES = new Set([
  'dwr.engine._remoteHandleException',
  'dwr.engine.remote.handleException',
  'dwr.engine._remoteHandleBatchException',
  'dwr.engine.remote.handleBatchException',
  'r.handleException',
  'r.handleBatchException',
]);

type Ref = { __ref: string };

class Evaluator {
  private i = 0;
  private vars = new Map<string, DwrValue>();
  private containers = 0;
  ignored = 0;
  callback: { data: DwrValue } | null = null;
  exception: { javaClassName: string | null; message: string | null } | null = null;

  constructor(private src: string) {}

  run(): void {
    for (;;) {
      this.ws();
      if (this.i >= this.src.length) return;
      if (this.peek() === ';') {
        this.i++;
        continue;
      }
      this.statement();
    }
  }

  get objectCount(): number {
    return this.containers;
  }

  // ── lexical helpers ──
  private peek(o = 0): string {
    return this.src[this.i + o] ?? '';
  }

  private ws(): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '﻿') {
        this.i++;
      } else if (c === '/' && this.peek(1) === '/') {
        while (this.i < this.src.length && this.peek() !== '\n') this.i++;
      } else if (c === '/' && this.peek(1) === '*') {
        const end = this.src.indexOf('*/', this.i + 2);
        this.i = end < 0 ? this.src.length : end + 2;
      } else return;
    }
  }

  private expect(ch: string): void {
    this.ws();
    if (this.peek() !== ch) throw new DwrParseError(`expected '${ch}' got '${this.peek()}'`, this.i);
    this.i++;
  }

  private ident(): string {
    this.ws();
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.src.slice(this.i, this.i + 256));
    if (!m) throw new DwrParseError('identifier expected', this.i);
    this.i += m[0].length;
    return m[0];
  }

  private skipToStatementEnd(): void {
    // Skip one unrecognised statement, respecting strings and nesting.
    let depth = 0;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (c === '"' || c === "'") {
        this.string();
        continue;
      }
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ';' && depth <= 0) {
        this.i++;
        return;
      }
      this.i++;
    }
  }

  // ── statements ──
  private statement(): void {
    const start = this.i;
    let head: string;
    try {
      head = this.ident();
    } catch {
      this.i = start;
      this.ignored++;
      this.skipToStatementEnd();
      return;
    }
    if (head === 'var' || head === 'let' || head === 'const') {
      for (;;) {
        const name = this.ident();
        this.ws();
        if (this.peek() === '=') {
          this.i++;
          this.vars.set(name, this.expr());
        } else this.vars.set(name, undefined);
        this.ws();
        if (this.peek() === ',') {
          this.i++;
          continue;
        }
        break;
      }
      this.endStatement();
      return;
    }
    if (head === 'throw' || head === 'if' || head === 'try' || head === 'return' || head === 'while' || head === 'for') {
      // e.g. "throw 'allowScriptTagRemoting is false.';" guard prefix.
      this.ignored++;
      this.skipToStatementEnd();
      return;
    }

    // A member chain: a.b.c, a[0], a['x'] … followed by '=' or '(' …
    const path: Array<string | number> = [head];
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '.') {
        this.i++;
        path.push(this.ident());
      } else if (c === '[') {
        this.i++;
        const key = this.expr();
        this.expect(']');
        path.push(typeof key === 'number' ? key : String(key));
      } else break;
    }
    this.ws();
    const c = this.peek();
    if (c === '=' && this.peek(1) !== '=') {
      this.i++;
      const value = this.expr();
      this.assign(path, value);
      this.endStatement();
      return;
    }
    if (c === '(') {
      this.i++;
      const args = this.args();
      const callee = path.join('.');
      this.call(callee, args);
      this.endStatement();
      return;
    }
    this.ignored++;
    this.skipToStatementEnd();
  }

  private endStatement(): void {
    this.ws();
    if (this.peek() === ';') this.i++;
  }

  private args(): DwrValue[] {
    const out: DwrValue[] = [];
    this.ws();
    if (this.peek() === ')') {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.expr());
      this.ws();
      const c = this.peek();
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === ')') {
        this.i++;
        return out;
      }
      throw new DwrParseError("expected ',' or ')'", this.i);
    }
  }

  private assign(path: Array<string | number>, value: DwrValue): void {
    if (path.length === 1) {
      this.vars.set(String(path[0]), value);
      return;
    }
    let target: any = this.vars.get(String(path[0]));
    for (let k = 1; k < path.length - 1; k++) {
      if (target == null || typeof target !== 'object') return;
      target = target[path[k] as any];
    }
    if (target == null || typeof target !== 'object') {
      this.ignored++;
      return;
    }
    const key = path[path.length - 1];
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    target[key as any] = value;
  }

  private call(callee: string, args: DwrValue[]): void {
    if (CALLBACK_NAMES.has(callee)) {
      // (batchId, callId, data)
      this.callback = { data: args[2] };
      return;
    }
    if (EXCEPTION_NAMES.has(callee)) {
      const ex = args.find((a) => a && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Date)) as any;
      this.exception = {
        javaClassName: ex?.javaClassName != null ? String(ex.javaClassName) : null,
        message: ex?.message != null ? String(ex.message) : typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : null,
      };
      return;
    }
    // dwr.engine._remoteHandleNewScriptSession, handleBatchStart, etc.
    this.ignored++;
  }

  // ── expressions ──
  private expr(): DwrValue {
    this.ws();
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) return this.number();
    const word = this.ident();
    if (word === 'null') return null;
    if (word === 'undefined') return undefined;
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'NaN') return null;
    if (word === 'Infinity') return null;
    if (word === 'new') {
      const ctor = this.ident();
      this.ws();
      let args: DwrValue[] = [];
      if (this.peek() === '(') {
        this.i++;
        args = this.args();
      }
      if (ctor === 'Date') {
        const v = args[0];
        const d = typeof v === 'number' || typeof v === 'string' ? new Date(v as any) : new Date(NaN);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (ctor === 'Object') return this.track({});
      if (ctor === 'Array') return this.track([]);
      return null;
    }
    // Variable reference, possibly with member access (rare in replies).
    let v: any = this.vars.has(word) ? this.vars.get(word) : undefined;
    for (;;) {
      this.ws();
      if (this.peek() === '.') {
        this.i++;
        const k = this.ident();
        v = v != null && typeof v === 'object' ? v[k] : undefined;
      } else if (this.peek() === '[') {
        this.i++;
        const k = this.expr();
        this.expect(']');
        v = v != null && typeof v === 'object' ? v[k as any] : undefined;
      } else break;
    }
    return v;
  }

  private track<T extends object>(o: T): T {
    this.containers++;
    return o;
  }

  private object(): DwrValue {
    this.expect('{');
    const o: Record<string, DwrValue> = this.track({});
    this.ws();
    if (this.peek() === '}') {
      this.i++;
      return o;
    }
    for (;;) {
      this.ws();
      const c = this.peek();
      let key: string;
      if (c === '"' || c === "'") key = this.string();
      else if (c >= '0' && c <= '9') key = String(this.number());
      else key = this.ident();
      this.expect(':');
      const value = this.expr();
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') o[key] = value;
      this.ws();
      const n = this.peek();
      if (n === ',') {
        this.i++;
        this.ws();
        if (this.peek() === '}') {
          this.i++;
          return o;
        }
        continue;
      }
      if (n === '}') {
        this.i++;
        return o;
      }
      throw new DwrParseError("expected ',' or '}'", this.i);
    }
  }

  private array(): DwrValue {
    this.expect('[');
    const a: DwrValue[] = this.track([]);
    this.ws();
    if (this.peek() === ']') {
      this.i++;
      return a;
    }
    for (;;) {
      a.push(this.expr());
      this.ws();
      const n = this.peek();
      if (n === ',') {
        this.i++;
        continue;
      }
      if (n === ']') {
        this.i++;
        return a;
      }
      throw new DwrParseError("expected ',' or ']'", this.i);
    }
  }

  private number(): number {
    this.ws();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.i, this.i + 64));
    if (!m) throw new DwrParseError('number expected', this.i);
    this.i += m[0].length;
    return Number(m[0]);
  }

  private string(): string {
    const q = this.peek();
    this.i++;
    let out = '';
    while (this.i < this.src.length) {
      const c = this.src[this.i++];
      if (c === q) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.src[this.i++];
      switch (e) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case 'u': {
          if (this.src[this.i] === '{') {
            const end = this.src.indexOf('}', this.i);
            out += String.fromCodePoint(parseInt(this.src.slice(this.i + 1, end), 16));
            this.i = end + 1;
          } else {
            out += String.fromCharCode(parseInt(this.src.slice(this.i, this.i + 4), 16));
            this.i += 4;
          }
          break;
        }
        case 'x':
          out += String.fromCharCode(parseInt(this.src.slice(this.i, this.i + 2), 16));
          this.i += 2;
          break;
        case '\n':
          break;
        default:
          out += e;
      }
    }
    throw new DwrParseError('unterminated string', this.i);
  }
}

/** Evaluate a DWR reply body into its resolved object graph. */
export function parseDwrReply(body: string): DwrReply {
  const ev = new Evaluator(String(body ?? ''));
  ev.run();
  if (!ev.callback && !ev.exception) {
    throw new DwrParseError('no DWR callback or exception in reply', body.length);
  }
  return {
    data: ev.callback ? ev.callback.data : null,
    ok: !!ev.callback && !ev.exception,
    exception: ev.exception,
    objectCount: ev.objectCount,
    ignoredStatements: ev.ignored,
  };
}

/**
 * Visit every distinct object reachable from `root` exactly once (cycle and
 * shared-reference safe), including objects nested inside arrays.
 */
export function walkObjects(root: DwrValue, visit: (o: Record<string, DwrValue>, path: string) => void): void {
  const seen = new Set<object>();
  const stack: Array<{ v: DwrValue; path: string }> = [{ v: root, path: '$' }];
  while (stack.length) {
    const { v, path } = stack.pop()!;
    if (v == null || typeof v !== 'object' || v instanceof Date) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let k = v.length - 1; k >= 0; k--) stack.push({ v: v[k], path: `${path}[${k}]` });
      continue;
    }
    visit(v, path);
    const keys = Object.keys(v);
    for (let k = keys.length - 1; k >= 0; k--) stack.push({ v: v[keys[k]], path: `${path}.${keys[k]}` });
  }
}

/**
 * A JSON-safe copy (Dates → ISO strings, cycles → "[circular]"), bounded in
 * depth so a pathological reply cannot blow the stack.
 */
export function toPlain(v: DwrValue, depth = 0, stack: object[] = []): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (depth > 40) return '[depth]';
  if (stack.includes(v)) return '[circular]';
  stack.push(v);
  let out: unknown;
  if (Array.isArray(v)) out = v.map((x) => toPlain(x, depth + 1, stack));
  else {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = toPlain(x, depth + 1, stack);
    out = o;
  }
  stack.pop();
  return out;
}

// local-shims.d.ts — LOCAL TYPE-CHECKING ONLY.
//
// This sandbox has no network access to the npm registry (registry.npmjs.org
// returns 403 for this session), so `@types/node`, `@types/express`, and
// real Playwright type declarations cannot be installed here to run
// `tsc --noEmit` locally. Railway's own build environment is NOT subject to
// this sandbox's proxy restriction and installs the REAL packages
// (express, playwright, pdf-parse, tsx) from package.json normally — this
// file has zero effect at runtime (tsx does not type-check, it only
// transpiles), it exists purely so this sandbox can catch gross structural/
// logic mistakes in the new TypeScript source before it ships.
//
// Consequence (stated plainly, not hidden): the Playwright-facing surface
// (Page/Locator/BrowserContext/Frame) is typed loosely as `any` here, so
// this local check does NOT catch a wrong Playwright method name or a
// misused argument — only the real `tsc`/IDE with real Playwright types
// installed (which Railway's build machine has) would. All of the NEW
// domain modeling this refactor is actually about — FSM state names,
// Evidence/Entity/Document shapes, transition legality — IS strongly typed
// and IS checked by this file's presence.
declare module 'playwright' {
  export const chromium: any;
  export type Page = any;
  export type Browser = any;
  export type BrowserContext = any;
  export type Frame = any;
  export type Locator = any;
}
declare module 'express' {
  const e: any;
  export default e;
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
}
declare module 'pdf-parse' {
  const pdf: (buf: Buffer) => Promise<{ text: string; numpages: number; info?: any }>;
  export default pdf;
}
declare module 'crypto' {
  export function createHash(algo: string): { update(buf: Buffer | string): { digest(enc: string): string } };
  export function randomUUID(): string;
}
declare module 'node:crypto' {
  export * from 'crypto';
}

// ── Minimal Node/DOM-ish globals (no @types/node available locally) ───────
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(...a: any[]): void; error(...a: any[]): void; warn(...a: any[]): void };
declare function setTimeout(fn: (...a: any[]) => void, ms?: number): any;
declare function setInterval(fn: (...a: any[]) => void, ms?: number): any;
declare function clearInterval(id: any): void;
declare class Buffer {
  static from(s: string, enc?: string): Buffer;
  static isBuffer(x: any): boolean;
  subarray(a: number, b?: number): Buffer;
  toString(enc?: string): string;
  length: number;
}
declare const crypto: { randomUUID(): string };
declare function fetch(url: string, init?: any): Promise<any>;
declare class URL {
  constructor(url: string, base?: string);
  searchParams: { keys(): IterableIterator<string>; delete(k: string): void };
  hash: string;
  toString(): string;
}

// Design Studio — the one error type its services throw: a stable code (DS_…) the screens translate.

export class DesignStudioError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

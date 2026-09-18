export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  settled: () => boolean;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let done = false;

  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      done = true;
      res(value);
    };
    reject = (reason) => {
      done = true;
      rej(reason);
    };
  });

  return { promise, resolve, reject, settled: () => done };
}

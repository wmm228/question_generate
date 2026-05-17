export type AsyncLockRunner = <T>(key: string, task: () => T | Promise<T>) => Promise<T>;

export function createAsyncKeyedLock(): AsyncLockRunner {
  const tails = new Map<string, Promise<void>>();

  return async function runWithLock<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => gate);
    tails.set(key, next);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (tails.get(key) === next) {
        tails.delete(key);
      }
    }
  };
}

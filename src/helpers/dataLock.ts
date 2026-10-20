/** Serialize local writes, upload snapshots, and acknowledgments, never network I/O. */
let tail: Promise<unknown> = Promise.resolve();
export function withDataLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => undefined);
  return result;
}

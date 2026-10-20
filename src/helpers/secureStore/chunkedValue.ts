import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import uuid from "react-native-uuid";

type Version = { id: string; count: number; digest: string };
type Manifest = { current?: Version; pending?: Version };
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const hash = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);

export class SecureStorageIntegrityError extends Error {
  readonly code = "SECURE_STORAGE_INTEGRITY";
  constructor(message = "Invalid secure storage data; data preserved.") {
    super(message);
    this.name = "SecureStorageIntegrityError";
  }
}
export class UncommittedChunkedValueError extends SecureStorageIntegrityError {
  constructor() {
    super("Secure storage write was interrupted; recovery is required.");
    this.name = "UncommittedChunkedValueError";
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function validVersion(value: unknown): value is Version {
  return (
    isObject(value) &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every((key) =>
      ["id", "count", "digest"].includes(key),
    ) &&
    typeof value.id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.id,
    ) &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 1 &&
    value.count <= 100000 &&
    typeof value.digest === "string" &&
    /^[a-f0-9]{64}$/.test(value.digest)
  );
}
async function manifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (raw === null) return null;
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    throw new SecureStorageIntegrityError();
  }
  if (
    !isObject(result) ||
    Object.keys(result).length === 0 ||
    Object.keys(result).some(
      (field) => !["current", "pending"].includes(field),
    ) ||
    ("current" in result && !validVersion(result.current)) ||
    ("pending" in result && !validVersion(result.pending))
  ) {
    throw new SecureStorageIntegrityError();
  }
  const state = result as Manifest;
  if (state.current && state.pending && state.current.id === state.pending.id)
    throw new SecureStorageIntegrityError();
  return state;
}
async function writeManifest(key: string, state: Manifest) {
  const raw = JSON.stringify(state);
  await SecureStore.setItemAsync(key, raw, options);
  if ((await SecureStore.getItemAsync(key, options)) !== raw)
    throw new SecureStorageIntegrityError(
      "Secure manifest verification failed; data preserved.",
    );
}
async function removeVersion(key: string, version?: Version) {
  if (!version) return;
  for (let i = 0; i < version.count; i++) {
    const partKey = `${key}.${version.id}.${i}`;
    if ((await SecureStore.getItemAsync(partKey, options)) !== null) {
      await SecureStore.deleteItemAsync(partKey, options);
      if ((await SecureStore.getItemAsync(partKey, options)) !== null)
        throw new SecureStorageIntegrityError(
          "Secure cleanup was not verified; recovery information preserved.",
        );
    }
  }
}
async function readVersion(key: string, version: Version) {
  let value = "";
  for (let i = 0; i < version.count; i++) {
    const part = await SecureStore.getItemAsync(
      `${key}.${version.id}.${i}`,
      options,
    );
    if (part === null)
      throw new SecureStorageIntegrityError(
        "Secure storage data is incomplete; data preserved.",
      );
    value += part;
  }
  if ((await hash(value)) !== version.digest)
    throw new SecureStorageIntegrityError(
      "Secure storage verification failed; data preserved.",
    );
  return value;
}
/** Caller serializes operations. The manifest switches only after all chunks verify.
 * Pending records make interrupted writes/deletes discoverable for later cleanup. */
export async function writeChunkedValue(key: string, value: string) {
  const previous = (await manifest(key)) || {};
  // Never replace a damaged committed record with a new value.
  if (previous.current) await readVersion(key, previous.current);
  await removeVersion(key, previous.pending);
  // 400 Unicode code points are at most 1600 UTF-8 bytes, below the 2KB legacy limit.
  const chars = Array.from(value);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 400)
    parts.push(chars.slice(i, i + 400).join(""));
  if (!parts.length) parts.push("");
  if (parts.length > 100000)
    throw new Error("Secure storage value is too large.");
  const next = {
    id: String(uuid.v4()),
    count: parts.length,
    digest: await hash(value),
  };
  if (!validVersion(next)) throw new SecureStorageIntegrityError();
  await writeManifest(key, { current: previous.current, pending: next });
  for (let i = 0; i < parts.length; i++)
    await SecureStore.setItemAsync(`${key}.${next.id}.${i}`, parts[i], options);
  if ((await readVersion(key, next)) !== value)
    throw new SecureStorageIntegrityError();
  await writeManifest(key, { current: next, pending: previous.current });
  await removeVersion(key, previous.current);
  await writeManifest(key, { current: next });
}
export async function readChunkedValue(key: string): Promise<string | null> {
  const state = await manifest(key);
  if (state === null) return null;
  if (!state.current) throw new UncommittedChunkedValueError();
  return readVersion(key, state.current);
}
export async function clearChunkedValue(key: string) {
  const state = await manifest(key);
  if (state === null) return;
  if (state.current) await readVersion(key, state.current);
  await removeVersion(key, state.pending);
  if (state.current) {
    // Turn deletion into a recoverable pending-only state before removing chunks.
    await writeManifest(key, { pending: state.current });
    await removeVersion(key, state.current);
  }
  if ((await SecureStore.getItemAsync(key, options)) !== null) {
    await SecureStore.deleteItemAsync(key, options);
    if ((await SecureStore.getItemAsync(key, options)) !== null)
      throw new SecureStorageIntegrityError(
        "Secure cleanup was not verified; recovery information preserved.",
      );
  }
}

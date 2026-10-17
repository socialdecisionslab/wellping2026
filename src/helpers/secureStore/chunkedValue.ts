import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

type Version = { id: string; count: number; digest: string };
type Manifest = { current?: Version; pending?: Version };
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const hash = (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);

async function manifest(key: string): Promise<Manifest> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (!raw) return {};
  const result: Manifest = JSON.parse(raw);
  for (const v of [result.current, result.pending]) {
    if (v && (!/^[a-f0-9-]+$/.test(v.id) || !Number.isInteger(v.count) || v.count < 1 || v.count > 100000 || !/^[a-f0-9]{64}$/.test(v.digest))) {
      throw new Error("Invalid secure resume manifest; data preserved.");
    }
  }
  return result;
}
async function removeVersion(key: string, version?: Version) {
  if (!version) return;
  for (let i = 0; i < version.count; i++) {
    const partKey = `${key}.${version.id}.${i}`;
    if (await SecureStore.getItemAsync(partKey, options) !== null) await SecureStore.deleteItemAsync(partKey, options);
  }
}
async function readVersion(key: string, version: Version) {
  let value = "";
  for (let i = 0; i < version.count; i++) {
    const part = await SecureStore.getItemAsync(`${key}.${version.id}.${i}`, options);
    if (part === null) throw new Error("Secure resume data is incomplete; data preserved.");
    value += part;
  }
  if (await hash(value) !== version.digest) throw new Error("Secure resume verification failed; data preserved.");
  return value;
}
/** Caller serializes operations. The manifest switches only after all chunks verify.
 * Pending records make interrupted writes/deletes discoverable for later cleanup. */
export async function writeChunkedValue(key: string, value: string) {
  const previous = await manifest(key);
  await removeVersion(key, previous.pending);
  // 400 Unicode code points are at most 1600 UTF-8 bytes, below the 2KB legacy limit.
  const chars = Array.from(value);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 400) parts.push(chars.slice(i, i + 400).join(""));
  if (!parts.length) parts.push("");
  const next = { id: Crypto.randomUUID(), count: parts.length, digest: await hash(value) };
  await SecureStore.setItemAsync(key, JSON.stringify({ current: previous.current, pending: next }), options);
  for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}.${next.id}.${i}`, parts[i], options);
  if (await readVersion(key, next) !== value) throw new Error("Secure resume verification failed.");
  await SecureStore.setItemAsync(key, JSON.stringify({ current: next, pending: previous.current }), options);
  await removeVersion(key, previous.current);
  await SecureStore.setItemAsync(key, JSON.stringify({ current: next }), options);
}
export async function readChunkedValue(key: string): Promise<string | null> {
  const state = await manifest(key);
  return state.current ? readVersion(key, state.current) : null;
}
export async function clearChunkedValue(key: string) {
  const state = await manifest(key);
  await removeVersion(key, state.current);
  await removeVersion(key, state.pending);
  if (await SecureStore.getItemAsync(key, options) !== null) await SecureStore.deleteItemAsync(key, options);
}

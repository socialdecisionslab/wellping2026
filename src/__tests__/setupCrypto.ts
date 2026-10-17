// Expo's default Jest native stub does not implement hashing or UUIDs. Use real
// Node cryptography at this native boundary so secure-resume integrity checks
// execute unchanged in tests instead of replacing the persistence helpers.
jest.mock("expo-crypto", () => {
  const crypto = require("crypto");
  return {
    ...jest.requireActual("expo-crypto"),
    digestStringAsync: jest.fn(async (algorithm: string, value: string) =>
      crypto
        .createHash(algorithm.replace(/-/g, "").toLowerCase())
        .update(value)
        .digest("hex"),
    ),
    randomUUID: jest.fn(() => crypto.randomUUID()),
  };
});

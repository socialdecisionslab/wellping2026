// Native crypto is unavailable in Jest. Use real SHA-256 over synthetic data.
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  CryptoEncoding: { BASE64: "base64", HEX: "hex" },
  digestStringAsync: async (_algorithm, value, options) =>
    require("crypto")
      .createHash("sha256")
      .update(value)
      .digest(options?.encoding || "hex"),
}));

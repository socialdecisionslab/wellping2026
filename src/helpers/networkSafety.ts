/** Parse without relying on React Native's incomplete global URL implementation. */
export function getHttpsOrigin(value: string): string {
  // Reject ambiguous URL syntax before parsing; never include the input in errors.
  if (
    /[\\\s\u0000-\u001f\u007f]/.test(value) ||
    !value.startsWith("https://")
  ) {
    throw new Error("A valid HTTPS address is required.");
  }
  const authority =
    /^https:\/\/([A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::([0-9]+))?(?:[/?#]|$)/.exec(
      value,
    );
  if (
    !authority ||
    (authority[2] && (Number(authority[2]) < 1 || Number(authority[2]) > 65535))
  ) {
    throw new Error("A valid HTTPS address is required.");
  }
  const port = authority[2] ? Number(authority[2]) : 443;
  return `https://${authority[1].toLowerCase()}${
    port !== 443 ? `:${port}` : ""
  }`;
}

export function isSameHttpsOrigin(candidate: string, allowed: string): boolean {
  try {
    return getHttpsOrigin(candidate) === getHttpsOrigin(allowed);
  } catch {
    return false;
  }
}

export function assertSafeDashboardTemplate(value: string): void {
  getHttpsOrigin(value);
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error("Dashboard configuration is invalid.");
  }
  if (/__(PASSWORD_HASH|FIREBASE_ID_TOKEN|LOGIN_SESSION_ID)__/.test(decoded)) {
    throw new Error(
      "Dashboard credential URLs are disabled. Contact the study team.",
    );
  }
  // Reject recognizable literal credential query keys as well as placeholders.
  const queryKeys = decoded
    .split("#")[0]
    .split("?")
    .slice(1)
    .join("?")
    .split("&")
    .map((pair) => pair.split("=")[0]);
  if (
    queryKeys.some((key) =>
      /^(password|password_hash|token|id_token|access_token|refresh_token|authorization|secret|api_key)$/i.test(
        key,
      ),
    )
  ) {
    throw new Error(
      "Dashboard credential URLs are disabled. Contact the study team.",
    );
  }
}

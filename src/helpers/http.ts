import { getHttpsOrigin } from "./networkSafety";

/** Deadline includes body consumption. Native redirect behavior also needs device tests. */
export async function requestTextAsync(
  url: string,
  options: RequestInit,
  timeoutMs = 20000,
): Promise<{ status: number; text: string; contentType: string | null }> {
  getHttpsOrigin(url);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The study server did not respond in time."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          ...options,
          redirect: "error",
          signal: controller.signal,
        });
        if (response.redirected || (response.url && response.url !== url)) {
          throw new Error("Study server redirects are not allowed.");
        }
        if (response.status >= 300 && response.status < 400) {
          throw new Error("Study server redirects are not allowed.");
        }
        return {
          status: response.status,
          text: await response.text(),
          contentType: response.headers.get("content-type"),
        };
      })(),
      deadline,
    ]);
  } catch (_) {
    throw new Error("Unable to contact the study server. Please retry.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

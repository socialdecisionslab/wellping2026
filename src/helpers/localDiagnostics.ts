/** Opt-in, memory-only counters. Never accepts an Error, message, ID or response. */
export type DiagnosticCode = "handled_operation_failed" | "render_failed";
const LIMIT = 999;
let enabled = false;
let counters: Record<DiagnosticCode, number> = {
  handled_operation_failed: 0,
  render_failed: 0,
};
export function configureLocalDiagnostics(value: boolean): void {
  enabled = value === true;
  // Turning off also clears all observations. Nothing survives a restart.
  if (!enabled) counters = { handled_operation_failed: 0, render_failed: 0 };
}
export function recordLocalDiagnostic(code: DiagnosticCode): void {
  if (!enabled) return;
  // Runtime allowlist, including callers outside TypeScript. Never inspect input.
  if (code !== "handled_operation_failed" && code !== "render_failed") return;
  counters[code] = Math.min(LIMIT, counters[code] + 1);
}
export function readLocalDiagnostics() {
  return { enabled, counters: { ...counters } };
}

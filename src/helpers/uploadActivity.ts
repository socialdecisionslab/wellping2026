// A synchronous gate prevents uploads and session teardown from overlapping.
let pending = 0;
let closingSession = false;
export function beginUpload() {
  if (closingSession)
    throw new Error("Session is closing. Please retry after enrollment.");
  pending++;
}
export function finishUpload() {
  pending--;
}
export function hasPendingUploads() {
  return pending > 0;
}
export function beginSessionTeardown() {
  if (closingSession || pending > 0)
    throw new Error("An upload or logout is still in progress. Please wait.");
  closingSession = true;
}
export function finishSessionTeardown() {
  closingSession = false;
}

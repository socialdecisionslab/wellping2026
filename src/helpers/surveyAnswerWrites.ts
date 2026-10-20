/** Accepted survey events outlive a screen, but stay ordered by owner and ping. */
type AcceptedSave = {
  key: string;
  operation: () => Promise<void>;
  error?: unknown;
};
const lanes = new Map<string, Promise<void>>();
const failed = new Set<AcceptedSave>();
const blockedTails = new Map<string, Promise<void>>();
const keyFor = (ownerId: string, pingId: string) =>
  JSON.stringify([ownerId, pingId]);

function schedule(save: AcceptedSave): Promise<void> {
  const previous =
    lanes.get(save.key) || blockedTails.get(save.key) || Promise.resolve();
  // A failed earlier event blocks later events, including retries. Otherwise
  // retrying an older response could overwrite a newer successful answer.
  const result = previous.then(save.operation);
  lanes.set(save.key, result);
  const removeFinishedLane = () => {
    if (lanes.get(save.key) === result) lanes.delete(save.key);
  };
  void result.then(
    () => {
      failed.delete(save);
      removeFinishedLane();
    },
    (error) => {
      save.error = error;
      failed.add(save);
      if (lanes.get(save.key) === result) blockedTails.set(save.key, result);
      removeFinishedLane();
    },
  );
  return result;
}

export function enqueueSurveyAnswerSaveAsync(
  ownerId: string,
  pingId: string,
  operation: () => Promise<void>,
): Promise<void> {
  return schedule({ key: keyFor(ownerId, pingId), operation });
}

/** Remounts must wait before hydrating, not merely wait before their next write. */
export async function waitForSurveyAnswerSavesAsync(
  ownerId: string,
  pingId: string,
) {
  const key = keyFor(ownerId, pingId);
  const hadAcceptedSaves =
    lanes.has(key) || [...failed].some((save) => save.key === key);
  while (lanes.has(key)) await lanes.get(key)!.catch(() => undefined);
  const failedForPing = [...failed].filter((save) => save.key === key);
  if (failedForPing.length) {
    blockedTails.delete(key);
    await Promise.all(failedForPing.map(schedule));
  }
  while (lanes.has(key)) await lanes.get(key)!;
  return hadAcceptedSaves;
}

/** Await before logout/cleanup. Retry detached failures once; never hide failure
 * from the caller, which must preserve the session if any answer is not durable. */
export async function waitForPendingSurveySavesAsync(): Promise<void> {
  while (lanes.size) {
    await Promise.all(
      [...lanes.values()].map((operation) => operation.catch(() => undefined)),
    );
  }
  if (failed.size) {
    const retry = [...failed];
    for (const save of retry) blockedTails.delete(save.key);
    await Promise.all(retry.map(schedule));
  }
  while (lanes.size) await Promise.all([...lanes.values()]);
  if (failed.size) throw [...failed][0].error;
}

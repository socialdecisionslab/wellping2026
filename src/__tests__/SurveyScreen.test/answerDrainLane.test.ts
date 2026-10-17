import {
  enqueueSurveyAnswerSaveAsync,
  waitForPendingSurveySavesAsync,
  waitForSurveyAnswerSavesAsync,
} from "../../helpers/surveyAnswerWrites";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("accepted events share FIFO order across instances without timestamps", async () => {
  const gate = deferred();
  const order: string[] = [];
  const first = enqueueSurveyAnswerSaveAsync("owner", "ping", async () => {
    await gate.promise;
    order.push("old first");
  });
  const second = enqueueSurveyAnswerSaveAsync("owner", "ping", async () => {
    order.push("old second");
  });
  const third = enqueueSurveyAnswerSaveAsync("owner", "ping", async () => {
    order.push("new screen");
  });
  let drained = false;
  const wait = waitForPendingSurveySavesAsync().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve();
  await Promise.all([first, second, third, wait]);
  expect(order).toEqual(["old first", "old second", "new screen"]);
});

test("failed detached event blocks later values and retry preserves their original order", async () => {
  const order: string[] = [];
  let fail = true;
  const first = enqueueSurveyAnswerSaveAsync("owner", "retry", async () => {
    if (fail) throw new Error("disk unavailable");
    order.push("older");
  });
  const second = enqueueSurveyAnswerSaveAsync("owner", "retry", async () => {
    order.push("newer");
  });
  await expect(first).rejects.toThrow("disk unavailable");
  await expect(second).rejects.toThrow("disk unavailable");
  expect(order).toEqual([]);
  await expect(waitForPendingSurveySavesAsync()).rejects.toThrow(
    "disk unavailable",
  );
  expect(order).toEqual([]);
  fail = false;
  await waitForPendingSurveySavesAsync();
  expect(order).toEqual(["older", "newer"]);
});

test("a remount retries retained failures before allowing hydration", async () => {
  let calls = 0;
  const write = enqueueSurveyAnswerSaveAsync("owner", "remount", async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary write failure");
  });
  await expect(write).rejects.toThrow();
  await waitForSurveyAnswerSavesAsync("owner", "remount");
  expect(calls).toBe(2);
  await waitForPendingSurveySavesAsync();
});

test("unrelated owners do not share a lane while global cleanup waits for both", async () => {
  const gate = deferred();
  let secondOwnerSaved = false;
  const first = enqueueSurveyAnswerSaveAsync(
    "owner-one",
    "same-ping",
    async () => {
      await gate.promise;
    },
  );
  const second = enqueueSurveyAnswerSaveAsync(
    "owner-two",
    "same-ping",
    async () => {
      secondOwnerSaved = true;
    },
  );
  await second;
  await waitForSurveyAnswerSavesAsync("owner-two", "same-ping");
  expect(secondOwnerSaved).toBe(true);
  let drained = false;
  const wait = waitForPendingSurveySavesAsync().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve();
  await Promise.all([first, wait]);
});

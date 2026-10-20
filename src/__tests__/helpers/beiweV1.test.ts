import { uploadBeiweV1Async, postBeiweV1Async } from "../../helpers/beiweV1";
import { requestTextAsync } from "../../helpers/http";
import { downloadStudyFileAsync } from "../../helpers/studyFile";

jest.mock("../../../config/release", () => ({
  RELEASE: {
    environment: "staging",
    protocol: "wellping-v1",
    studyUrl: "https://study.invalid/config",
    beiweUrl: "https://beiwe.invalid",
    supportEmail: "support@study.invalid",
  },
}));
jest.mock("../../helpers/loginSession", () => ({
  getLoginSessionIDAsync: async () => "synthetic-session",
}));
jest.mock("../../helpers/firebase", () => ({}));
const originalFetch = global.fetch;
const user = {
  username: "synthetic-user",
  password: "synthetic-secret",
  loginDate: 0,
};
const payload = {
  user: {
    username: user.username,
    loginSessionId: "synthetic-session",
    installation: {} as any,
  },
  receipt: "opaque-receipt",
  revisions: {},
};
function response(body: unknown, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => "application/json" },
  } as unknown as Response;
}
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

test("upload credentials travel only in the JSON body and receipt is verified", async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response({ protocol: "wellping-v1", receipt: payload.receipt }),
    );
  await uploadBeiweV1Async(payload, user);
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("https://beiwe.invalid/wellping/v1/upload");
  expect(url).not.toContain("?");
  const body = JSON.parse(options.body);
  expect(body.credentials.username).toBe(user.username);
  expect(body.credentials.passwordHash).toBeTruthy();
  expect(options.body).not.toContain(user.password);
  expect(options.redirect).toBe("error");
  expect(body.payload.receipt).toBe(payload.receipt);
});

test.each([
  {},
  { protocol: "wellping-v1", receipt: "different" },
  { receipt: payload.receipt },
])(
  "a 2xx without the exact receipt cannot acknowledge data: %j",
  async (body) => {
    global.fetch = jest.fn().mockResolvedValue(response(body));
    await expect(uploadBeiweV1Async(payload, user)).rejects.toThrow(
      "not acknowledged",
    );
  },
);

test("study download uses the configured URL with body authentication", async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ synthetic: true }));
  expect(
    await downloadStudyFileAsync({
      url: "https://study.invalid/config",
      ...user,
    }),
  ).toBe('{"synthetic":true}');
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("https://study.invalid/config");
  expect(options.method).toBe("POST");
  expect(JSON.parse(options.body).credentials.username).toBe(user.username);
  await expect(
    downloadStudyFileAsync({ url: "https://other.invalid/config", ...user }),
  ).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("timeout also bounds a hung response body", async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    text: () => new Promise(() => {}),
    headers: { get: () => null },
  });
  const pending = requestTextAsync("https://study.invalid", {}, 100);
  const rejected = expect(pending).rejects.toThrow("Unable to contact");
  await jest.advanceTimersByTimeAsync(100);
  await rejected;
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(
    true,
  );
});

test.each([302, 401, 403, 500])(
  "enrollment rejects HTTP %s without exposing credentials",
  async (status) => {
    global.fetch = jest.fn().mockResolvedValue(response({}, status));
    await expect(postBeiweV1Async("enroll", user, {})).rejects.toThrow();
  },
);

test("redirected responses are rejected even when native fetch follows them", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ...response({}),
    redirected: true,
    url: "https://other.invalid",
  });
  await expect(postBeiweV1Async("enroll", user, {})).rejects.toThrow(
    "Unable to contact",
  );
});

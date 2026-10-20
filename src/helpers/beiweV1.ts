import { RELEASE } from "../../config/release";
import { requestTextAsync } from "./http";
import { base64ToBase64URL, getHashedPasswordAsync } from "./helpers";
import { getLoginSessionIDAsync } from "./loginSession";
import type { User } from "./secureStore/user";
import type { UploadData } from "./dataUploadType";
import type { DataUploadServerResponse } from "./server";

/** Proposed Well Ping adapter contract; not a stock Beiwe API. */
export async function postBeiweV1Async(
  path: "enroll" | "upload",
  user: User,
  payload: unknown,
) {
  if (!RELEASE) throw new Error("The study server is not configured.");
  const response = await requestTextAsync(
    `${RELEASE.beiweUrl}/wellping/v1/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        protocol: "wellping-v1",
        credentials: {
          username: user.username,
          passwordHash: base64ToBase64URL(
            await getHashedPasswordAsync(user.password),
          ),
        },
        sessionId: await getLoginSessionIDAsync(user),
        payload,
      }),
    },
  );
  if (response.status < 200 || response.status >= 300)
    throw new Error("The study server rejected the request.");
  try {
    return JSON.parse(response.text);
  } catch (_) {
    throw new Error("The study server returned an invalid response.");
  }
}

export async function uploadBeiweV1Async(
  data: UploadData,
  user: User,
): Promise<DataUploadServerResponse> {
  if (!data.receipt) throw new Error("Upload receipt is missing.");
  const response = await postBeiweV1Async("upload", user, data);
  // A 2xx or count alone does not authorize removing local pending data.
  if (
    !response ||
    response.protocol !== "wellping-v1" ||
    response.receipt !== data.receipt
  ) {
    throw new Error(
      "Upload was not acknowledged. Responses remain on this device.",
    );
  }
  return response;
}

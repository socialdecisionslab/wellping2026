import { clearAllAnswersAsync } from "./answers";
import { clearAllPingStatesAsync } from "./asyncStorage/pingState";
import { clearAllPingsAsync } from "./pings";

export async function clearAllPingsAndAnswersAsync(): Promise<void> {
  await clearAllPingStatesAsync();
  await clearAllAnswersAsync();
  await clearAllPingsAsync();
}

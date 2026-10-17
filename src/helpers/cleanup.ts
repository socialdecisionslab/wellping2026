import { clearAllPingStatesAsync } from "./asyncStorage/pingState";
import { clearAllAnswersAsync } from "./answers";
import { clearAllPingsAsync } from "./pings";

export async function clearAllPingsAndAnswersAsync(): Promise<void> {
  await clearAllPingStatesAsync();
  await clearAllAnswersAsync();
  await clearAllPingsAsync();
}

import { IS_LOCAL_DEVELOPMENT } from "../config/local";

if (IS_LOCAL_DEVELOPMENT) {
  global.fetch = async () => {
    throw new Error("Network requests are disabled in the synthetic test app.");
  };
}

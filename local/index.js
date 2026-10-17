// This entry is selected only by `yarn start:local`, never by the normal app.
require("../src/helpers/global");
const Constants = require("expo-constants").default;
if (Constants.manifest?.extra?.wellpingLocalOnly !== true) {
  throw new Error(
    "The synthetic runner requires the isolated local configuration.",
  );
}

// The synthetic screen uses no HTTP services. Fail closed if code adds one.
global.fetch = async () => {
  throw new Error("Network requests are disabled in the synthetic runner.");
};
const { registerRootComponent } = require("expo");
registerRootComponent(require("./LocalApp").default);

const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
const localOnly = process.env.WELLPING_LOCAL_ONLY === "1";
// Keep enrollment/backend modules out of the synthetic application graph.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    localOnly &&
    context.originModulePath === path.join(__dirname, "index.js") &&
    moduleName === "./App"
  ) {
    return context.resolveRequest(context, "./local/LocalApp", platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;

module.exports = function (api) {
  const production = api.env("production");
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ...(production
        ? [require.resolve("./scripts/babel-strip-console.cjs")]
        : []),
      "babel-plugin-transform-typescript-metadata", // Previously for Typeorm, but keep it here just to be safe.
    ],
  };
};

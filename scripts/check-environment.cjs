const expected = require("../package.json").engines.node;

if (process.versions.node !== expected) {
  console.error(
    `This workspace requires Node ${expected}; found ${process.versions.node}. ` +
      "Run `nvm install && nvm use`, then retry. See docs/local-development.md.",
  );
  process.exit(1);
}

console.log(`Node ${expected}; Corepack-pinned Yarn 4.18.1.`);

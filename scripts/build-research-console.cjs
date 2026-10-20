// Reuse the app's export validator; do not maintain a weaker dashboard parser.
const fs = require("node:fs");
const ts = require("typescript");
fs.mkdirSync(".research-console-build", { recursive: true });
for (const name of ["researchExport", "networkSafety"])
  fs.writeFileSync(
    `.research-console-build/${name}.cjs`,
    ts.transpileModule(fs.readFileSync(`src/helpers/${name}.ts`, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: false,
      },
    }).outputText,
  );

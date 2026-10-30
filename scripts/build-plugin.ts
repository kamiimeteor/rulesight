import { chmod, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const bundle = root("../plugin/bin/rulesight.mjs");
const template = root("../plugin/assets/report-template.html");

await mkdir(root("../plugin/bin"), { recursive: true });
await mkdir(root("../plugin/assets"), { recursive: true });

await build({
  entryPoints: [root("../src/cli.ts")],
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "node",
  // Users only need Node 18+; nothing newer may be emitted.
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});
await chmod(bundle, 0o755);

// The bundle looks the template up as ../assets/report-template.html relative to itself.
await copyFile(root("../report/dist/index.html"), template);
console.log(`模板：${template}`);

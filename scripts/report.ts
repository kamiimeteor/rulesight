import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseReportData, slimForReport } from "../src/report.ts";
import { renderReportHtml } from "../src/report-html.ts";

const USAGE = "node scripts/report.ts <verdicts.json> <steps.json> [--out <path>]";
const TEMPLATE = fileURLToPath(new URL("../report/dist/index.html", import.meta.url));

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
const [verdictsFile, stepsFile] = positionals;
if (verdictsFile === undefined || stepsFile === undefined || positionals.length > 2) {
  console.error(`用法：${USAGE}`);
  process.exit(2);
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`读不了 ${file}：${error instanceof Error ? error.message : String(error)}`);
  }
}

let template: string;
try {
  template = await readFile(TEMPLATE, "utf8");
} catch {
  console.error("找不到 report/dist/index.html，先运行 npm run build:report");
  process.exit(1);
}
try {
  const data = slimForReport(parseReportData({ session: await readJson(stepsFile), verdicts: await readJson(verdictsFile) }));
  const html = renderReportHtml(template, data);
  // Named after the verdicts file, so a ranged run's report does not overwrite the full run's.
  const defaultName = path.basename(verdictsFile).replace(/\.verdicts\.json$/, "") + ".report.html";
  const outFile = path.resolve(values.out ?? path.join("private/out", defaultName));
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
  console.log(`写入 ${path.relative(process.cwd(), outFile)}（${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB）`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

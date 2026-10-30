import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildPlan,
  CONCURRENCY,
  CONFIRM_ABOVE_SEGMENTS,
  displayPath,
  judgePlan,
  parseMaxChars,
  parseTimeBound,
  rangeLabel,
} from "../src/pipeline.ts";
import { parseRules } from "../src/rules.ts";
import { parseSession } from "../src/steps.ts";
import { VERDICT_KINDS, type SegmentRecord } from "../src/verdict.ts";

const USAGE =
  "node scripts/judge.ts <steps.json> --rules <path> [--model sonnet] [--from <ISO>] [--to <ISO>] [--max-chars N] [--dry-run] [--yes]";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rules: { type: "string" },
    model: { type: "string", default: "sonnet" },
    from: { type: "string" },
    to: { type: "string" },
    "max-chars": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});
const [stepsFile] = positionals;
if (stepsFile === undefined || positionals.length > 1 || values.rules === undefined) {
  console.error(`用法：${USAGE}`);
  process.exit(2);
}

function usageError(message: string): never {
  console.error(message);
  process.exit(2);
}

function parseOrExit<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error));
  }
}

const fromMs = parseOrExit(() => parseTimeBound("from", values.from));
const toMs = parseOrExit(() => parseTimeBound("to", values.to));
const maxChars = parseOrExit(() => parseMaxChars(values["max-chars"]));

const fullSession = parseSession(JSON.parse(await readFile(stepsFile, "utf8")));
const rulesFile = path.resolve(values.rules);
const rules = parseRules(await readFile(rulesFile, "utf8"), displayPath(rulesFile));
if (rules.length === 0) {
  console.error(`${displayPath(rulesFile)} 里没有解析出规则`);
  process.exit(1);
}

let plan;
try {
  plan = buildPlan({ fullSession, rules, fromMs, toMs, maxChars });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const { session, ranged, segments, promptChars, totalChars, estimatedCostUsd, estimatedMinutes } = plan;

console.log(`会话 ${session.sessionId}：${fullSession.steps.length} 步${ranged ? `，时间范围内 ${session.steps.length} 步` : ""}`);
console.log(`规则 ${rules.length} 条，来自 ${displayPath(rulesFile)}`);
console.log(`切成 ${segments.length} 段（每段步骤内容不超过 ${maxChars} 字，最大一段提示词 ${Math.max(...promptChars)} 字）`);
console.log(`提示词总字数 ${totalChars}（每段都带规则和系统提示）`);
console.log(`估算费用约 $${estimatedCostUsd.toFixed(2)}（粗估：每 100 万字 $3）`);
console.log(`估算用时约 ${estimatedMinutes.toFixed(0)} 分钟（粗估：每段约 60 秒，${CONCURRENCY} 段并行）`);

if (values["dry-run"]) {
  console.log("dry run：没有调用模型");
  process.exit(0);
}
if (segments.length > CONFIRM_ABOVE_SEGMENTS && !values.yes) {
  console.log(`超过 ${CONFIRM_ABOVE_SEGMENTS} 段，确认后加 --yes 再运行`);
  process.exit(0);
}

function countKinds(record: SegmentRecord): string {
  return VERDICT_KINDS.map((kind) => `${kind} ${record.verdicts.filter((verdict) => verdict.verdict === kind).length}`).join("，");
}

const model = values.model;
const result = await judgePlan({
  plan,
  rules,
  rulesFile: displayPath(rulesFile),
  model,
  onSegmentDone: (record) => {
    const head = `第 ${record.index}/${segments.length} 段（步骤 ${record.firstStep}–${record.lastStep}）`;
    if (record.status === "failed") console.log(`${head} 没判成：${record.error}`);
    else console.log(`${head} 完成：${countKinds(record)}，被拒 ${record.rejected.length}，$${record.costUsd.toFixed(4)}，${(record.durationMs / 1000).toFixed(1)} 秒`);
  },
});
const { verdicts, rejected, missingRuleIds } = result;
const records = result.segments;
const failed = records.filter((record) => record.status === "failed");

const outFile = path.resolve("private/out", `${session.sessionId}${rangeLabel(values.from, values.to)}.verdicts.json`);
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);

console.log(`写入 ${path.relative(process.cwd(), outFile)}`);
for (const kind of VERDICT_KINDS) {
  console.log(`  ${kind}: ${verdicts.filter((verdict) => verdict.verdict === kind).length}`);
}
console.log(`被拒绝的判定: ${rejected.length}`);
for (const { ruleId, reason } of rejected) console.log(`  ${ruleId ?? "?"}: ${reason}`);
console.log(`没有判定的规则: ${missingRuleIds.length}${missingRuleIds.length > 0 ? `（${missingRuleIds.join(", ")}）` : ""}`);
console.log(`费用 $${result.costUsd.toFixed(4)}，${result.turns} 轮，各段用时合计 ${(result.durationMs / 1000).toFixed(1)} 秒`);
if (failed.length > 0) {
  console.log(`有 ${failed.length} 段没判成（第 ${failed.map((record) => record.index).join("、")} 段），这份结果不完整`);
}
if (failed.length === records.length) process.exit(1);

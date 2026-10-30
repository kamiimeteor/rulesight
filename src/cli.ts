import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readClaudeCodeSession } from "./adapters/claude-code.ts";
import { buildPlan, collectRules, CONFIRM_ABOVE_SEGMENTS, displayPath, judgePlan, parseTimeBound, rangeLabel, type Plan, type RuleSet } from "./pipeline.ts";
import { parseReportData, slimForReport } from "./report.ts";
import { renderReportHtml } from "./report-html.ts";
import type { Session } from "./steps.ts";
import type { VerdictKind } from "./verdict.ts";

const USAGE = `用法：
  rulesight plan --session <id> [--cwd <dir>] [--from <日期>] [--to <日期>]
  rulesight run  --session <id> [--cwd <dir>] [--from <日期>] [--to <日期>] [--yes] [--out-dir <dir>] [--model sonnet]`;

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_NEEDS_CONFIRM = 3;
const VERDICT_LABEL: Record<VerdictKind, string> = { violated: "违反", followed: "遵守", not_applicable: "不适用" };
// The id becomes part of a path (a file name under the projects folder and under the report folder).
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

// Templates are looked up next to the bundle (plugin/assets) first, then at the dev build output (report/dist).
const TEMPLATE_CANDIDATES = [new URL("../assets/report-template.html", import.meta.url), new URL("../report/dist/index.html", import.meta.url)];

class CliError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = EXIT_FAILED) {
    super(message);
    this.exitCode = exitCode;
  }
}

interface Options {
  session: string;
  cwd: string | undefined;
  projectsDir: string | undefined;
  from: string | undefined;
  to: string | undefined;
  yes: boolean;
  outDir: string | undefined;
  model: string;
}

function parseOptions(argv: readonly string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: {
        session: { type: "string" },
        cwd: { type: "string" },
        "projects-dir": { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        yes: { type: "boolean" },
        "out-dir": { type: "string" },
        model: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`, EXIT_USAGE);
  }
  const { values } = parsed;
  if (values.session === undefined) throw new CliError(`缺少 --session\n${USAGE}`, EXIT_USAGE);
  if (!SESSION_ID.test(values.session)) throw new CliError(`--session 不是有效的会话 ID：${values.session}`, EXIT_USAGE);
  return {
    session: values.session,
    cwd: values.cwd === undefined ? undefined : path.resolve(values.cwd),
    // RULESIGHT_PROJECTS_DIR is a dev-only override so the skill's command line stays unchanged when testing against a copy of ~/.claude/projects.
    projectsDir: values["projects-dir"] ?? (process.env.RULESIGHT_PROJECTS_DIR || undefined),
    from: values.from,
    to: values.to,
    yes: values.yes ?? false,
    outDir: values["out-dir"],
    // parseArgs `default` needs Node 18.11, so the defaults live here.
    model: values.model ?? "sonnet",
  };
}

function bound(flag: "from" | "to", text: string | undefined): number | undefined {
  try {
    return parseTimeBound(flag, text);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), EXIT_USAGE);
  }
}

interface Prepared {
  options: Options;
  fullSession: Session;
  ruleSet: RuleSet;
  plan: Plan;
}

async function prepare(argv: readonly string[]): Promise<Prepared> {
  const options = parseOptions(argv);
  const fromMs = bound("from", options.from);
  const toMs = bound("to", options.to);
  let fullSession: Session;
  try {
    ({ session: fullSession } = await readClaudeCodeSession(options.session, { projectsDir: options.projectsDir }));
  } catch (error) {
    throw new CliError(`读不了这个会话：${error instanceof Error ? error.message : String(error)}`);
  }
  // The session's own project, not the folder this process happens to run in.
  const ruleSet = await collectRules(options.cwd ?? fullSession.cwd);
  if (ruleSet.rules.length === 0) {
    const where = ruleSet.files.length > 0 ? `${ruleSet.files.map((file) => file.displayPath).join("、")} 里没有解析出规则` : `没有找到规则文件，找过：${ruleSet.missing.join("、")}`;
    throw new CliError(`${where}。Rulesight 要对照你写给 Claude 的规则（CLAUDE.md）来检查，先写几条规则再来。`);
  }
  try {
    const plan = buildPlan({ fullSession, rules: ruleSet.rules, fromMs, toMs });
    return { options, fullSession, ruleSet, plan };
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

function needsConfirm(plan: Plan): boolean {
  return plan.segments.length > CONFIRM_ABOVE_SEGMENTS;
}

function printPlan({ fullSession, ruleSet, plan }: Prepared): void {
  const { session, ranged, segments, estimatedCostUsd, estimatedMinutes } = plan;
  console.log(`会话 ${session.sessionId}：${fullSession.steps.length} 步${ranged ? `，时间范围内 ${session.steps.length} 步` : ""}`);
  console.log(`规则 ${ruleSet.rules.length} 条：${ruleSet.files.map((file) => `${file.displayPath}（${file.count} 条）`).join("；")}`);
  if (ruleSet.missing.length > 0) console.log(`没找到、已跳过：${ruleSet.missing.join("、")}`);
  console.log(`要分 ${segments.length} 段判定，估算费用约 $${estimatedCostUsd.toFixed(2)}，用时约 ${Math.max(1, Math.round(estimatedMinutes))} 分钟（费用按接口价格折算，实际走你自己的 Claude 额度）`);
  console.log(`RULESIGHT_PLAN ${JSON.stringify({ segments: segments.length, needsConfirm: needsConfirm(plan) })}`);
}

async function readTemplate(): Promise<string> {
  for (const url of TEMPLATE_CANDIDATES) {
    try {
      return await readFile(fileURLToPath(url), "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  throw new CliError("找不到报告模板（assets/report-template.html）。插件文件不完整，请重新安装。");
}

function defaultOutDir(): string {
  const data = process.env.CLAUDE_PLUGIN_DATA;
  return data ? path.join(data, "reports") : path.join(os.homedir(), ".rulesight", "reports");
}

async function planCommand(argv: readonly string[]): Promise<void> {
  printPlan(await prepare(argv));
}

async function runCommand(argv: readonly string[]): Promise<void> {
  const prepared = await prepare(argv);
  const { options, fullSession, ruleSet, plan } = prepared;
  printPlan(prepared);
  if (needsConfirm(plan) && !options.yes) {
    console.log(`需要确认：超过 ${CONFIRM_ABOVE_SEGMENTS} 段，要用较多额度和时间。确认后加 --yes 再运行。`);
    process.exitCode = EXIT_NEEDS_CONFIRM;
    return;
  }

  const { segments } = plan;
  const verdicts = await judgePlan({
    plan: plan,
    rules: ruleSet.rules,
    rulesFile: ruleSet.files.map((file) => file.displayPath).join("、"),
    model: options.model,
    onSegmentDone: (record) => {
      const head = `第 ${record.index}/${segments.length} 段`;
      console.log(record.status === "failed" ? `${head} 没判成：${record.error}` : `${head} 完成`);
    },
  });
  const failed = verdicts.segments.filter((record) => record.status === "failed");
  if (failed.length === verdicts.segments.length) {
    throw new CliError(`所有 ${failed.length} 段都没判成，没有生成报告。第一段的原因：${failed[0]?.status === "failed" ? failed[0].error : "未知"}`);
  }

  const outDir = path.resolve(options.outDir ?? defaultOutDir());
  await mkdir(outDir, { recursive: true });
  const base = path.join(outDir, `${fullSession.sessionId}${rangeLabel(options.from, options.to)}`);
  const verdictsFile = `${base}.verdicts.json`;
  const reportFile = `${base}.report.html`;
  await writeFile(verdictsFile, `${JSON.stringify(verdicts, null, 2)}\n`);
  // The steps go straight into the report from memory: a long session's steps file runs to hundreds of MB.
  const html = renderReportHtml(await readTemplate(), slimForReport(parseReportData({ session: fullSession, verdicts })));
  await writeFile(reportFile, html);

  const counts = (["violated", "followed", "not_applicable"] as const).map((kind) => `${VERDICT_LABEL[kind]} ${verdicts.verdicts.filter((verdict) => verdict.verdict === kind).length}`);
  console.log(`判定完成（${ruleSet.rules.length} 条规则）：${counts.join("，")}`);
  if (verdicts.missingRuleIds.length > 0) console.log(`有 ${verdicts.missingRuleIds.length} 条规则没有拿到判定：${verdicts.missingRuleIds.join("、")}`);
  if (failed.length > 0) console.log(`注意：有 ${failed.length} 段没判成（第 ${failed.map((record) => record.index).join("、")} 段），这份结果不完整`);
  console.log(`实际花费 $${verdicts.costUsd.toFixed(2)}，各段用时合计 ${(verdicts.durationMs / 1000).toFixed(0)} 秒`);
  console.log(`判定文件：${displayPath(verdictsFile)}`);
  console.log(`RULESIGHT_REPORT ${reportFile}`);
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "plan") await planCommand(rest);
  else if (command === "run") await runCommand(rest);
  else throw new CliError(USAGE, EXIT_USAGE);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
  } else {
    console.error(`出错了：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = EXIT_FAILED;
  }
}

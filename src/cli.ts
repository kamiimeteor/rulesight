import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readClaudeCodeSession } from "./adapters/claude-code.ts";
import { detectLang, LANGS, parseLang, sessionLang, type Lang } from "./lang.ts";
import { beforeLastInvocation, buildPlan, collectRules, CONFIRM_ABOVE_SEGMENTS, displayPath, judgePlan, parseTimeBound, rangeLabel, type Plan, type RuleSet } from "./pipeline.ts";
import { parseReportData, slimForReport } from "./report.ts";
import { renderReportHtml } from "./report-html.ts";
import type { Session, Step } from "./steps.ts";
import type { VerdictKind } from "./verdict.ts";

// Every line the CLI prints, per output language. RULESIGHT_PLAN / RULESIGHT_REPORT markers stay the same in both.
const MESSAGES = {
  zh: {
    usage: `用法：
  rulesight plan --session <id> [--cwd <dir>] [--from <日期>] [--to <日期>] [--lang en|zh]
  rulesight run  --session <id> [--cwd <dir>] [--from <日期>] [--to <日期>] [--yes] [--out-dir <dir>] [--model sonnet] [--lang en|zh]`,
    verdictLabel: { violated: "违反", followed: "遵守", not_applicable: "不适用" } satisfies Record<VerdictKind, string>,
    missingSession: "缺少 --session",
    badSession: (id: string) => `--session 不是有效的会话 ID：${id}`,
    badLang: (text: string) => `--lang 只能是 ${LANGS.join(" 或 ")}：${text}`,
    cantRead: (detail: string) => `读不了这个会话：${detail}`,
    noRulesIn: (files: string) => `${files} 里没有解析出规则`,
    noRuleFiles: (looked: string) => `没有找到规则文件，找过：${looked}`,
    writeRules: (where: string) => `${where}。Rulesight 要对照你写给 Claude 的规则（CLAUDE.md）来检查，先写几条规则再来。`,
    list: "、",
    sessionLine: (id: string, total: number, inRange: number | null) => `会话 ${id}：${total} 步${inRange === null ? "" : `，时间范围内 ${inRange} 步`}`,
    rulesLine: (count: number, files: string) => `规则 ${count} 条：${files}`,
    ruleFile: (file: string, count: number) => `${file}（${count} 条）`,
    ruleFileSeparator: "；",
    skipped: (files: string) => `没找到、已跳过：${files}`,
    skippedBySetting: (files: string) => `按 ~/.rulesight/skip.txt 没有检查：${files}`,
    brokenImports: (files: string) => `规则里 @ 引用的文件找不到：${files}`,
    estimate: (segments: number, usd: string, minutes: number) =>
      `要分 ${segments} 段判定，估算费用约 $${usd}，用时约 ${minutes} 分钟（费用按接口价格折算，实际走你自己的 Claude 额度）`,
    noTemplate: "找不到报告模板（assets/report-template.html）。插件文件不完整，请重新安装。",
    needsConfirm: (limit: number) => `需要确认：超过 ${limit} 段，要用较多额度和时间。确认后加 --yes 再运行。`,
    segmentHead: (index: number, total: number) => `第 ${index}/${total} 段`,
    segmentFailed: (head: string, error: string) => `${head} 没判成：${error}`,
    segmentDone: (head: string) => `${head} 完成`,
    allFailed: (count: number, reason: string) => `所有 ${count} 段都没判成，没有生成报告。第一段的原因：${reason}`,
    unknown: "未知",
    countsSeparator: "，",
    done: (rules: number, counts: string) => `判定完成（${rules} 条规则）：${counts}`,
    missingVerdicts: (count: number, ids: string) => `有 ${count} 条规则没有拿到判定：${ids}`,
    partial: (count: number, indexes: string) => `注意：有 ${count} 段没判成（第 ${indexes} 段），这份结果不完整`,
    cost: (usd: string, seconds: string) => `实际花费 $${usd}，各段用时合计 ${seconds} 秒`,
    verdictsFile: (file: string) => `判定文件：${file}`,
    crashed: (detail: string) => `出错了：${detail}`,
    excludedSelf: (count: number) => `不检查 Rulesight 自己运行的 ${count} 步（从最后一次输入 /rulesight 开始）`,
    nothingBefore: "这场会话在输入 /rulesight 之前还没有可以检查的内容。先正常让 Claude 做点事，再运行 /rulesight:rulesight。",
    outDirFallback: (wanted: string, used: string) => `报告目录 ${wanted} 写不进去（可能被沙盒挡住了），改存到 ${used}`,
    noOutDir: (wanted: string, detail: string) => `报告目录 ${wanted} 和临时目录都写不进去，没有开始判定：${detail}`,
  },
  en: {
    usage: `Usage:
  rulesight plan --session <id> [--cwd <dir>] [--from <date>] [--to <date>] [--lang en|zh]
  rulesight run  --session <id> [--cwd <dir>] [--from <date>] [--to <date>] [--yes] [--out-dir <dir>] [--model sonnet] [--lang en|zh]`,
    verdictLabel: { violated: "violated", followed: "followed", not_applicable: "not applicable" } satisfies Record<VerdictKind, string>,
    missingSession: "Missing --session",
    badSession: (id: string) => `--session is not a valid session ID: ${id}`,
    badLang: (text: string) => `--lang must be ${LANGS.join(" or ")}: ${text}`,
    cantRead: (detail: string) => `Can't read this session: ${detail}`,
    noRulesIn: (files: string) => `No rules found in ${files}`,
    noRuleFiles: (looked: string) => `No rule file found; looked for ${looked}`,
    writeRules: (where: string) => `${where}. Rulesight checks a session against the rules you wrote for Claude (CLAUDE.md); add a few rules first.`,
    list: ", ",
    sessionLine: (id: string, total: number, inRange: number | null) => `Session ${id}: ${total} steps${inRange === null ? "" : `, ${inRange} in the time range`}`,
    rulesLine: (count: number, files: string) => `${count} rules: ${files}`,
    ruleFile: (file: string, count: number) => `${file} (${count})`,
    ruleFileSeparator: "; ",
    skipped: (files: string) => `Not found, skipped: ${files}`,
    skippedBySetting: (files: string) => `Not checked, listed in ~/.rulesight/skip.txt: ${files}`,
    brokenImports: (files: string) => `Files @imported by your rules that aren't there: ${files}`,
    estimate: (segments: number, usd: string, minutes: number) =>
      `Judging in ${segments} segment${segments === 1 ? "" : "s"}, estimated cost about $${usd}, about ${minutes} min (cost at API prices; it actually uses your own Claude plan)`,
    noTemplate: "Can't find the report template (assets/report-template.html). The plugin files are incomplete; please reinstall.",
    needsConfirm: (limit: number) => `Confirmation needed: more than ${limit} segments uses a lot of quota and time. Run again with --yes to go ahead.`,
    segmentHead: (index: number, total: number) => `Segment ${index}/${total}`,
    segmentFailed: (head: string, error: string) => `${head} failed: ${error}`,
    segmentDone: (head: string) => `${head} done`,
    allFailed: (count: number, reason: string) => `All ${count} segments failed, so no report was made. First segment's reason: ${reason}`,
    unknown: "unknown",
    countsSeparator: ", ",
    done: (rules: number, counts: string) => `Judged ${rules} rules: ${counts}`,
    missingVerdicts: (count: number, ids: string) => `${count} rules got no verdict: ${ids}`,
    partial: (count: number, indexes: string) => `Note: ${count} segments failed (segment ${indexes}); these results are incomplete`,
    cost: (usd: string, seconds: string) => `Actual cost $${usd}, ${seconds} s across segments`,
    verdictsFile: (file: string) => `Verdicts file: ${file}`,
    crashed: (detail: string) => `Something went wrong: ${detail}`,
    excludedSelf: (count: number) => `Not checking Rulesight's own run: ${count} steps from the last /rulesight on`,
    nothingBefore: "Nothing in this session to check before /rulesight was typed. Use Claude for something first, then run /rulesight:rulesight.",
    outDirFallback: (wanted: string, used: string) => `Can't write to the report folder ${wanted} (a sandbox may be blocking it); saving to ${used} instead`,
    noOutDir: (wanted: string, detail: string) => `Can't write to the report folder ${wanted} or the temp folder, so judging didn't start: ${detail}`,
  },
} as const;

type Messages = (typeof MESSAGES)[Lang];

// Read before full argument parsing, so even a usage error comes out in the chosen language.
function langFlag(argv: readonly string[]): string | undefined {
  for (const [i, arg] of argv.entries()) {
    if (arg === "--lang") return argv[i + 1] ?? "";
    if (arg.startsWith("--lang=")) return arg.slice("--lang=".length);
  }
  return undefined;
}

// --lang wins; otherwise RULESIGHT_LANG, then the session's own language, then the system locale (see lang.ts).
// Until the session is read, `lang` is the guess without it; `explicit` says the user chose and the session can't override.
function resolveLang(argv: readonly string[]): { lang: Lang; badFlag: string | undefined; explicit: boolean } {
  const flag = langFlag(argv);
  const lang = flag === undefined ? undefined : parseLang(flag);
  if (lang !== undefined) return { lang, badFlag: undefined, explicit: true };
  return { lang: detectLang(), badFlag: flag, explicit: parseLang(process.env.RULESIGHT_LANG) !== undefined };
}

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_NEEDS_CONFIRM = 3;
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
  lang: Lang;
}

function parseOptions(argv: readonly string[], lang: Lang): Options {
  const m = MESSAGES[lang];
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
        lang: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(`${error instanceof Error ? error.message : String(error)}\n${m.usage}`, EXIT_USAGE);
  }
  const { values } = parsed;
  if (values.session === undefined) throw new CliError(`${m.missingSession}\n${m.usage}`, EXIT_USAGE);
  if (!SESSION_ID.test(values.session)) throw new CliError(m.badSession(values.session), EXIT_USAGE);
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
    lang,
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
  lang: Lang;
  options: Options;
  fullSession: Session;
  excluded: number;
  ruleSet: RuleSet;
  plan: Plan;
}

async function prepare(argv: readonly string[], guess: Lang, explicit: boolean): Promise<Prepared> {
  const options = parseOptions(argv, guess);
  const fromMs = bound("from", options.from);
  const toMs = bound("to", options.to);
  const pickLang = explicit ? undefined : (steps: readonly Step[]) => detectLang({ sessionLang: sessionLang(steps) });
  let read: Session;
  let lang: Lang;
  try {
    ({ session: read, lang } = await readClaudeCodeSession(options.session, { projectsDir: options.projectsDir, lang: guess, pickLang }));
  } catch (error) {
    throw new CliError(MESSAGES[guess].cantRead(error instanceof Error ? error.message : String(error)));
  }
  const m = MESSAGES[lang];
  const { session: fullSession, excluded } = beforeLastInvocation(read);
  if (fullSession.steps.length === 0) throw new CliError(m.nothingBefore);
  // The session's own project, not the folder this process happens to run in.
  const ruleSet = await collectRules(options.cwd ?? fullSession.cwd, lang);
  if (ruleSet.rules.length === 0) {
    const where =
      ruleSet.files.length > 0 ? m.noRulesIn(ruleSet.files.map((file) => file.displayPath).join(m.list)) : m.noRuleFiles(ruleSet.missing.join(m.list));
    throw new CliError(m.writeRules(where));
  }
  try {
    const plan = buildPlan({ fullSession, rules: ruleSet.rules, fromMs, toMs, lang });
    return { lang, options, fullSession, excluded, ruleSet, plan };
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

function needsConfirm(plan: Plan): boolean {
  return plan.segments.length > CONFIRM_ABOVE_SEGMENTS;
}

function printPlan({ fullSession, excluded, ruleSet, plan }: Prepared, m: Messages): void {
  const { session, ranged, segments, estimatedCostUsd, estimatedMinutes } = plan;
  console.log(m.sessionLine(session.sessionId, fullSession.steps.length, ranged ? session.steps.length : null));
  if (excluded > 0) console.log(m.excludedSelf(excluded));
  console.log(m.rulesLine(ruleSet.rules.length, ruleSet.files.map((file) => m.ruleFile(file.displayPath, file.count)).join(m.ruleFileSeparator)));
  if (ruleSet.missing.length > 0) console.log(m.skipped(ruleSet.missing.join(m.list)));
  if (ruleSet.skipped.length > 0) console.log(m.skippedBySetting(ruleSet.skipped.map((file) => m.ruleFile(file.displayPath, file.count)).join(m.ruleFileSeparator)));
  if (ruleSet.brokenImports.length > 0) console.log(m.brokenImports(ruleSet.brokenImports.join(m.list)));
  console.log(m.estimate(segments.length, estimatedCostUsd.toFixed(2), Math.max(1, Math.round(estimatedMinutes))));
  console.log(`RULESIGHT_PLAN ${JSON.stringify({ segments: segments.length, needsConfirm: needsConfirm(plan) })}`);
}

async function readTemplate(m: Messages): Promise<string> {
  for (const url of TEMPLATE_CANDIDATES) {
    try {
      return await readFile(fileURLToPath(url), "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  throw new CliError(m.noTemplate);
}

// Checked before judging: a sandbox that blocks the report folder used to surface only after the quota was spent.
async function writableOutDir(wanted: string, m: Messages): Promise<string> {
  const tryDir = async (dir: string) => {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.rulesight-write-check-${process.pid}`);
    await writeFile(probe, "");
    await rm(probe, { force: true });
  };
  try {
    await tryDir(wanted);
    return wanted;
  } catch (error) {
    const fallback = path.join(os.tmpdir(), "rulesight-reports");
    try {
      await tryDir(fallback);
    } catch {
      throw new CliError(m.noOutDir(wanted, error instanceof Error ? error.message : String(error)));
    }
    console.log(m.outDirFallback(wanted, fallback));
    return fallback;
  }
}

function defaultOutDir(): string {
  const data = process.env.CLAUDE_PLUGIN_DATA;
  return data ? path.join(data, "reports") : path.join(os.homedir(), ".rulesight", "reports");
}

async function planCommand(argv: readonly string[], guess: Lang, explicit: boolean): Promise<void> {
  const prepared = await prepare(argv, guess, explicit);
  printPlan(prepared, MESSAGES[prepared.lang]);
}

async function runCommand(argv: readonly string[], guess: Lang, explicit: boolean): Promise<void> {
  const prepared = await prepare(argv, guess, explicit);
  const { lang, options, fullSession, ruleSet, plan } = prepared;
  const m = MESSAGES[lang];
  printPlan(prepared, m);
  if (needsConfirm(plan) && !options.yes) {
    console.log(m.needsConfirm(CONFIRM_ABOVE_SEGMENTS));
    process.exitCode = EXIT_NEEDS_CONFIRM;
    return;
  }

  const outDir = await writableOutDir(path.resolve(options.outDir ?? defaultOutDir()), m);
  const { segments } = plan;
  const verdicts = await judgePlan({
    plan: plan,
    rules: ruleSet.rules,
    rulesFile: ruleSet.files.map((file) => file.displayPath).join(m.list),
    model: options.model,
    onSegmentDone: (record) => {
      const head = m.segmentHead(record.index, segments.length);
      console.log(record.status === "failed" ? m.segmentFailed(head, record.error) : m.segmentDone(head));
    },
  });
  const failed = verdicts.segments.filter((record) => record.status === "failed");
  if (failed.length === verdicts.segments.length) {
    throw new CliError(m.allFailed(failed.length, failed[0]?.status === "failed" ? failed[0].error : m.unknown));
  }

  const base = path.join(outDir, `${fullSession.sessionId}${rangeLabel(options.from, options.to)}`);
  const verdictsFile = `${base}.verdicts.json`;
  const reportFile = `${base}.report.html`;
  await writeFile(verdictsFile, `${JSON.stringify(verdicts, null, 2)}\n`);
  // The steps go straight into the report from memory: a long session's steps file runs to hundreds of MB.
  const html = renderReportHtml(await readTemplate(m), slimForReport(parseReportData({ session: fullSession, verdicts })));
  await writeFile(reportFile, html);

  const counts = (["violated", "followed", "not_applicable"] as const).map((kind) => `${m.verdictLabel[kind]} ${verdicts.verdicts.filter((verdict) => verdict.verdict === kind).length}`);
  console.log(m.done(ruleSet.rules.length, counts.join(m.countsSeparator)));
  if (verdicts.missingRuleIds.length > 0) console.log(m.missingVerdicts(verdicts.missingRuleIds.length, verdicts.missingRuleIds.join(m.list)));
  if (failed.length > 0) console.log(m.partial(failed.length, failed.map((record) => record.index).join(m.list)));
  console.log(m.cost(verdicts.costUsd.toFixed(2), (verdicts.durationMs / 1000).toFixed(0)));
  console.log(m.verdictsFile(displayPath(verdictsFile)));
  console.log(`RULESIGHT_REPORT ${reportFile}`);
}

async function main(argv: readonly string[], lang: Lang, badFlag: string | undefined, explicit: boolean): Promise<void> {
  const m = MESSAGES[lang];
  if (badFlag !== undefined) throw new CliError(`${m.badLang(badFlag)}\n${m.usage}`, EXIT_USAGE);
  const [command, ...rest] = argv;
  if (command === "plan") await planCommand(rest, lang, explicit);
  else if (command === "run") await runCommand(rest, lang, explicit);
  else throw new CliError(m.usage, EXIT_USAGE);
}

const argv = process.argv.slice(2);
const { lang, badFlag, explicit } = resolveLang(argv);
try {
  await main(argv, lang, badFlag, explicit);
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
  } else {
    console.error(MESSAGES[lang].crashed(error instanceof Error ? error.message : String(error)));
    process.exitCode = EXIT_FAILED;
  }
}

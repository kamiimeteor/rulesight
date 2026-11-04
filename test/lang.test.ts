// Run with `npm test` after `npm run build:plugin`: the CLI tests drive the shipped bundle, not the sources.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readClaudeCodeSession } from "../src/adapters/claude-code.ts";
import { buildJudgePrompt } from "../src/judge.ts";
import { detectLang, parseLang, sessionLang } from "../src/lang.ts";
import { parseRules } from "../src/rules.ts";
import { mergeSegmentVerdicts, parseVerdictsFile, verdictOutputSchema, type SegmentRecord } from "../src/verdict.ts";

const run = promisify(execFile);
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const FIXTURE = here("./fixtures/todo-app");
const BUNDLE = here("../plugin/bin/rulesight.mjs");
const SESSION_ID = "3f9c2a71-5b4e-4d1a-9e2f-7c8b6a0d1e42";

test("parseLang reads plain codes and locales", () => {
  assert.equal(parseLang("en"), "en");
  assert.equal(parseLang("zh_CN.UTF-8"), "zh");
  assert.equal(parseLang("zh-Hans-CN"), "zh");
  assert.equal(parseLang("en_GB.UTF-8"), "en");
  assert.equal(parseLang("EN-us"), "en");
  assert.equal(parseLang("fr_FR.UTF-8"), undefined);
  assert.equal(parseLang("C"), undefined);
  assert.equal(parseLang(""), undefined);
  assert.equal(parseLang(undefined), undefined);
});

test("detectLang: RULESIGHT_LANG, then LC_ALL, LC_MESSAGES, LANG, then Intl, then English", () => {
  const detect = (env: Record<string, string>, intlLocale?: string) => detectLang({ env, intlLocale });
  assert.equal(detect({ RULESIGHT_LANG: "en", LC_ALL: "zh_CN.UTF-8", LANG: "zh_CN.UTF-8" }), "en");
  assert.equal(detect({ RULESIGHT_LANG: "zh", LANG: "en_US.UTF-8" }), "zh");
  assert.equal(detect({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" }), "zh");
  assert.equal(detect({ LC_MESSAGES: "zh_TW.UTF-8", LANG: "en_US.UTF-8" }), "zh");
  assert.equal(detect({ LANG: "zh_CN.UTF-8" }, "en-US"), "zh");
  assert.equal(detect({ LANG: "en_GB.UTF-8" }, "zh-CN"), "en");
  // Unsupported or neutral values fall through instead of forcing English.
  assert.equal(detect({ RULESIGHT_LANG: "fr", LC_ALL: "C", LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(detect({}, "zh-CN"), "zh");
  assert.equal(detect({}, "de-DE"), "en");
  assert.equal(detect({}, undefined), "en");
});

test("detectLang: the session's language comes after RULESIGHT_LANG and before the system locale", () => {
  assert.equal(detectLang({ env: { LANG: "en_GB.UTF-8" }, sessionLang: "zh", intlLocale: "en-GB" }), "zh");
  assert.equal(detectLang({ env: { LANG: "zh_CN.UTF-8" }, sessionLang: "en" }), "en");
  assert.equal(detectLang({ env: { RULESIGHT_LANG: "en", LANG: "zh_CN.UTF-8" }, sessionLang: "zh" }), "en");
  assert.equal(detectLang({ env: { LANG: "zh_CN.UTF-8" }, sessionLang: undefined }), "zh");
});

test("sessionLang counts the user's own messages in the main session", () => {
  const step = (text: string, agent = "main", kind: "user_message" | "agent_message" = "user_message") =>
    ({ n: "1", kind, agent, summary: "", text, tool: null, parentStep: null, at: null, raw: [] });
  assert.equal(sessionLang([step("帮我把测试跑一遍"), step("ok")]), "zh");
  assert.equal(sessionLang([step("Run the tests"), step("then commit"), step("好的")]), "en");
  // Code, links, a sub-agent's prompt and Claude's own replies don't vote.
  assert.equal(sessionLang([step("`npm test` https://example.com"), step("用中文", "agent-1"), step("Sure", "main", "agent_message")]), undefined);
  assert.equal(sessionLang([step("テストを実行して")]), "en");
  // A slash command's name and shell commands the user typed don't vote; the text after a command does.
  assert.equal(sessionLang([step("/rulesight:rulesight 读一下 README"), step("/rulesight:rulesight"), step('<bash-input>open "a.html"</bash-input>')]), "zh");
  assert.equal(sessionLang([step("/compact"), step("<bash-input>ls</bash-input><bash-stdout>README.md</bash-stdout>")]), undefined);
  assert.equal(sessionLang([]), undefined);
});

async function fixtureSession(lang: "en" | "zh") {
  const projects = await mkdtemp(path.join(os.tmpdir(), "rulesight-test-"));
  await mkdir(path.join(projects, "-home-dev-todo-app"));
  await copyFile(path.join(FIXTURE, "session.jsonl"), path.join(projects, "-home-dev-todo-app", `${SESSION_ID}.jsonl`));
  const { session } = await readClaudeCodeSession(SESSION_ID, { projectsDir: projects, lang });
  const rules = parseRules(await readFile(path.join(FIXTURE, "CLAUDE.md"), "utf8"), "~/todo-app/CLAUDE.md");
  return { session, rules };
}

test("Chinese judge prompt and schema match the recorded fixture byte for byte", async () => {
  const expected = JSON.parse(await readFile(path.join(FIXTURE, "expected-zh-prompt.json"), "utf8"));
  const { session, rules } = await fixtureSession("zh");
  const prompt = buildJudgePrompt(session, rules, undefined, "zh");
  assert.equal(prompt.system, expected.system);
  assert.equal(prompt.user, expected.user);
  assert.deepEqual(verdictOutputSchema("zh"), expected.schema);
});

test("English: step summaries, judge prompt and schema ask for English", async () => {
  const { session, rules } = await fixtureSession("en");
  const summaries = session.steps.map((step) => step.summary);
  assert.ok(summaries.includes("Ran tests · pnpm test"));
  assert.ok(summaries.includes("Read file src/types.ts"));
  assert.ok(summaries.some((s) => s.startsWith("User: Add an optional due date")));
  assert.ok(summaries.every((s) => !/[\u4e00-\u9fff]/.test(s)), "no Chinese left in English summaries");
  const prompt = buildJudgePrompt(session, rules, undefined, "en");
  assert.match(prompt.system, /Write all text in English/);
  assert.match(prompt.user, /^# Rules \(7\)/);
  assert.match(prompt.user, /Output \(error\): PreToolUse:Bash hook error/);
  assert.ok(!/[\u4e00-\u9fff]/.test(prompt.system + prompt.user), "no Chinese in the English prompt");
  assert.match(JSON.stringify(verdictOutputSchema("en")), /in English/);
});

test("merged titles and verdict files carry the language", () => {
  const rules = [{ id: "R1", text: "x", section: "", source: { file: "CLAUDE.md", line: 1 } }];
  const steps = ["1", "2"].map((n) => ({ n, kind: "user_message" as const, agent: "main", summary: "", text: "", tool: null, parentStep: null, at: null, raw: [] }));
  const violated = (index: number, n: string): SegmentRecord => ({
    index, firstStep: n, lastStep: n, status: "ok", costUsd: 0, turns: 1, durationMs: 1, rejected: [],
    verdicts: [{ ruleId: "R1", verdict: "violated", title: "Did it", reason: "r", keyStep: n, evidenceSteps: [n], suggestion: "s", fixPrompt: "f" }],
  });
  const segments = [violated(1, "1"), violated(2, "2")];
  assert.equal(mergeSegmentVerdicts(rules, segments, steps, "en").verdicts[0]?.title, "Did it (1 more)");
  assert.equal(mergeSegmentVerdicts(rules, segments, steps).verdicts[0]?.title, "Did it（另有 1 处）");

  const file = { sessionId: "s", model: "m", judgedAt: "t", rulesFile: "CLAUDE.md", rules, verdicts: [], rejected: [], missingRuleIds: ["R1"], segments: [], costUsd: 0, turns: 0, durationMs: 0 };
  assert.equal(parseVerdictsFile({ ...file, lang: "en" }, steps).lang, "en");
  assert.equal(parseVerdictsFile(file, steps).lang, undefined);
  assert.throws(() => parseVerdictsFile({ ...file, lang: "fr" }, steps));
});

// Drives the bundle end to end with a stub in place of `claude -p` that returns fixture verdicts.
// The /rulesight run itself, appended after the fixture: a bare slash command, then Claude running the plugin.
const SESSION_FIELDS = { isSidechain: false, userType: "external", cwd: "/home/dev/todo-app", sessionId: SESSION_ID, version: "2.1.301", gitBranch: "main" };
const RULESIGHT_RUN = [
  { ...SESSION_FIELDS, parentUuid: "cb9be71b-ae3a-53c4-9463-fb4c9985164c", type: "user", uuid: "aa000000-0000-4000-8000-000000000001", timestamp: "2026-10-24T09:30:00.000Z",
    message: { role: "user", content: "<command-name>/rulesight:rulesight</command-name>\n<command-message>rulesight:rulesight</command-message>\n<command-args></command-args>" } },
  { ...SESSION_FIELDS, parentUuid: "aa000000-0000-4000-8000-000000000001", type: "assistant", uuid: "aa000000-0000-4000-8000-000000000002", timestamp: "2026-10-24T09:30:05.000Z",
    message: { role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "text", text: "Running Rulesight on this session." }] } },
].map((entry) => JSON.stringify(entry)).join("\n");

async function runCli(env: Record<string, string>, verdictsFixture: string, extraArgs: string[] = [], options: { appendJsonl?: string; outDir?: (dir: string) => Promise<string> } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rulesight-cli-"));
  const home = path.join(dir, "home");
  const projects = path.join(dir, "projects", "-home-dev-todo-app");
  await mkdir(path.join(home, "todo-app"), { recursive: true });
  await mkdir(projects, { recursive: true });
  await copyFile(path.join(FIXTURE, "CLAUDE.md"), path.join(home, "todo-app", "CLAUDE.md"));
  await copyFile(path.join(FIXTURE, "session.jsonl"), path.join(projects, `${SESSION_ID}.jsonl`));
  if (options.appendJsonl !== undefined) await appendFile(path.join(projects, `${SESSION_ID}.jsonl`), `\n${options.appendJsonl}\n`);
  const outDir = options.outDir === undefined ? path.join(dir, "out") : await options.outDir(dir);
  const stub = path.join(dir, "stub-claude.mjs");
  await writeFile(
    stub,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(dir, "args.json"))}, JSON.stringify(args));
fs.writeFileSync(${JSON.stringify(path.join(dir, "stdin.txt"))}, fs.readFileSync(0));
process.stdout.write(JSON.stringify({ is_error: false, result: "", structured_output: JSON.parse(fs.readFileSync(${JSON.stringify(path.join(FIXTURE, verdictsFixture))}, "utf8")), total_cost_usd: 0, num_turns: 1, duration_ms: 1 }));
`,
  );
  await chmod(stub, 0o755);
  await mkdir(path.join(dir, "tmp"));
  const clean = { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: path.join(dir, "tmp"), RULESIGHT_CLAUDE_BIN: stub };
  const { stdout } = await run(
    process.execPath,
    [BUNDLE, "run", "--session", SESSION_ID, "--projects-dir", path.dirname(projects), "--cwd", path.join(home, "todo-app"), "--out-dir", outDir, ...extraArgs],
    { env: { ...clean, ...env } },
  );
  const reportFile = /^RULESIGHT_REPORT (.+)$/m.exec(stdout)?.[1] ?? "";
  const html = await readFile(reportFile, "utf8");
  const verdicts = JSON.parse(await readFile(reportFile.replace(/\.report\.html$/, ".verdicts.json"), "utf8"));
  const args: string[] = JSON.parse(await readFile(path.join(dir, "args.json"), "utf8"));
  const user = await readFile(path.join(dir, "stdin.txt"), "utf8");
  return { stdout: stdout.replaceAll(dir, "<dir>"), html, verdicts, args, user, dir };
}

test("RULESIGHT_LANG=zh prints exactly what 7a207fa printed", async () => {
  const { stdout, verdicts } = await runCli({ RULESIGHT_LANG: "zh", LANG: "en_US.UTF-8" }, "verdicts.zh.json");
  const expected = (await readFile(path.join(FIXTURE, "expected-zh-stdout.txt"), "utf8"));
  assert.equal(stdout, expected);
  assert.equal(verdicts.lang, "zh");
});

test("RULESIGHT_LANG=en: English CLI output, English judge prompt, report data marked en", async () => {
  const { stdout, html, verdicts, args } = await runCli({ RULESIGHT_LANG: "en", LANG: "zh_CN.UTF-8" }, "verdicts.en.json");
  assert.match(stdout, /^Session 3f9c2a71-5b4e-4d1a-9e2f-7c8b6a0d1e42: 17 steps$/m);
  assert.match(stdout, /^Judging in 1 segment, estimated cost about \$0\.0\d, about 1 min/m);
  assert.match(stdout, /^RULESIGHT_PLAN \{"segments":1,"needsConfirm":false\}$/m);
  assert.match(stdout, /^Judged 7 rules: violated 1, followed 4, not applicable 2$/m);
  assert.match(stdout, /^RULESIGHT_REPORT .+\.report\.html$/m);
  assert.ok(!/[\u4e00-\u9fff]/.test(stdout), "no Chinese in English CLI output");
  assert.equal(verdicts.lang, "en");
  const system = args[args.indexOf("--system-prompt") + 1] ?? "";
  assert.match(system, /Write all text in English/);
  const data = JSON.parse(/<script type="application\/json" id="rulesight-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "null");
  assert.equal(data.verdicts.lang, "en");
  assert.ok(html.includes("Key evidence") && html.includes("What happened"), "template carries the English UI strings");
});

test("without RULESIGHT_LANG, the session's language beats a Chinese system locale", async () => {
  // The fixture's user writes in English.
  const { stdout, verdicts, args } = await runCli({ LANG: "zh_CN.UTF-8" }, "verdicts.en.json");
  assert.match(stdout, /^Session 3f9c2a71-5b4e-4d1a-9e2f-7c8b6a0d1e42: 17 steps$/m);
  assert.ok(!/[\u4e00-\u9fff]/.test(stdout), "no Chinese in English CLI output");
  assert.equal(verdicts.lang, "en");
  assert.match(args[args.indexOf("--system-prompt") + 1] ?? "", /Write all text in English/);
});

test("--lang beats RULESIGHT_LANG; a bad --lang is a usage error", async () => {
  const { verdicts } = await runCli({ RULESIGHT_LANG: "zh" }, "verdicts.en.json", ["--lang", "en"]);
  assert.equal(verdicts.lang, "en");
  await assert.rejects(run(process.execPath, [BUNDLE, "plan", "--session", SESSION_ID, "--lang", "fr"], { env: { PATH: process.env.PATH ?? "", RULESIGHT_LANG: "en" } }), (error: { code?: number; stderr?: string }) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr ?? "", /--lang must be en or zh: fr/);
    return true;
  });
});

test("the last /rulesight and everything after it is left out of the check", async () => {
  const { stdout, user, verdicts } = await runCli({ RULESIGHT_LANG: "en" }, "verdicts.en.json", [], { appendJsonl: RULESIGHT_RUN });
  assert.match(stdout, /^Session 3f9c2a71-5b4e-4d1a-9e2f-7c8b6a0d1e42: 17 steps$/m);
  assert.match(stdout, /^Not checking Rulesight's own run: 2 steps from the last \/rulesight on$/m);
  assert.ok(user.includes("Done. Todos now take an optional due date"), "the work before /rulesight is judged");
  assert.ok(!user.includes("/rulesight") && !user.includes("Running Rulesight"), "Rulesight's own run is not judged");
  assert.equal(verdicts.lang, "en");
});

test("nothing to check before /rulesight: stops before judging", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rulesight-empty-"));
  const projects = path.join(dir, "projects", "-home-dev-todo-app");
  await mkdir(projects, { recursive: true });
  await writeFile(path.join(projects, `${SESSION_ID}.jsonl`), `${RULESIGHT_RUN}\n`);
  await assert.rejects(
    run(process.execPath, [BUNDLE, "plan", "--session", SESSION_ID, "--projects-dir", path.dirname(projects), "--cwd", FIXTURE], { env: { PATH: process.env.PATH ?? "", RULESIGHT_LANG: "en" } }),
    (error: { code?: number; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr ?? "", /^Nothing in this session to check before \/rulesight was typed/m);
      return true;
    },
  );
});

test("a report folder that can't be written falls back to the temp folder before judging", async () => {
  const { stdout } = await runCli({ RULESIGHT_LANG: "en" }, "verdicts.en.json", [], {
    outDir: async (base) => {
      const locked = path.join(base, "locked");
      await mkdir(locked);
      await chmod(locked, 0o500);
      return path.join(locked, "reports");
    },
  });
  // stdout has the temp test folder replaced by <dir>.
  assert.match(stdout, /^Can't write to the report folder <dir>\/locked\/reports \(a sandbox may be blocking it\); saving to <dir>\/tmp\/rulesight-reports instead$/m);
  assert.ok(stdout.indexOf("Can't write") < stdout.indexOf("Segment 1/1"), "the check runs before judging");
  assert.match(stdout, /^RULESIGHT_REPORT <dir>\/tmp\/rulesight-reports\/.+\.report\.html$/m);
});

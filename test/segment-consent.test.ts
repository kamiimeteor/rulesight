import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJudgePrompt } from "../src/judge.ts";
import { slimForReport } from "../src/report.ts";
import { planSegments } from "../src/segment.ts";
import type { Session, Step } from "../src/steps.ts";
import { parseVerdictsFile, validateVerdicts, type SegmentRecord } from "../src/verdict.ts";

const RULES = [{ id: "R1", text: "删除任何文件之前先问我", section: "", source: { file: "CLAUDE.md", line: 1 } }];

// Step n happens at minute n, so the report's start time shows which steps it counted.
const at = (n: string) => (/^\d$/.test(n) ? `2026-10-25T10:0${n}:00.000Z` : null);

function user(n: string, text: string, parentStep: string | null = null): Step {
  return { n, kind: "user_message", agent: parentStep === null ? "main" : "sub", summary: "", text, tool: null, parentStep, at: at(n), raw: [] };
}

function agentSays(n: string, text: string): Step {
  return { n, kind: "agent_message", agent: "main", summary: "", text, tool: null, parentStep: null, at: at(n), raw: [] };
}

function session(steps: Step[]): Session {
  return { formatVersion: 2, source: "claude_code", sessionId: "s", title: "t", cwd: null, startedAt: "a", endedAt: "b", steps };
}

const followed = (keyStep: string, evidenceSteps: string[]) => ({
  verdicts: [{ ruleId: "R1", verdict: "followed", title: "按你的同意删除了", reason: "r", keyStep, evidenceSteps, suggestion: "", fixPrompt: "" }],
});

test("later segments see earlier main-session user messages with their step numbers", () => {
  const steps = [user("1", "清理 old-notes/"), user("1.1", "子 agent 收到的任务", "1"), user("2", "删掉吧，不用问我"), agentSays("3", "x".repeat(300)), agentSays("4", "好")];
  const segments = planSegments(session(steps), { maxChars: 400 });
  const last = segments.at(-1);
  assert.ok(last !== undefined && last.index > 1);
  assert.deepEqual(last.context.earlierUserMessages, [
    { n: "1", text: "清理 old-notes/", card: false },
    { n: "2", text: "删掉吧，不用问我", card: false },
  ]);
  assert.equal(last.context.omittedUserMessages, 0);
  const prompt = buildJudgePrompt(session(steps), RULES, last, "zh");
  assert.match(prompt.user, /步骤 2，用户：\n {2}删掉吧，不用问我/);
  assert.match(prompt.system, /背景里带步骤号的用户原话/);
});

test("a question-card answer in the main session is carried as the user's words; one in a sub-agent is not", () => {
  const card = (n: string, parentStep: string | null): Step => ({
    n, kind: "tool_call", agent: parentStep === null ? "main" : "sub", summary: "", text: null, parentStep, at: at(n), raw: [],
    tool: { name: "AskUserQuestion", input: {}, output: 'Your questions have been answered: "删哪些？"="old-notes/"', isError: false },
  });
  const steps = [user("1", "清理一下"), card("2", null), card("2.1", "2"), agentSays("3", "x".repeat(300)), agentSays("4", "已删除")];
  const last = planSegments(session(steps), { maxChars: 400 }).at(-1);
  assert.ok(last !== undefined && last.index > 1);
  assert.deepEqual(last.context.earlierUserMessages.map((m) => [m.n, m.card]), [["1", false], ["2", true]]);
  assert.match(buildJudgePrompt(session(steps), RULES, last, "zh").user, /步骤 2，用户在提问卡片里的回答：/);
  // A report re-checks the citation the same way.
  const record: SegmentRecord = {
    index: 2, firstStep: last.steps[0]?.n ?? "", lastStep: "4", status: "ok", costUsd: 0, turns: 1, durationMs: 1, rejected: [],
    verdicts: [{ ruleId: "R1", verdict: "followed", title: "按你在卡片里的选择删除了", reason: "r", keyStep: "2", evidenceSteps: ["2", "4"] }],
  };
  const file = { sessionId: "s", model: "m", judgedAt: "t", rulesFile: "CLAUDE.md", rules: RULES, verdicts: record.verdicts, rejected: [], missingRuleIds: [], segments: [record], costUsd: 0, turns: 0, durationMs: 0 };
  assert.equal(parseVerdictsFile(file, steps).verdicts.length, 1);
});

test("the earlier-message list keeps the newest messages within its budget", () => {
  const long = (n: number) => user(String(n), `${n}`.padEnd(500, "长"));
  const steps = [...Array.from({ length: 45 }, (_, i) => long(i + 1)), agentSays("46", "x".repeat(300))];
  const last = planSegments(session(steps), { maxChars: 600 }).at(-1);
  assert.ok(last !== undefined);
  assert.equal(last.context.earlierUserMessages.length, 40);
  assert.equal(last.context.earlierUserMessages[0]?.n, "6");
  assert.equal(last.context.omittedUserMessages, 5);
});

test("an earlier user message can be cited only alongside a step from the segment", () => {
  const segmentSteps = [{ n: "13" }, { n: "14" }];
  const earlier = [{ n: "3" }];
  assert.equal(validateVerdicts(followed("3", ["3", "13"]), RULES, segmentSteps, earlier).verdicts.length, 1);
  assert.match(validateVerdicts(followed("3", ["3"]), RULES, segmentSteps, earlier).rejected[0]?.reason ?? "", /缺少本段里的证据/);
  assert.match(validateVerdicts(followed("5", ["5", "13"]), RULES, segmentSteps, earlier).rejected[0]?.reason ?? "", /不存在的步骤：5/);
  // Without earlier messages (an unsegmented run), only the segment's own steps count, as before.
  assert.match(validateVerdicts(followed("3", ["3", "13"]), RULES, segmentSteps).rejected[0]?.reason ?? "", /不存在的步骤：3/);
});

test("verdict files and reports accept a citation of an earlier user message, nothing else from before the segment", () => {
  const steps = [user("1", "清理"), user("2", "删掉吧，不用问我"), agentSays("3", "看一下"), agentSays("4", "已删除")];
  const record = (keyStep: string, evidenceSteps: string[]): SegmentRecord => ({
    index: 2, firstStep: "4", lastStep: "4", status: "ok", costUsd: 0, turns: 1, durationMs: 1, rejected: [],
    verdicts: [{ ruleId: "R1", verdict: "followed", title: "按你的同意删除了", reason: "r", keyStep, evidenceSteps }],
  });
  const file = (segment: SegmentRecord) => ({
    sessionId: "s", model: "m", judgedAt: "t", rulesFile: "CLAUDE.md", rules: RULES, verdicts: segment.verdicts, rejected: [], missingRuleIds: [],
    segments: [segment], costUsd: 0, turns: 0, durationMs: 0,
  });
  const ok = parseVerdictsFile(file(record("2", ["2", "4"])), steps);
  assert.deepEqual(ok.verdicts[0]?.verdict === "followed" ? ok.verdicts[0].evidenceSteps : [], ["2", "4"]);
  assert.throws(() => parseVerdictsFile(file(record("3", ["3", "4"])), steps), /只能引用本段的步骤和之前用户说的话/);

  // A ranged report keeps the cited step from before the range, and its times still follow the range.
  const slim = slimForReport({ session: { ...session(steps), startedAt: "2026-10-25T10:01:00.000Z" }, verdicts: ok });
  assert.deepEqual(slim.session.steps.map((step) => step.n), ["2", "4"]);
  assert.equal(slim.session.startedAt, "2026-10-25T10:04:00.000Z");
});

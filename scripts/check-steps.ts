import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { SESSION_FIELDS, STEP_FIELDS, STEP_KINDS, TOOL_FIELDS } from "../src/steps.ts";
import { parseCli } from "./args.ts";

// Re-reads the raw JSONL with its own minimal parsing (no adapter import) and compares it with the steps file.

const { sessionId, projectsDir } = parseCli("node scripts/check-steps.ts <sessionId> [--projects-dir <path>]");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blocksOf(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  const content = message.content;
  return typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  assert(Array.isArray(content), "tool_result.content is neither a string nor an array");
  return content
    .map((part: unknown) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : JSON.stringify(part)))
    .join("\n");
}

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

interface ExpectedCall {
  agent: string;
  callUuid: string;
  id: string;
  name: string;
  input: unknown;
}

interface ExpectedResult {
  uuid: string;
  output: string;
  isError: boolean;
}

const NOISE = ["<command-name>", "<command-message>", "<local-command-stdout>", "<local-command-caveat>", "<command-args>"];

const root = path.resolve(projectsDir ?? path.join(os.homedir(), ".claude", "projects"));
const sessionFiles: string[] = [];
for (const folder of await readdir(root, { withFileTypes: true })) {
  const file = path.join(root, folder.name, `${sessionId}.jsonl`);
  if (folder.isDirectory() && (await stat(file).then((s) => s.isFile(), () => false))) sessionFiles.push(file);
}
assert.equal(sessionFiles.length, 1, `expected exactly one ${sessionId}.jsonl under ${root}, found ${sessionFiles.length}`);
const mainFile = sessionFiles[0]!;
const subDir = path.join(path.dirname(mainFile), sessionId, "subagents");
const subFileNames = (await readdir(subDir).catch(() => [])).filter((name) => /^agent-.+\.jsonl$/.test(name)).sort();

const conversations = [
  { agent: "main", file: mainFile },
  ...subFileNames.map((name) => ({ agent: name.slice("agent-".length, -".jsonl".length), file: path.join(subDir, name) })),
];
const metaToolUseId = new Map<string, string>();
for (const { agent } of conversations.slice(1)) {
  const meta: unknown = JSON.parse(await readFile(path.join(subDir, `agent-${agent}.meta.json`), "utf8"));
  assert(isRecord(meta) && typeof meta.toolUseId === "string", `agent ${agent}: meta.json has no toolUseId`);
  metaToolUseId.set(agent, meta.toolUseId);
}

const timestampByUuid = new Map<string, string>();
const calls: ExpectedCall[] = [];
const results = new Map<string, ExpectedResult>();
const expectedKindCounts: Record<string, number> = { user_message: 0, agent_message: 0, thinking: 0, system: 0 };
let compactBoundaries = 0;
let customTitle: string | null = null;
let firstUserText: string | null = null;
let duplicateUuids = 0;
let queuedCommands = 0;
let minMs = Number.POSITIVE_INFINITY;
let maxMs = Number.NEGATIVE_INFINITY;

for (const { agent, file } of conversations) {
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const text of lines) {
    if (text.trim() === "") continue;
    const e: unknown = JSON.parse(text);
    assert(isRecord(e), `${file}: a line is not a JSON object`);
    if (e.type === "custom-title" && agent === "main" && typeof e.customTitle === "string" && e.customTitle.trim() !== "") {
      customTitle = e.customTitle.trim();
    }
    let entry: Record<string, unknown> = e;
    if (e.type === "attachment" && isRecord(e.attachment) && e.attachment.type === "queued_command") {
      const mode = e.attachment.commandMode;
      entry = {
        ...e,
        type: "user",
        isMeta: false,
        message: { content: e.attachment.prompt },
        origin: e.attachment.origin ?? (mode === "task-notification" ? { kind: "task-notification" } : undefined),
      };
      queuedCommands += 1;
    }
    if (entry.type !== "user" && entry.type !== "assistant" && entry.type !== "system") continue;
    assert(typeof e.uuid === "string", `${file}: entry without uuid`);
    if (timestampByUuid.has(e.uuid)) {
      if (entry !== e) queuedCommands -= 1;
      duplicateUuids += 1;
      continue;
    }
    assert(typeof e.timestamp === "string", `entry ${e.uuid} has no timestamp`);
    timestampByUuid.set(e.uuid, e.timestamp);
    minMs = Math.min(minMs, Date.parse(e.timestamp));
    maxMs = Math.max(maxMs, Date.parse(e.timestamp));

    if (entry.type === "system") {
      if (entry.subtype === "compact_boundary") {
        compactBoundaries += 1;
        expectedKindCounts.system! += 1;
      }
      continue;
    }
    const origin = isRecord(entry.origin) && typeof entry.origin.kind === "string" ? entry.origin.kind : undefined;
    const nonHuman = origin !== undefined && origin !== "human";
    const skippedMeta = entry.isMeta === true && !nonHuman;
    for (const block of blocksOf(entry.message)) {
      if (!isRecord(block)) continue;
      if (block.type === "tool_use") {
        assert(typeof block.id === "string" && typeof block.name === "string", `malformed tool_use in entry ${e.uuid}`);
        calls.push({ agent, callUuid: e.uuid, id: block.id, name: block.name, input: block.input });
      } else if (block.type === "tool_result") {
        assert(typeof block.tool_use_id === "string", `malformed tool_result in entry ${e.uuid}`);
        assert(!results.has(block.tool_use_id), `tool_use_id ${block.tool_use_id} has two tool_results`);
        results.set(block.tool_use_id, { uuid: e.uuid, output: resultText(block.content), isError: block.is_error === true });
      } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() !== "") {
        expectedKindCounts.thinking! += 1;
      } else if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
        if (entry.type === "assistant") {
          expectedKindCounts.agent_message! += 1;
        } else if (entry.isCompactSummary === true) {
          expectedKindCounts.system! += 1;
        } else if (!skippedMeta) {
          const text: string = block.text;
          const noisy = NOISE.some((prefix) => text.trimStart().startsWith(prefix));
          const typedCommand = /<command-args>\s*\S[\s\S]*?<\/command-args>/.test(text);
          if (!noisy || typedCommand) {
            expectedKindCounts[nonHuman && !noisy ? "system" : "user_message"]! += 1;
            if (agent === "main" && !nonHuman && firstUserText === null) firstUserText = text;
          }
        }
      }
    }
  }
}

const callIds = calls.map((c) => c.id);
assert.equal(new Set(callIds).size, callIds.length, "a tool_use id appears twice in the raw files");
const callIdSet = new Set(callIds);
const orphanResults = [...results.keys()].filter((id) => !callIdSet.has(id)).length;

const doc: unknown = JSON.parse(await readFile(path.resolve("private/out", `${sessionId}.steps.json`), "utf8"));
assert(isRecord(doc), "steps file is not a JSON object");
assert.deepEqual(sortedKeys(doc), [...SESSION_FIELDS].sort(), "session field set differs from the spec");
assert.equal(doc.formatVersion, 2, "formatVersion");
assert.equal(doc.source, "claude_code", "source");
assert.equal(doc.sessionId, sessionId, "sessionId");
assert(typeof doc.title === "string" && doc.title !== "", "title must be a non-empty string");
if (customTitle !== null) assert.equal(doc.title, customTitle, "title must be the last custom-title");
else if (firstUserText === null) assert.equal(doc.title, "未命名会话", "title without custom-title or user message");
assert(doc.cwd === null || typeof doc.cwd === "string", "cwd must be a string or null");
assert.equal(doc.startedAt, new Date(minMs).toISOString(), "startedAt is not the first raw timestamp");
assert.equal(doc.endedAt, new Date(maxMs).toISOString(), "endedAt is not the last raw timestamp");
assert(Array.isArray(doc.steps), "steps must be an array");

const steps: Record<string, unknown>[] = [];
for (const [i, step] of doc.steps.entries()) {
  assert(isRecord(step), `step #${i} is not an object`);
  const label = `step ${String(step.n)}`;
  assert.deepEqual(sortedKeys(step), [...STEP_FIELDS].sort(), `${label}: field set differs from the spec`);
  assert(typeof step.n === "string" && step.n !== "", `step #${i}: n must be a non-empty string`);
  assert(STEP_KINDS.some((kind) => kind === step.kind), `${label}: unknown kind ${String(step.kind)}`);
  assert(typeof step.agent === "string" && step.agent !== "", `${label}: agent must be a non-empty string`);
  assert(typeof step.summary === "string" && step.summary.trim() !== "", `${label}: summary must be non-empty`);
  assert(step.parentStep === null || typeof step.parentStep === "string", `${label}: parentStep must be a string or null`);
  assert(Array.isArray(step.raw) && step.raw.length > 0, `${label}: raw must be a non-empty array`);
  for (const uuid of step.raw) assert(typeof uuid === "string" && timestampByUuid.has(uuid), `${label}: raw uuid ${String(uuid)} is not in the raw files`);
  assert.equal(step.at, timestampByUuid.get(String(step.raw[0])), `${label}: at is not the timestamp of the first raw entry`);
  if (step.kind === "tool_call") {
    assert.equal(step.text, null, `${label}: tool_call text must be null`);
    assert(isRecord(step.tool), `${label}: tool_call needs a tool object`);
    assert.deepEqual(sortedKeys(step.tool), [...TOOL_FIELDS].sort(), `${label}: tool field set differs from the spec`);
    assert(typeof step.tool.name === "string", `${label}: tool.name`);
    assert(isRecord(step.tool.input), `${label}: tool.input must be an object`);
    assert(step.tool.output === null || typeof step.tool.output === "string", `${label}: tool.output`);
    assert(typeof step.tool.isError === "boolean", `${label}: tool.isError`);
  } else {
    assert(typeof step.text === "string" && step.text.trim() !== "", `${label}: ${String(step.kind)} step has empty text`);
    assert.equal(step.tool, null, `${label}: non-tool step must have tool null`);
  }
  steps.push(step);
}

const mainSteps = steps.filter((s) => s.agent === "main");
assert.deepEqual(
  mainSteps.map((s) => s.n),
  mainSteps.map((_, i) => String(i + 1)),
  "main step numbers are not contiguous from 1",
);
let previousMs = Number.NEGATIVE_INFINITY;
for (const s of mainSteps) {
  assert.equal(s.parentStep, null, `step ${String(s.n)}: main step must have parentStep null`);
  const ms = Date.parse(timestampByUuid.get(String((s.raw as unknown[])[0])) ?? "");
  assert(ms >= previousMs, `step ${String(s.n)}: main steps are not in timestamp order`);
  previousMs = ms;
}

const callSteps = steps.filter((s) => s.kind === "tool_call");
assert.equal(callSteps.length, calls.length, "tool_call step count differs from the unique tool_use count in the raw files");
const callsByUuid = Map.groupBy(calls, (c) => c.callUuid);
const stepsByUuid = Map.groupBy(callSteps, (s) => (Array.isArray(s.raw) ? String(s.raw[0]) : ""));
assert.deepEqual([...stepsByUuid.keys()].sort(), [...callsByUuid.keys()].sort(), "tool_call steps point at different call entries than the raw files");
const idByStepN = new Map<string, string>();
for (const [uuid, expectedCalls] of callsByUuid) {
  const group = stepsByUuid.get(uuid) ?? [];
  assert.equal(group.length, expectedCalls.length, `entry ${uuid}: tool_call step count`);
  for (const [i, call] of expectedCalls.entries()) {
    const step = group[i];
    assert(step !== undefined && isRecord(step.tool) && Array.isArray(step.raw), `tool_use ${call.id}: no tool_call step`);
    const label = `tool_use ${call.id} (${call.name})`;
    idByStepN.set(String(step.n), call.id);
    assert.equal(step.agent, call.agent, `${label}: agent`);
    assert.equal(step.tool.name, call.name, `${label}: name`);
    assert.deepEqual(step.tool.input, call.input, `${label}: input`);
    const result = results.get(call.id);
    if (result === undefined) {
      assert.deepEqual(step.raw, [uuid], `${label}: unmatched call must have only the call uuid in raw`);
      assert.equal(step.tool.output, null, `${label}: unmatched call must have null output`);
      assert.equal(step.tool.isError, false, `${label}: unmatched call must not be an error`);
    } else {
      assert.deepEqual(step.raw, [uuid, result.uuid], `${label}: raw`);
      assert.equal(step.tool.output, result.output, `${label}: output`);
      assert.equal(step.tool.isError, result.isError, `${label}: isError`);
    }
  }
}

const subCounters = new Map<string, number>();
const agentsWithSteps = new Set<string>();
for (const s of steps.filter((step) => step.agent !== "main")) {
  const label = `step ${String(s.n)}`;
  assert(typeof s.parentStep === "string", `${label}: sub-agent step needs a parentStep`);
  const parent = steps.find((step) => step.n === s.parentStep);
  assert(parent !== undefined, `${label}: parentStep ${s.parentStep} does not exist`);
  assert(
    parent.kind === "tool_call" && isRecord(parent.tool) && (parent.tool.name === "Agent" || parent.tool.name === "Task"),
    `${label}: parentStep ${s.parentStep} is not an Agent/Task tool_call`,
  );
  assert.equal(idByStepN.get(s.parentStep), metaToolUseId.get(String(s.agent)), `${label}: parentStep is not the call named in meta.json`);
  const index = (subCounters.get(s.parentStep) ?? 0) + 1;
  subCounters.set(s.parentStep, index);
  assert.equal(s.n, `${s.parentStep}.${index}`, `sub-agent step numbering under ${s.parentStep}`);
  agentsWithSteps.add(String(s.agent));
}
for (const agent of agentsWithSteps) assert(metaToolUseId.has(agent), `agent ${agent} is not a sub-agent file`);

assert.equal(
  steps.filter((s) => s.kind === "system" && s.summary === "上下文压缩").length,
  compactBoundaries,
  "compaction step count differs from compact_boundary entries",
);
for (const [kind, expected] of Object.entries(expectedKindCounts)) {
  assert.equal(steps.filter((s) => s.kind === kind).length, expected, `${kind} step count differs from the raw files`);
}

console.log(
  `OK ${steps.length} 步：tool_call ${callSteps.length}（已配对 ${results.size - orphanResults}，无结果 ${calls.length - (results.size - orphanResults)}），` +
    `子 agent 文件 ${subFileNames.length}，子 agent 步骤 ${steps.length - mainSteps.length}，压缩 ${compactBoundaries}，` +
    `孤立 tool_result ${orphanResults}，重复 uuid ${duplicateUuids}，` +
    Object.entries(expectedKindCounts).map(([kind, count]) => `${kind} ${count}`).join("，"),
);

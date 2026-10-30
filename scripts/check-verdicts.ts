import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRecord, parseSession } from "../src/steps.ts";

const [verdictsFile, stepsFile] = process.argv.slice(2);
if (verdictsFile === undefined || stepsFile === undefined || process.argv.length > 4) {
  console.error("用法：node scripts/check-verdicts.ts <verdicts.json> <steps.json>");
  process.exit(2);
}

const session = parseSession(JSON.parse(await readFile(stepsFile, "utf8")));
const stepNs = new Set(session.steps.map((step) => step.n));
assert.equal(stepNs.size, session.steps.length, "steps.json 里有重复的步骤号");

const doc: unknown = JSON.parse(await readFile(verdictsFile, "utf8"));
assert(isRecord(doc), "verdicts 文件不是 JSON 对象");
assert.equal(doc.sessionId, session.sessionId, "verdicts 和 steps 不是同一个会话");
assert(Array.isArray(doc.rules), "rules 必须是数组");
assert(Array.isArray(doc.verdicts), "verdicts 必须是数组");
assert(Array.isArray(doc.missingRuleIds), "missingRuleIds 必须是数组");
assert(Array.isArray(doc.rejected), "rejected 必须是数组");

const ruleIds = new Set<string>();
for (const rule of doc.rules) {
  assert(isRecord(rule) && typeof rule.id === "string" && rule.id !== "", "规则缺少 id");
  assert(!ruleIds.has(rule.id), `规则 ${rule.id} 重复`);
  ruleIds.add(rule.id);
  assert(typeof rule.text === "string" && rule.text.trim() !== "", `规则 ${rule.id}: text 为空`);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

// Shape of one verdict; `inScope` says which steps it may cite.
function checkVerdict(verdict: unknown, where: string, inScope: (n: string) => boolean): string {
  assert(isRecord(verdict), `${where}: 判定不是对象`);
  const { ruleId } = verdict;
  assert(typeof ruleId === "string" && ruleIds.has(ruleId), `${where}: ruleId ${String(ruleId)} 不在规则列表里`);
  assert(nonEmpty(verdict.title), `${where} ${ruleId}: title 为空`);
  assert(nonEmpty(verdict.reason), `${where} ${ruleId}: reason 为空`);

  switch (verdict.verdict) {
    case "followed":
    case "violated": {
      const { keyStep, evidenceSteps } = verdict;
      assert(typeof keyStep === "string" && keyStep !== "", `${where} ${ruleId}: ${verdict.verdict} 没有 keyStep`);
      assert(Array.isArray(evidenceSteps) && evidenceSteps.length > 0, `${where} ${ruleId}: ${verdict.verdict} 没有证据步骤`);
      assert.equal(new Set(evidenceSteps).size, evidenceSteps.length, `${where} ${ruleId}: evidenceSteps 有重复`);
      for (const n of evidenceSteps) assert(typeof n === "string" && inScope(n), `${where} ${ruleId}: 引用了范围外或不存在的步骤 ${String(n)}`);
      assert(evidenceSteps.includes(keyStep), `${where} ${ruleId}: keyStep ${keyStep} 不在 evidenceSteps 里`);
      if (verdict.verdict === "violated") {
        assert(nonEmpty(verdict.suggestion), `${where} ${ruleId}: violated 没有 suggestion`);
        assert(nonEmpty(verdict.fixPrompt), `${where} ${ruleId}: violated 没有 fixPrompt`);
      }
      break;
    }
    case "not_applicable": {
      const { keyStep, evidenceSteps } = verdict;
      assert(keyStep === undefined || keyStep === "", `${where} ${ruleId}: not_applicable 不应有 keyStep`);
      assert(evidenceSteps === undefined || (Array.isArray(evidenceSteps) && evidenceSteps.length === 0), `${where} ${ruleId}: not_applicable 不应有证据步骤`);
      break;
    }
    default:
      assert.fail(`${where} ${ruleId}: 未知的 verdict ${String(verdict.verdict)}`);
  }
  return ruleId;
}

const judged = new Set<string>();
for (const [i, verdict] of doc.verdicts.entries()) {
  const ruleId = checkVerdict(verdict, `判定 #${i}`, (n) => stepNs.has(n));
  assert(!judged.has(ruleId), `规则 ${ruleId} 有多个判定`);
  judged.add(ruleId);
}

// Segments: each ok segment cites only its own range, the ranges tile the checked steps, and the merged verdicts follow the merge rules.
assert(Array.isArray(doc.segments) && doc.segments.length > 0, "segments 必须是非空数组");
const stepIndex = new Map(session.steps.map((step, i) => [step.n, i]));
const position = (n: string): number => stepIndex.get(n) ?? Number.MAX_SAFE_INTEGER;
const MAX_EVIDENCE = 12;

interface OkSegment {
  verdicts: Record<string, unknown>[];
}
const okSegments: OkSegment[] = [];
let previousLast = -1;
let firstCovered = 0;
let costSum = 0;
let durationSum = 0;
let failedSegments = 0;
for (const [i, segment] of doc.segments.entries()) {
  const where = `第 ${i + 1} 段`;
  assert(isRecord(segment), `${where}不是对象`);
  assert.equal(segment.index, i + 1, `${where}: index 不连续`);
  const { firstStep, lastStep } = segment;
  assert(typeof firstStep === "string" && typeof lastStep === "string", `${where}: 缺少 firstStep/lastStep`);
  const first = stepIndex.get(firstStep);
  const last = stepIndex.get(lastStep);
  assert(first !== undefined && last !== undefined && first <= last, `${where}: 步骤范围 ${firstStep}–${lastStep} 不成立`);
  if (i === 0) firstCovered = first + 1;
  else assert.equal(first, previousLast + 1, `${where}: 和上一段没有首尾相接`);
  previousLast = last;
  assert(typeof segment.costUsd === "number" && typeof segment.durationMs === "number" && typeof segment.turns === "number", `${where}: 费用/用时/轮数缺失`);
  costSum += segment.costUsd;
  durationSum += segment.durationMs;
  assert(Array.isArray(segment.verdicts) && Array.isArray(segment.rejected), `${where}: verdicts/rejected 必须是数组`);
  if (segment.status === "failed") {
    failedSegments += 1;
    assert(nonEmpty(segment.error), `${where}: failed 没有 error`);
    assert.equal(segment.verdicts.length, 0, `${where}: failed 的 verdicts 必须为空`);
    continue;
  }
  assert.equal(segment.status, "ok", `${where}: status 未知`);
  const seen = new Set<string>();
  const verdicts: Record<string, unknown>[] = [];
  for (const [j, verdict] of segment.verdicts.entries()) {
    const ruleId = checkVerdict(verdict, `${where} 判定 #${j}`, (n) => position(n) >= first && position(n) <= last);
    assert(!seen.has(ruleId), `${where}: 规则 ${ruleId} 有多个判定`);
    seen.add(ruleId);
    verdicts.push(verdict as Record<string, unknown>);
  }
  okSegments.push({ verdicts });
}
assert(Math.abs(costSum - Number(doc.costUsd)) < 1e-6, "costUsd 不等于各段之和");
assert.equal(durationSum, doc.durationMs, "durationMs 不等于各段之和");

for (const rule of doc.rules) {
  const ruleId = String((rule as Record<string, unknown>).id);
  const all = okSegments.flatMap((segment) => segment.verdicts.filter((verdict) => verdict.ruleId === ruleId));
  const merged: unknown = doc.verdicts.find((verdict) => isRecord(verdict) && verdict.ruleId === ruleId);
  if (all.length === 0) {
    assert.equal(merged, undefined, `${ruleId}: 没有任何一段有判定，合并结果里不该有`);
    continue;
  }
  assert(isRecord(merged), `${ruleId}: 有分段判定，合并结果里却没有`);
  const violations = all.filter((verdict) => verdict.verdict === "violated");
  const followed = all.filter((verdict) => verdict.verdict === "followed");
  const winners = violations.length > 0 ? violations : followed.length > 0 ? followed : all;
  const [lead] = winners;
  assert(lead !== undefined);
  assert.equal(merged.verdict, lead.verdict, `${ruleId}: 合并后的结论不对`);
  assert.equal(merged.reason, lead.reason, `${ruleId}: reason 不是第一个${lead.verdict}的那段`);
  const suffix = lead.verdict === "violated" && violations.length > 1 ? `（另有 ${violations.length - 1} 处）` : "";
  assert.equal(merged.title, `${String(lead.title)}${suffix}`, `${ruleId}: title 不对`);
  if (lead.verdict === "not_applicable") continue;
  assert.equal(merged.keyStep, lead.keyStep, `${ruleId}: keyStep 不是第一个${lead.verdict}的那段`);
  if (lead.verdict === "violated") {
    assert.equal(merged.suggestion, lead.suggestion, `${ruleId}: suggestion 不对`);
    assert.equal(merged.fixPrompt, lead.fixPrompt, `${ruleId}: fixPrompt 不对`);
  }
  const union = [...new Set(winners.flatMap((verdict) => verdict.evidenceSteps as string[]))].sort((a, b) => position(a) - position(b));
  const evidence = merged.evidenceSteps as string[];
  assert(evidence.length <= MAX_EVIDENCE, `${ruleId}: 证据超过 ${MAX_EVIDENCE} 步`);
  assert(evidence.every((n) => union.includes(n)), `${ruleId}: 证据里有各段都没引用的步骤`);
  assert.deepEqual(evidence, [...evidence].sort((a, b) => position(a) - position(b)), `${ruleId}: 证据没有按步骤顺序排`);
  if (union.length <= MAX_EVIDENCE) assert.deepEqual(evidence, union, `${ruleId}: 证据不是各段证据的并集`);
}

const expectedMissing = [...ruleIds].filter((id) => !judged.has(id));
assert.deepEqual(doc.missingRuleIds, expectedMissing, "missingRuleIds 和实际没有判定的规则不一致");

const counts = Object.groupBy(doc.verdicts, (verdict) => String(isRecord(verdict) ? verdict.verdict : ""));
const count = (kind: string) => counts[kind]?.length ?? 0;
console.log(
  `OK ${doc.verdicts.length}/${ruleIds.size} 条规则有判定：遵守 ${count("followed")}，违反 ${count("violated")}，不适用 ${count("not_applicable")}，` +
    `没有判定 ${expectedMissing.length}，被拒绝 ${doc.rejected.length}，` +
    `分 ${doc.segments.length} 段（没判成 ${failedSegments}），覆盖步骤 ${firstCovered}–${previousLast + 1}/${session.steps.length}`,
);

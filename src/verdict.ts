import { parseLang, type Lang } from "./lang.ts";
import type { Rule } from "./rules.ts";
import { isRecord, type Step } from "./steps.ts";

export const VERDICT_KINDS = ["followed", "violated", "not_applicable"] as const;
export type VerdictKind = (typeof VERDICT_KINDS)[number];

interface VerdictBase {
  ruleId: string;
  title: string;
  reason: string;
}

export interface FollowedVerdict extends VerdictBase {
  verdict: "followed";
  keyStep: string;
  evidenceSteps: string[];
}

export interface ViolatedVerdict extends VerdictBase {
  verdict: "violated";
  keyStep: string;
  evidenceSteps: string[];
  suggestion: string;
  fixPrompt: string;
}

export interface NotApplicableVerdict extends VerdictBase {
  verdict: "not_applicable";
}

export type Verdict = FollowedVerdict | ViolatedVerdict | NotApplicableVerdict;

export interface Rejection {
  ruleId?: string;
  reason: string;
}

interface SegmentRecordBase {
  // 1-based, in step order.
  index: number;
  firstStep: string;
  lastStep: string;
  costUsd: number;
  turns: number;
  durationMs: number;
}

export interface OkSegmentRecord extends SegmentRecordBase {
  status: "ok";
  verdicts: Verdict[];
  rejected: Rejection[];
}

export interface FailedSegmentRecord extends SegmentRecordBase {
  status: "failed";
  error: string;
  verdicts: [];
  rejected: [];
}

export type SegmentRecord = OkSegmentRecord | FailedSegmentRecord;

// What scripts/judge.ts writes to disk and the report reads back.
// `verdicts` is the merge of the segments' verdicts; `rejected` is every segment's rejections in one list.
export interface VerdictsFile {
  sessionId: string;
  model: string;
  judgedAt: string;
  rulesFile: string;
  // Language the verdict text was written in; the report renders in it. Missing in files from before 2026-10-30, which are Chinese.
  lang?: Lang;
  rules: Rule[];
  verdicts: Verdict[];
  rejected: Rejection[];
  missingRuleIds: string[];
  segments: SegmentRecord[];
  costUsd: number;
  turns: number;
  durationMs: number;
}

export interface ValidationResult {
  verdicts: Verdict[];
  rejected: Rejection[];
  missingRuleIds: string[];
}

// What each field asks the model for, per output language.
const FIELD_DESCRIPTIONS = {
  zh: {
    ruleId: "规则编号，原样照抄，例如 R7",
    reason: "先写这一项：中文，一段话说明会话里发生了什么、对照规则是否符合，指出关键步骤里的具体事实。verdict 必须和这里的结论一致",
    keyStep: "最关键的那一步的步骤号，只有 followed 和 violated 填，否则填空字符串",
    evidenceSteps: "证据步骤号，必须包含 keyStep；not_applicable 填空数组",
    title: "中文，写这次会话里发生了什么，不要复述规则，不要写步骤号",
    suggestion: "只有 violated 填：一句中文建议；否则填空字符串",
    fixPrompt: "只有 violated 填：用户可以直接复制给 agent 的中文指令；否则填空字符串",
  },
  en: {
    ruleId: "The rule id, copied exactly, e.g. R7",
    reason:
      "Write this first: in English, one paragraph on what happened in the session and whether it complies with the rule, citing concrete facts from the key steps. verdict must match the conclusion here",
    keyStep: "Step number of the single most telling step; only for followed and violated, otherwise an empty string",
    evidenceSteps: "Evidence step numbers, must include keyStep; an empty array for not_applicable",
    title: "In English, what happened in this session; do not restate the rule, do not include step numbers",
    suggestion: "Only for violated: one-sentence suggestion in English; otherwise an empty string",
    fixPrompt: "Only for violated: an instruction in English the user can paste straight to the agent; otherwise an empty string",
  },
} as const satisfies Record<Lang, Record<string, string>>;

// Flat on purpose: the model fills every field, and parseVerdict turns it into the union.
// Empty string / empty array mean "not applicable to this verdict kind".
export function verdictOutputSchema(lang: Lang) {
  const d = FIELD_DESCRIPTIONS[lang];
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "reason", "keyStep", "evidenceSteps", "verdict", "title", "suggestion", "fixPrompt"],
          properties: {
            ruleId: { type: "string", description: d.ruleId },
            reason: { type: "string", description: d.reason },
            keyStep: { type: "string", description: d.keyStep },
            evidenceSteps: { type: "array", items: { type: "string" }, description: d.evidenceSteps },
            verdict: { type: "string", enum: [...VERDICT_KINDS] },
            title: { type: "string", description: d.title },
            suggestion: { type: "string", description: d.suggestion },
            fixPrompt: { type: "string", description: d.fixPrompt },
          },
        },
      },
    },
  } as const satisfies Record<string, unknown>;
}

export const VERDICT_OUTPUT_SCHEMA = verdictOutputSchema("zh");

type Parsed = { ok: true; verdict: Verdict } | { ok: false; reason: string };

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseVerdict(entry: Record<string, unknown>, ruleId: string, stepNs: ReadonlySet<string>): Parsed {
  const fail = (reason: string): Parsed => ({ ok: false, reason });
  const { verdict, title, reason } = entry;
  if (!nonEmptyString(title)) return fail("缺少 title");
  if (!nonEmptyString(reason)) return fail("缺少 reason");
  const base = { ruleId, title: title.trim(), reason: reason.trim() };

  if (verdict === "not_applicable") return { ok: true, verdict: { ...base, verdict } };
  if (verdict !== "followed" && verdict !== "violated") return fail(`未知的 verdict：${String(verdict)}`);

  const { keyStep, evidenceSteps } = entry;
  if (!nonEmptyString(keyStep)) return fail(`${verdict} 缺少 keyStep，没有证据的判定不输出`);
  if (!Array.isArray(evidenceSteps) || !evidenceSteps.every(nonEmptyString)) return fail(`${verdict} 的 evidenceSteps 不是字符串数组`);
  const evidence = [...new Set([keyStep, ...evidenceSteps].map((n) => n.trim()))];
  const unknownSteps = evidence.filter((n) => !stepNs.has(n));
  if (unknownSteps.length > 0) return fail(`引用了不存在的步骤：${unknownSteps.join(", ")}`);

  const cited = { ...base, keyStep: keyStep.trim(), evidenceSteps: evidence };
  if (verdict === "followed") return { ok: true, verdict: { ...cited, verdict } };

  const { suggestion, fixPrompt } = entry;
  if (!nonEmptyString(suggestion) || !nonEmptyString(fixPrompt)) return fail("violated 缺少 suggestion 或 fixPrompt");
  return { ok: true, verdict: { ...cited, verdict, suggestion: suggestion.trim(), fixPrompt: fixPrompt.trim() } };
}

export function validateVerdicts(raw: unknown, rules: readonly Rule[], steps: readonly Step[]): ValidationResult {
  const ruleIndex = new Map(rules.map((rule, i) => [rule.id, i]));
  const stepNs = new Set(steps.map((step) => step.n));
  const rejected: Rejection[] = [];
  const accepted = new Map<string, Verdict>();

  const entries = isRecord(raw) ? raw.verdicts : undefined;
  if (!Array.isArray(entries)) {
    rejected.push({ reason: "模型输出不是 { verdicts: [...] }" });
  } else {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.ruleId === "string") counts.set(entry.ruleId, (counts.get(entry.ruleId) ?? 0) + 1);
    }
    for (const [i, entry] of entries.entries()) {
      if (!isRecord(entry) || typeof entry.ruleId !== "string") {
        rejected.push({ reason: `第 ${i} 条不是带 ruleId 的对象` });
        continue;
      }
      const ruleId = entry.ruleId;
      if (!ruleIndex.has(ruleId)) {
        rejected.push({ ruleId, reason: "ruleId 不在规则列表里" });
      } else if ((counts.get(ruleId) ?? 0) > 1) {
        rejected.push({ ruleId, reason: "同一条规则出现多个判定，无法确定取哪个，全部丢弃" });
      } else {
        const parsed = parseVerdict(entry, ruleId, stepNs);
        if (parsed.ok) accepted.set(ruleId, parsed.verdict);
        else rejected.push({ ruleId, reason: parsed.reason });
      }
    }
  }

  const verdicts = [...accepted.values()].sort((a, b) => (ruleIndex.get(a.ruleId) ?? 0) - (ruleIndex.get(b.ruleId) ?? 0));
  const missingRuleIds = rules.filter((rule) => !accepted.has(rule.id)).map((rule) => rule.id);
  return { verdicts, rejected, missingRuleIds };
}

const MAX_EVIDENCE_STEPS = 12;

type CitedVerdict = FollowedVerdict | ViolatedVerdict;

function isViolated(verdict: Verdict): verdict is ViolatedVerdict {
  return verdict.verdict === "violated";
}

function isFollowed(verdict: Verdict): verdict is FollowedVerdict {
  return verdict.verdict === "followed";
}

// Union of the evidence in step order. The cap never drops the key step.
function mergeEvidence(verdicts: readonly CitedVerdict[], keyStep: string, order: ReadonlyMap<string, number>): string[] {
  const position = (n: string) => order.get(n) ?? Number.MAX_SAFE_INTEGER;
  const byPosition = (a: string, b: string) => position(a) - position(b);
  const union = [...new Set(verdicts.flatMap((verdict) => verdict.evidenceSteps))].sort(byPosition);
  if (union.length <= MAX_EVIDENCE_STEPS) return union;
  const head = union.slice(0, MAX_EVIDENCE_STEPS);
  return head.includes(keyStep) ? head : [...head.slice(0, MAX_EVIDENCE_STEPS - 1), keyStep].sort(byPosition);
}

// Any violation wins, then any "followed", then "not applicable". Fields come from the first segment that has the winning kind.
export function mergeSegmentVerdicts(
  rules: readonly Rule[],
  segments: readonly SegmentRecord[],
  steps: readonly Step[],
  lang: Lang = "zh",
): { verdicts: Verdict[]; missingRuleIds: string[] } {
  const order = new Map(steps.map((step, i) => [step.n, i]));
  const okSegments = segments.filter((segment) => segment.status === "ok").sort((a, b) => a.index - b.index);
  const byRule = new Map<string, Verdict[]>();
  for (const segment of okSegments) {
    for (const verdict of segment.verdicts) byRule.set(verdict.ruleId, [...(byRule.get(verdict.ruleId) ?? []), verdict]);
  }

  const verdicts: Verdict[] = [];
  const missingRuleIds: string[] = [];
  for (const rule of rules) {
    const all = byRule.get(rule.id) ?? [];
    const violations = all.filter(isViolated);
    const followed = all.filter(isFollowed);
    const [firstViolation] = violations;
    const [firstFollowed] = followed;
    const [firstAny] = all;
    if (firstViolation !== undefined) {
      const others = violations.length - 1;
      verdicts.push({
        ...firstViolation,
        title: others > 0 ? `${firstViolation.title}${lang === "en" ? ` (${others} more)` : `（另有 ${others} 处）`}` : firstViolation.title,
        evidenceSteps: mergeEvidence(violations, firstViolation.keyStep, order),
      });
    } else if (firstFollowed !== undefined) {
      verdicts.push({ ...firstFollowed, evidenceSteps: mergeEvidence(followed, firstFollowed.keyStep, order) });
    } else if (firstAny !== undefined) {
      verdicts.push(firstAny);
    } else {
      missingRuleIds.push(rule.id);
    }
  }
  return { verdicts, missingRuleIds };
}

function parseRule(raw: unknown, index: number): Rule {
  const bad = () => new Error(`判定文件的第 ${index} 条规则字段缺失或类型不对`);
  if (!isRecord(raw) || !isRecord(raw.source)) throw bad();
  const { id, text, section } = raw;
  const { file, line } = raw.source;
  if (typeof id !== "string" || typeof text !== "string" || typeof section !== "string" || typeof file !== "string" || typeof line !== "number") {
    throw bad();
  }
  return { id, text, section, source: { file, line } };
}

function parseRejection(raw: unknown): Rejection {
  if (!isRecord(raw) || typeof raw.reason !== "string") throw new Error("判定文件的 rejected 条目缺少 reason");
  return typeof raw.ruleId === "string" ? { ruleId: raw.ruleId, reason: raw.reason } : { reason: raw.reason };
}

function parseSegmentRecord(raw: unknown, rules: readonly Rule[], steps: readonly Step[], stepIndex: ReadonlyMap<string, number>): SegmentRecord {
  if (!isRecord(raw)) throw new Error("判定文件的 segments 条目不是对象");
  const { index, firstStep, lastStep, status, error, costUsd, turns, durationMs, verdicts, rejected } = raw;
  if (
    typeof index !== "number" ||
    typeof firstStep !== "string" ||
    typeof lastStep !== "string" ||
    typeof costUsd !== "number" ||
    typeof turns !== "number" ||
    typeof durationMs !== "number" ||
    !Array.isArray(verdicts) ||
    !Array.isArray(rejected)
  ) {
    throw new Error("判定文件的 segments 条目字段缺失或类型不对");
  }
  const label = `第 ${index} 段`;
  const base = { index, firstStep, lastStep, costUsd, turns, durationMs };
  if (status === "failed") {
    if (typeof error !== "string") throw new Error(`${label}失败了但没有 error`);
    return { ...base, status, error, verdicts: [], rejected: [] };
  }
  if (status !== "ok") throw new Error(`${label}的 status 未知：${String(status)}`);
  const first = stepIndex.get(firstStep);
  const last = stepIndex.get(lastStep);
  if (first === undefined || last === undefined || first > last) throw new Error(`${label}的步骤范围 ${firstStep}–${lastStep} 在步骤文件里对不上`);
  const checked = validateVerdicts({ verdicts }, rules, steps.slice(first, last + 1));
  if (checked.rejected.length > 0) {
    const detail = checked.rejected.map((entry) => `${entry.ruleId ?? "?"}：${entry.reason}`).join("；");
    throw new Error(`${label}的判定通不过校验（只能引用本段的步骤）：${detail}`);
  }
  return { ...base, status, verdicts: checked.verdicts, rejected: rejected.map(parseRejection) };
}

// Boundary: the report reads verdicts.json from disk (or from the page), so parse it instead of casting.
// Verdicts are re-validated against the steps, so a report never shows a citation to a missing step.
export function parseVerdictsFile(raw: unknown, steps: readonly Step[]): VerdictsFile {
  if (!isRecord(raw)) throw new Error("判定文件不是 JSON 对象");
  const { sessionId, model, judgedAt, rulesFile, lang, rules, verdicts, rejected, missingRuleIds, segments, costUsd, turns, durationMs } = raw;
  if (
    typeof sessionId !== "string" ||
    typeof model !== "string" ||
    typeof judgedAt !== "string" ||
    typeof rulesFile !== "string" ||
    !(lang === undefined || (typeof lang === "string" && parseLang(lang) === lang)) ||
    !Array.isArray(rules) ||
    !Array.isArray(rejected) ||
    !Array.isArray(segments) ||
    !Array.isArray(missingRuleIds) ||
    !missingRuleIds.every((id): id is string => typeof id === "string") ||
    typeof costUsd !== "number" ||
    typeof turns !== "number" ||
    typeof durationMs !== "number"
  ) {
    throw new Error("判定文件的顶层字段缺失或类型不对");
  }
  const parsedRules = rules.map(parseRule);
  const checked = validateVerdicts({ verdicts }, parsedRules, steps);
  if (checked.rejected.length > 0) {
    const detail = checked.rejected.map(({ ruleId, reason }) => `${ruleId ?? "?"}：${reason}`).join("；");
    throw new Error(`判定文件里有判定通不过校验：${detail}`);
  }
  const stepIndex = new Map(steps.map((step, i) => [step.n, i]));
  return {
    sessionId,
    model,
    judgedAt,
    rulesFile,
    ...(lang === undefined ? {} : { lang: parseLang(lang) }),
    rules: parsedRules,
    verdicts: checked.verdicts,
    rejected: rejected.map(parseRejection),
    missingRuleIds,
    segments: segments.map((segment) => parseSegmentRecord(segment, parsedRules, steps, stepIndex)),
    costUsd,
    turns,
    durationMs,
  };
}

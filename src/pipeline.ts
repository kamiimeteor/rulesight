import { buildJudgePrompt, runSegments } from "./judge.ts";
import type { Lang } from "./lang.ts";
import type { Rule } from "./rules.ts";
export { collectRules, displayPath, type RuleFile, type RuleSet } from "./rule-files.ts";
import { DEFAULT_MAX_SEGMENT_CHARS, planSegments, sliceByTime, type Segment } from "./segment.ts";
import { RULESIGHT_COMMAND, type Session } from "./steps.ts";
import { mergeSegmentVerdicts, type Rejection, type SegmentRecord, type VerdictsFile } from "./verdict.ts";

export const CONCURRENCY = 3;
export const CONFIRM_ABOVE_SEGMENTS = 10;
const USD_PER_MILLION_CHARS = 3;
const SECONDS_PER_SEGMENT = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// The last /rulesight and everything after it (the plan, the judging, retries) is Rulesight's own run, not the work
// being checked, so it is cut off. Earlier runs in the same session stay: they happened before this check.
export function beforeLastInvocation(session: Session): { session: Session; excluded: number } {
  const index = session.steps.findLastIndex(
    (step) => step.kind === "user_message" && step.agent === "main" && RULESIGHT_COMMAND.test(step.text.trim()),
  );
  if (index === -1) return { session, excluded: 0 };
  const steps = session.steps.slice(0, index);
  const endedAt = steps.findLast((step) => step.at !== null)?.at ?? session.endedAt;
  return { session: { ...session, steps, endedAt }, excluded: session.steps.length - index };
}

// Times are UTC. A date-only --to covers that whole day.
export function parseTimeBound(flag: "from" | "to", text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error(`--${flag} 不是有效的日期时间：${text}`);
  return flag === "to" && DATE_ONLY.test(text) ? ms + DAY_MS - 1 : ms;
}

export function parseMaxChars(text: string | undefined): number {
  if (text === undefined) return DEFAULT_MAX_SEGMENT_CHARS;
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--max-chars 必须是正整数：${text}`);
  return value;
}

export function rangeLabel(from: string | undefined, to: string | undefined): string {
  if (from === undefined && to === undefined) return "";
  return `.${[from ?? "begin", to ?? "end"].map((text) => text.replace(/[^0-9A-Za-z-]/g, "-")).join("_")}`;
}

export interface Plan {
  fullSession: Session;
  // The part of the session being judged: all of it unless a time range was given.
  session: Session;
  ranged: boolean;
  segments: Segment[];
  promptChars: number[];
  totalChars: number;
  estimatedCostUsd: number;
  estimatedMinutes: number;
  // Language of the judge prompt and of the verdict text it asks for.
  lang: Lang;
}

export function buildPlan(input: {
  fullSession: Session;
  rules: readonly Rule[];
  fromMs?: number | undefined;
  toMs?: number | undefined;
  maxChars?: number | undefined;
  lang?: Lang | undefined;
}): Plan {
  const { fullSession, rules, fromMs, toMs, maxChars = DEFAULT_MAX_SEGMENT_CHARS, lang = "zh" } = input;
  const ranged = fromMs !== undefined || toMs !== undefined;
  const session = ranged ? sliceByTime(fullSession, { fromMs, toMs }) : fullSession;
  if (session.steps.length === 0) {
    throw new Error(`时间范围内没有步骤（会话 ${fullSession.startedAt} 到 ${fullSession.endedAt}）`);
  }
  const firstInRange = session.steps[0]?.n;
  // Steps before the range still feed the first segment's background.
  const before = ranged ? fullSession.steps.slice(0, fullSession.steps.findIndex((step) => step.n === firstInRange)) : [];
  const segments = planSegments(session, { maxChars, before, lang });
  const promptChars = segments.map((segment) => {
    const prompt = buildJudgePrompt(session, rules, segment, lang);
    return prompt.system.length + prompt.user.length;
  });
  const totalChars = promptChars.reduce((sum, chars) => sum + chars, 0);
  return {
    fullSession,
    session,
    ranged,
    segments,
    promptChars,
    totalChars,
    estimatedCostUsd: (totalChars / 1_000_000) * USD_PER_MILLION_CHARS,
    estimatedMinutes: (Math.ceil(segments.length / CONCURRENCY) * SECONDS_PER_SEGMENT) / 60,
    lang,
  };
}

export async function judgePlan(input: {
  plan: Plan;
  rules: readonly Rule[];
  rulesFile: string;
  model: string;
  onSegmentDone?: (record: SegmentRecord) => void;
}): Promise<VerdictsFile> {
  const { plan, rules, rulesFile, model, onSegmentDone } = input;
  const { session, fullSession, segments, lang } = plan;
  const records = await runSegments({ session, rules, segments, model, lang, concurrency: CONCURRENCY, onSegmentDone });
  const { verdicts, missingRuleIds } = mergeSegmentVerdicts(rules, records, fullSession.steps, lang);
  const segmentLabel = (index: number) => (lang === "en" ? `Segment ${index}: ` : `第 ${index} 段：`);
  const rejected: Rejection[] = records.flatMap((record) =>
    record.rejected.map((rejection) => (records.length > 1 ? { ...rejection, reason: `${segmentLabel(record.index)}${rejection.reason}` } : rejection)),
  );
  const sum = (pick: (record: SegmentRecord) => number) => records.reduce((total, record) => total + pick(record), 0);
  return {
    sessionId: session.sessionId,
    model,
    judgedAt: new Date().toISOString(),
    rulesFile,
    lang,
    rules: [...rules],
    verdicts,
    rejected,
    missingRuleIds,
    segments: records,
    costUsd: sum((record) => record.costUsd),
    turns: sum((record) => record.turns),
    durationMs: sum((record) => record.durationMs),
  };
}

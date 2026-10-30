import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildJudgePrompt, runSegments } from "./judge.ts";
import { parseRules, type Rule } from "./rules.ts";
import { DEFAULT_MAX_SEGMENT_CHARS, planSegments, sliceByTime, type Segment } from "./segment.ts";
import type { Session } from "./steps.ts";
import { mergeSegmentVerdicts, type Rejection, type SegmentRecord, type VerdictsFile } from "./verdict.ts";

export const CONCURRENCY = 3;
export const CONFIRM_ABOVE_SEGMENTS = 10;
const USD_PER_MILLION_CHARS = 3;
const SECONDS_PER_SEGMENT = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function displayPath(file: string): string {
  const home = os.homedir();
  return file === home || file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
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

export interface RuleFile {
  displayPath: string;
  count: number;
}

export interface RuleSet {
  rules: Rule[];
  files: RuleFile[];
  // Rule files that were looked for and not there, for the plan to mention.
  missing: string[];
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR")) return null;
    throw error;
  }
}

// v0.1 reads the user's global CLAUDE.md and the session project's CLAUDE.md. Ids run on across files (R1, R2, ...).
export async function collectRules(cwd: string | null): Promise<RuleSet> {
  const candidates = [path.join(os.homedir(), ".claude", "CLAUDE.md"), ...(cwd === null ? [] : [path.join(path.resolve(cwd), "CLAUDE.md")])];
  const rules: Rule[] = [];
  const files: RuleFile[] = [];
  const missing: string[] = [];
  for (const file of [...new Set(candidates)]) {
    const markdown = await readIfExists(file);
    if (markdown === null) {
      missing.push(displayPath(file));
      continue;
    }
    const parsed = parseRules(markdown, displayPath(file));
    files.push({ displayPath: displayPath(file), count: parsed.length });
    for (const rule of parsed) rules.push({ ...rule, id: `R${rules.length + 1}` });
  }
  return { rules, files, missing };
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
}

export function buildPlan(input: {
  fullSession: Session;
  rules: readonly Rule[];
  fromMs?: number | undefined;
  toMs?: number | undefined;
  maxChars?: number | undefined;
}): Plan {
  const { fullSession, rules, fromMs, toMs, maxChars = DEFAULT_MAX_SEGMENT_CHARS } = input;
  const ranged = fromMs !== undefined || toMs !== undefined;
  const session = ranged ? sliceByTime(fullSession, { fromMs, toMs }) : fullSession;
  if (session.steps.length === 0) {
    throw new Error(`时间范围内没有步骤（会话 ${fullSession.startedAt} 到 ${fullSession.endedAt}）`);
  }
  const firstInRange = session.steps[0]?.n;
  // Steps before the range still feed the first segment's background.
  const before = ranged ? fullSession.steps.slice(0, fullSession.steps.findIndex((step) => step.n === firstInRange)) : [];
  const segments = planSegments(session, { maxChars, before });
  const promptChars = segments.map((segment) => {
    const prompt = buildJudgePrompt(session, rules, segment);
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
  const { session, fullSession, segments } = plan;
  const records = await runSegments({ session, rules, segments, model, concurrency: CONCURRENCY, onSegmentDone });
  const { verdicts, missingRuleIds } = mergeSegmentVerdicts(rules, records, fullSession.steps);
  const rejected: Rejection[] = records.flatMap((record) =>
    record.rejected.map((rejection) => (records.length > 1 ? { ...rejection, reason: `第 ${record.index} 段：${rejection.reason}` } : rejection)),
  );
  const sum = (pick: (record: SegmentRecord) => number) => records.reduce((total, record) => total + pick(record), 0);
  return {
    sessionId: session.sessionId,
    model,
    judgedAt: new Date().toISOString(),
    rulesFile,
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

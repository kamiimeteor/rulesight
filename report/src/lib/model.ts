import type { Lang } from "../../../src/lang.ts";
import type { ReportData } from "../../../src/report.ts";
import { STRINGS, type Strings } from "./i18n.ts";
import type { Rule } from "../../../src/rules.ts";
import type { Step } from "../../../src/steps.ts";
import { VERDICT_KINDS, type Verdict, type VerdictKind, type ViolatedVerdict } from "../../../src/verdict.ts";

export interface ReportModel {
  data: ReportData;
  lang: Lang;
  t: Strings;
  rules: ReadonlyMap<string, Rule>;
  steps: ReadonlyMap<string, Step>;
  stepOrder: readonly string[];
  stepIndex: ReadonlyMap<string, number>;
  verdicts: ReadonlyMap<string, Verdict>;
  byKind: Readonly<Record<VerdictKind, readonly Verdict[]>>;
  violationsAtStep: ReadonlyMap<string, readonly ViolatedVerdict[]>;
}

// Violated first: it is what the reader came for, and the default tab follows this order.
export const VERDICT_TABS = ["violated", "followed", "not_applicable"] as const satisfies readonly VerdictKind[];

const LAST = Number.MAX_SAFE_INTEGER;

function ruleNumber(id: string): number {
  return Number(id.replace(/\D/g, "")) || 0;
}

export function keyStepOf(verdict: Verdict): string | null {
  return verdict.verdict === "not_applicable" ? null : verdict.keyStep;
}

export function evidenceOf(verdict: Verdict): readonly string[] {
  return verdict.verdict === "not_applicable" ? [] : verdict.evidenceSteps;
}

export function buildModel(data: ReportData): ReportModel {
  const { session, verdicts: file } = data;
  const stepOrder = session.steps.map((step) => step.n);
  const stepIndex = new Map(stepOrder.map((n, i) => [n, i]));

  const position = (verdict: Verdict): number => {
    const key = keyStepOf(verdict);
    return key === null ? LAST : (stepIndex.get(key) ?? LAST);
  };
  const sorted = (kind: VerdictKind): Verdict[] =>
    file.verdicts
      .filter((verdict) => verdict.verdict === kind)
      .sort((a, b) => position(a) - position(b) || ruleNumber(a.ruleId) - ruleNumber(b.ruleId));

  const violationsAtStep = new Map<string, ViolatedVerdict[]>();
  for (const verdict of file.verdicts) {
    if (verdict.verdict !== "violated") continue;
    const list = violationsAtStep.get(verdict.keyStep) ?? [];
    list.push(verdict);
    violationsAtStep.set(verdict.keyStep, list);
  }

  // Verdicts files from before 2026-10-30 carry no language; they were all written in Chinese.
  const lang = file.lang ?? "zh";
  return {
    data,
    lang,
    t: STRINGS[lang],
    rules: new Map(file.rules.map((rule) => [rule.id, rule])),
    steps: new Map(session.steps.map((step) => [step.n, step])),
    stepOrder,
    stepIndex,
    verdicts: new Map(file.verdicts.map((verdict) => [verdict.ruleId, verdict])),
    byKind: { violated: sorted("violated"), followed: sorted("followed"), not_applicable: sorted("not_applicable") },
    violationsAtStep,
  };
}

// parseReportData already proved every verdict's rule and cited steps exist, so a miss here is a bug.
function must<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const found = map.get(key);
  if (found === undefined) throw new Error(`报告数据里找不到${what} ${key}`);
  return found;
}

export const stepOf = (model: ReportModel, n: string): Step => must(model.steps, n, "步骤");
export const ruleOf = (model: ReportModel, id: string): Rule => must(model.rules, id, "规则");
export const verdictOf = (model: ReportModel, id: string): Verdict => must(model.verdicts, id, "判定");

export function defaultRuleId(model: ReportModel): string | undefined {
  for (const kind of VERDICT_TABS) {
    const first = model.byKind[kind][0];
    if (first !== undefined) return first.ruleId;
  }
  return undefined;
}

// The order a reviewer walks the report in: tabs left to right, rows top to bottom.
export function reviewOrder(model: ReportModel): string[] {
  return VERDICT_TABS.flatMap((kind) => model.byKind[kind].map((verdict) => verdict.ruleId));
}

export function nextUnreviewed(model: ReportModel, after: string, reviewed: ReadonlySet<string>): string | undefined {
  const order = reviewOrder(model);
  const start = order.indexOf(after);
  return [...order.slice(start + 1), ...order.slice(0, start)].find((id) => !reviewed.has(id));
}

export function isVerdictKind(value: string): value is VerdictKind {
  return VERDICT_KINDS.some((kind) => kind === value);
}

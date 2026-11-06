import { isRecord, parseSession, type Session } from "./steps.ts";
import { parseVerdictsFile, type VerdictsFile } from "./verdict.ts";

// The one object a report page is built from: embedded by scripts/report.ts, parsed again by the page.
export interface ReportData {
  session: Session;
  verdicts: VerdictsFile;
}

export function parseReportData(raw: unknown): ReportData {
  if (!isRecord(raw)) throw new Error("报告数据不是 JSON 对象");
  const session = parseSession(raw.session);
  const verdicts = parseVerdictsFile(raw.verdicts, session.steps);
  if (verdicts.sessionId !== session.sessionId) {
    throw new Error(`判定文件（${verdicts.sessionId}）和步骤文件（${session.sessionId}）不是同一个会话`);
  }
  return { session, verdicts };
}

// The page only shows original text for cited steps; every other step needs just its kind and summary for the
// progress bar. Dropping the rest keeps a report for a 26k-step session as small as one for a short session.
export function slimForReport(data: ReportData): ReportData {
  const { session, verdicts } = data;
  const index = new Map(session.steps.map((step, i) => [step.n, i]));
  const first = verdicts.segments[0];
  const last = verdicts.segments.at(-1);
  const from = first === undefined ? 0 : (index.get(first.firstStep) ?? 0);
  const to = last === undefined ? session.steps.length - 1 : (index.get(last.lastStep) ?? session.steps.length - 1);
  const cited = new Set(verdicts.verdicts.flatMap((verdict) => (verdict.verdict === "not_applicable" ? [] : verdict.evidenceSteps)));
  // A ranged run can cite a user message from before the range (consent given on an earlier day), so cited steps are always kept.
  const steps = session.steps.filter((step, i) => (i >= from && i <= to) || cited.has(step.n)).map((step) => {
    if (cited.has(step.n)) return step;
    return step.kind === "tool_call"
      ? { ...step, tool: { name: step.tool.name, input: {}, output: null, isError: step.tool.isError }, raw: [] }
      : { ...step, text: "", raw: [] };
  });
  // A ranged run covers only part of the session, so the header's start time and duration follow the steps in range.
  const times = session.steps.slice(from, to + 1).map((step) => step.at).filter((at): at is string => at !== null);
  const startedAt = from === 0 ? session.startedAt : (times[0] ?? session.startedAt);
  const endedAt = to === session.steps.length - 1 ? session.endedAt : (times.at(-1) ?? session.endedAt);
  return { session: { ...session, steps, startedAt, endedAt }, verdicts };
}

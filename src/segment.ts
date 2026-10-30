import { clip, formatStep, STEP_SEPARATOR } from "./judge.ts";
import type { Lang } from "./lang.ts";
import { COMPACTION_LABELS, type Session, type Step } from "./steps.ts";

export const DEFAULT_MAX_SEGMENT_CHARS = 200_000;

const COMPACTIONS: ReadonlySet<string> = new Set(Object.values(COMPACTION_LABELS).map((labels) => labels.compaction));
const COMPACTION_SUMMARIES: ReadonlySet<string> = new Set(Object.values(COMPACTION_LABELS).map((labels) => labels.summary));
const RECENT_USER_MESSAGES = 5;
const RECENT_USER_MESSAGE_CHARS = 500;

export interface SegmentPosition {
  // 1-based.
  index: number;
  total: number;
  firstStep: string;
  lastStep: string;
}

export interface SegmentContext {
  // Text of the latest compaction summary before this segment.
  summary: string | null;
  // The last main-session user messages before this segment, oldest first.
  recentUserMessages: string[];
  position: SegmentPosition;
}

export interface Segment {
  index: number;
  steps: Step[];
  context: SegmentContext;
}

// Where a cut right before this unit would fall, best first.
const CUT_PREFERENCE = ["compaction", "user", "main", "sub"] as const;
type CutKind = (typeof CUT_PREFERENCE)[number];

interface Unit {
  steps: Step[];
  chars: number;
  cut: CutKind;
}

function cutKindOf(step: Step): CutKind {
  if (step.parentStep !== null) return "sub";
  if (step.kind === "system" && COMPACTIONS.has(step.summary)) return "compaction";
  return step.kind === "user_message" ? "user" : "main";
}

function renderedChars(lengths: readonly number[]): number {
  return lengths.reduce((sum, length) => sum + length, 0) + STEP_SEPARATOR.length * Math.max(0, lengths.length - 1);
}

// A main step and its sub-steps are one unit when they fit in a segment; a block that cannot fit is split at every step.
function toUnits(steps: readonly Step[], maxChars: number, lang: Lang): Unit[] {
  const blocks: { steps: Step[]; lengths: number[] }[] = [];
  for (const step of steps) {
    const length = formatStep(step, lang).length;
    const block = step.parentStep === null ? undefined : blocks.at(-1);
    if (block === undefined) blocks.push({ steps: [step], lengths: [length] });
    else {
      block.steps.push(step);
      block.lengths.push(length);
    }
  }
  return blocks.flatMap(({ steps: blockSteps, lengths }): Unit[] => {
    const [head] = blockSteps;
    if (head === undefined) return [];
    const chars = renderedChars(lengths);
    if (chars <= maxChars) return [{ steps: blockSteps, chars, cut: cutKindOf(head) }];
    return blockSteps.map((step, i) => ({ steps: [step], chars: lengths[i] ?? 0, cut: cutKindOf(step) }));
  });
}

// How many leading units to keep when the next unit does not fit. Cuts that leave the segment under half full
// are skipped, so a compaction right after the previous cut does not produce a tiny segment.
function chooseCut(current: readonly Unit[], next: Unit, maxChars: number): number {
  const filled: number[] = [0];
  for (const [i, unit] of current.entries()) filled.push((filled[i] ?? 0) + unit.chars + (i === 0 ? 0 : STEP_SEPARATOR.length));
  const minFill = Math.floor(maxChars / 2);
  for (const kind of CUT_PREFERENCE) {
    for (let keep = current.length; keep >= 1; keep--) {
      const cutBefore = keep < current.length ? current[keep] : next;
      if (cutBefore?.cut === kind && (filled[keep] ?? 0) >= minFill) return keep;
    }
  }
  return current.length;
}

function splitUnits(units: readonly Unit[], maxChars: number): Unit[][] {
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  for (const unit of units) {
    while (current.length > 0 && size + STEP_SEPARATOR.length + unit.chars > maxChars) {
      const keep = chooseCut(current, unit, maxChars);
      groups.push(current.slice(0, keep));
      current = current.slice(keep);
      size = renderedChars(current.map((u) => u.chars));
    }
    size = current.length === 0 ? unit.chars : size + STEP_SEPARATOR.length + unit.chars;
    current.push(unit);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function planSegments(
  session: Pick<Session, "steps">,
  options: { maxChars?: number; before?: readonly Step[]; lang?: Lang } = {},
): Segment[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_SEGMENT_CHARS;
  const lang = options.lang ?? "zh";
  if (!Number.isInteger(maxChars) || maxChars <= 0) throw new Error(`maxChars 必须是正整数：${maxChars}`);
  const groups = splitUnits(toUnits(session.steps, maxChars, lang), maxChars).map((group) => group.flatMap((unit) => unit.steps));

  let summary: string | null = null;
  let recent: string[] = [];
  const remember = (steps: readonly Step[]) => {
    for (const step of steps) {
      if (step.parentStep !== null) continue;
      if (step.kind === "system" && COMPACTION_SUMMARIES.has(step.summary)) summary = step.text;
      else if (step.kind === "user_message") recent = [...recent, step.text].slice(-RECENT_USER_MESSAGES);
    }
  };
  // A ranged run still needs what came before the range, or the first segment judges without the backstory.
  remember(options.before ?? []);
  return groups.map((steps, i): Segment => {
    const first = steps[0];
    const last = steps.at(-1);
    if (first === undefined || last === undefined) throw new Error("切段切出了空的一段");
    const segment: Segment = {
      index: i + 1,
      steps,
      context: {
        summary,
        recentUserMessages: recent.map((text) => clip(text, RECENT_USER_MESSAGE_CHARS, lang)),
        position: { index: i + 1, total: groups.length, firstStep: first.n, lastStep: last.n },
      },
    };
    remember(steps);
    return segment;
  });
}

// Keeps the main steps whose `at` is in range, with their sub-steps. A main step without a time cannot be placed, so it is dropped.
export function sliceByTime(session: Session, range: { fromMs?: number; toMs?: number }): Session {
  const { fromMs = Number.NEGATIVE_INFINITY, toMs = Number.POSITIVE_INFINITY } = range;
  let keep = false;
  const steps = session.steps.filter((step) => {
    if (step.parentStep === null) {
      const ms = step.at === null ? Number.NaN : Date.parse(step.at);
      keep = ms >= fromMs && ms <= toMs;
    }
    return keep;
  });
  return { ...session, steps };
}

import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { evidenceOf, keyStepOf, stepOf, type ReportModel } from "@/lib/model";
import { TONE } from "@/lib/tone";
import { cn } from "@/lib/utils";
import type { Verdict } from "../../../src/verdict.ts";

interface Props {
  model: ReportModel;
  selected: Verdict | undefined;
  onSelectRule: (ruleId: string) => void;
}

// The key label hugs the bar's edges instead of overflowing them.
function labelTransform(fraction: number): string {
  if (fraction < 0.08) return "translateX(-12px)";
  if (fraction > 0.92) return "translateX(calc(-100% + 12px))";
  return "translateX(-50%)";
}

export function ProgressBar({ model, selected, onSelectRule }: Props) {
  const { stepOrder, t } = model;
  const keyStep = selected && keyStepOf(selected);
  const evidence = new Set(selected ? evidenceOf(selected) : []);
  const tone = selected && TONE[selected.verdict];
  const firstStep = stepOrder[0];
  const lastStep = stepOrder.at(-1);

  return (
    <Card className="mb-3 gap-0 rounded-lg px-4 py-2.5">
      <div className="relative h-6">
        {stepOrder.map((n, i) => {
          const fraction = (i + 0.5) / stepOrder.length;
          const left = `${fraction * 100}%`;
          if (n === keyStep && tone) {
            return (
              <span
                key={n}
                className={cn("absolute top-0 rounded-md px-2 text-xs leading-5 font-medium whitespace-nowrap", tone.solid)}
                style={{ left, transform: labelTransform(fraction) }}
              >
                {t.keyStepLabel(n)}
              </span>
            );
          }
          const other = model.violationsAtStep.get(n)?.find((verdict) => verdict.ruleId !== selected?.ruleId);
          if (!other) return null;
          return (
            <Tooltip key={n}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t.violationAt(n, other.title)}
                  className="absolute -bottom-1 -translate-x-1/2 cursor-pointer rounded px-2 py-1 text-xs leading-none text-violated hover:bg-violated-soft"
                  style={{ left }}
                  onClick={() => onSelectRule(other.ruleId)}
                >
                  ▼
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {t.violationAtHint(n, other.title)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1 flex h-[30px] items-end gap-[2px]">
        {stepOrder.map((n) => {
          const step = stepOf(model, n);
          const isKey = n === keyStep;
          const isEvidence = evidence.has(n);
          return (
            <Tooltip key={n}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "min-w-[2px] flex-1 rounded-[2px] bg-zinc-300",
                    n.includes(".") ? "h-1.5" : "h-2.5",
                    isEvidence && tone && !isKey && cn("h-[22px]", tone.tint),
                    isKey && tone && cn("h-[30px]", tone.bar),
                  )}
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {t.stepTooltip(n, t.stepKind[step.kind], step.summary)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{firstStep !== undefined && t.step(firstStep)}</span>
        <span>{t.barLegend}</span>
        <span>{lastStep !== undefined && t.step(lastStep)}</span>
      </div>
    </Card>
  );
}

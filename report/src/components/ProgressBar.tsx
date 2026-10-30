import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { evidenceOf, keyStepOf, stepOf, type ReportModel } from "@/lib/model";
import { STEP_KIND_LABEL, TONE } from "@/lib/tone";
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
  const { stepOrder } = model;
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
                第 {n} 步 · 判定依据
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
                  aria-label={`第 ${n} 步有违反：${other.title}`}
                  className="absolute -bottom-1 -translate-x-1/2 cursor-pointer rounded px-2 py-1 text-xs leading-none text-violated hover:bg-violated-soft"
                  style={{ left }}
                  onClick={() => onSelectRule(other.ruleId)}
                >
                  ▼
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                第 {n} 步有违反：{other.title}（点击查看）
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
                第 {n} 步 · {STEP_KIND_LABEL[step.kind]}：{step.summary}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>第 {firstStep} 步</span>
        <span>每根细条是一步 · 加高的是当前规则的证据，实色那步是判定依据 · ▼ 别处的违反，点击查看</span>
        <span>第 {lastStep} 步</span>
      </div>
    </Card>
  );
}

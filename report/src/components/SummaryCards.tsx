import { Card } from "@/components/ui/card";
import { VERDICT_TABS, type ReportModel } from "@/lib/model";
import { TONE } from "@/lib/tone";
import { cn } from "@/lib/utils";
import type { VerdictKind } from "../../../src/verdict.ts";

export function SummaryCards({ model, onSelectKind }: { model: ReportModel; onSelectKind: (kind: VerdictKind) => void }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-3">
      {VERDICT_TABS.map((kind) => {
        const count = model.byKind[kind].length;
        return (
          <Card key={kind} className="gap-0 rounded-lg py-0">
            <button
              type="button"
              disabled={count === 0}
              onClick={() => onSelectKind(kind)}
              className="w-full rounded-lg px-4 py-3.5 text-left enabled:cursor-pointer"
            >
              <b className={cn("block text-[28px] leading-tight font-semibold tracking-tight", TONE[kind].text)}>{count}</b>
              <div className="text-[13px] text-muted-foreground">{model.t.summaryCaption[kind]}</div>
            </button>
          </Card>
        );
      })}
    </div>
  );
}

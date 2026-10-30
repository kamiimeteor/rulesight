import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { ProgressBar } from "@/components/ProgressBar";
import { RuleDetail } from "@/components/RuleDetail";
import { RuleList } from "@/components/RuleList";
import { SummaryCards } from "@/components/SummaryCards";
import { Card } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFeedback } from "@/hooks/use-feedback";
import { defaultRuleId, nextUnreviewed, verdictOf, type ReportModel } from "@/lib/model";
import type { VerdictKind } from "../../src/verdict.ts";

export function App({ model }: { model: ReportModel }) {
  const { session } = model.data;
  const [selected, setSelected] = useState(() => ({ ruleId: defaultRuleId(model) }));
  const { feedback, mark } = useFeedback(session.sessionId, new Set(model.verdicts.keys()));

  useEffect(() => {
    document.title = `Rulesight · ${session.title}`;
  }, [session.title]);

  const verdict = selected.ruleId === undefined ? undefined : verdictOf(model, selected.ruleId);
  // The tab always follows the selected rule, so picking a rule anywhere lands on its tab.
  const tab = verdict?.verdict ?? "violated";
  const selectRule = (ruleId: string) => setSelected({ ruleId });
  const next = selected.ruleId === undefined ? undefined : nextUnreviewed(model, selected.ruleId, new Set(Object.keys(feedback)));
  const selectKind = (kind: VerdictKind) => {
    const first = model.byKind[kind][0];
    if (first !== undefined) selectRule(first.ruleId);
  };

  return (
    <TooltipProvider delayDuration={100}>
      <div className="mx-auto flex h-screen min-h-[640px] max-w-[1240px] flex-col p-6 text-sm leading-[1.55]">
        <Header model={model} reviewed={Object.keys(feedback).length} />
        <SummaryCards model={model} onSelectKind={selectKind} />
        <ProgressBar model={model} selected={verdict} onSelectRule={selectRule} />
        {/* The columns take whatever height is left, so the review footer stays on screen without scrolling the page. */}
        <div className="grid min-h-[320px] flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3">
          <RuleList model={model} tab={tab} feedback={feedback} selectedRuleId={selected.ruleId} onSelectKind={selectKind} onSelectRule={selectRule} />
          <Card className="flex min-h-0 flex-col gap-0 overflow-hidden rounded-lg py-0">
            {verdict && (
              <RuleDetail key={verdict.ruleId} model={model} verdict={verdict} feedback={feedback} onFeedback={mark} onNext={next === undefined ? undefined : () => selectRule(next)} />
            )}
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}

import { useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { fileName } from "@/lib/format";
import { VERDICT_TABS, isVerdictKind, keyStepOf, ruleOf, stepOf, type ReportModel } from "@/lib/model";
import { TONE } from "@/lib/tone";
import { cn } from "@/lib/utils";
import type { FeedbackMap } from "@/hooks/use-feedback";
import type { Verdict, VerdictKind } from "../../../src/verdict.ts";

interface Props {
  model: ReportModel;
  tab: VerdictKind;
  feedback: FeedbackMap;
  selectedRuleId: string | undefined;
  onSelectKind: (kind: VerdictKind) => void;
  onSelectRule: (ruleId: string) => void;
}

export function RuleList({ model, tab, feedback, selectedRuleId, onSelectKind, onSelectRule }: Props) {
  return (
    <Card className="min-h-0 gap-0 overflow-hidden rounded-lg py-0">
      <Tabs
        value={tab}
        onValueChange={(value) => isVerdictKind(value) && onSelectKind(value)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="mx-3 mt-3 mb-2 w-[calc(100%-1.5rem)]">
          {VERDICT_TABS.map((kind) => (
            <TabsTrigger key={kind} value={kind} disabled={model.byKind[kind].length === 0} className="h-[30px] data-[state=active]:bg-card">
              {model.t.verdict[kind]}
              <span className={cn("rounded-[5px] px-[5px] font-mono text-[11.5px] leading-[18px]", TONE[kind].soft)}>
                {model.byKind[kind].length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {VERDICT_TABS.map((kind) => (
          <TabsContent key={kind} value={kind} className="min-h-0 overflow-auto px-2 pb-2">
            {model.byKind[kind].map((verdict) => (
              <RuleRow
                key={verdict.ruleId}
                model={model}
                verdict={verdict}
                selected={verdict.ruleId === selectedRuleId}
                review={feedback[verdict.ruleId]}
                onSelect={() => onSelectRule(verdict.ruleId)}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

interface RowProps {
  model: ReportModel;
  verdict: Verdict;
  selected: boolean;
  review: FeedbackMap[string] | undefined;
  onSelect: () => void;
}

function RuleRow({ model, verdict, selected, review, onSelect }: RowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Selecting from the progress bar can pick a row that is scrolled out of view.
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const tone = TONE[verdict.verdict];
  const { t } = model;
  const keyStep = keyStepOf(verdict);
  const rule = ruleOf(model, verdict.ruleId);
  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected}
      onClick={onSelect}
      className={cn(
        "relative mb-px block w-full cursor-pointer rounded-lg py-[9px] pr-2.5 pl-3 text-left hover:bg-muted",
        selected && "bg-muted",
      )}
    >
      {selected && <span className={cn("absolute top-2 bottom-2 left-0 w-[3px] rounded-sm", tone.bar)} />}
      <div className="line-clamp-2 leading-[1.45] font-medium">{verdict.title}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        {keyStep !== null && (
          <>
            <span className={cn("font-mono", tone.text)}>{t.step(keyStep)}</span>
            <span>{t.stepKind[stepOf(model, keyStep).kind]}</span>
          </>
        )}
        <span>{t.ruleSource(fileName(rule.source.file), rule.source.line)}</span>
        {review !== undefined && (
          <span className={cn("ml-auto", review === "right" ? "text-followed" : "text-violated")}>
            {review === "right" ? t.markedRight : t.markedWrong}
          </span>
        )}
      </div>
    </button>
  );
}

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OriginalText } from "@/components/OriginalText";
import type { Feedback, FeedbackMap } from "@/hooks/use-feedback";
import { downloadText } from "@/lib/download";
import { fileName } from "@/lib/format";
import type { Strings } from "@/lib/i18n";
import { evidenceOf, keyStepOf, ruleOf, stepOf, type ReportModel } from "@/lib/model";
import { TONE } from "@/lib/tone";
import { cn } from "@/lib/utils";
import type { Verdict } from "../../../src/verdict.ts";

const SMALL_BUTTON = "h-7 px-2.5 text-[12.5px]";

interface Props {
  model: ReportModel;
  verdict: Verdict;
  feedback: FeedbackMap;
  onFeedback: (ruleId: string, value: Feedback) => void;
  onNext: (() => void) | undefined;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="mt-5 mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </>
  );
}

export function RuleDetail({ model, verdict, feedback, onFeedback, onNext }: Props) {
  const marked = feedback[verdict.ruleId];
  const rule = ruleOf(model, verdict.ruleId);
  const tone = TONE[verdict.verdict];
  const { t } = model;
  const keyStep = keyStepOf(verdict);
  const evidence = [...evidenceOf(verdict)].sort((a, b) => (model.stepIndex.get(a) ?? 0) - (model.stepIndex.get(b) ?? 0));

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-[22px] py-5">
        <div className="flex items-center gap-2.5">
          <Badge variant="secondary" className={cn("h-[22px] rounded-md px-2", tone.soft)}>
            {t.verdict[verdict.verdict]}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {t.ruleSource(fileName(rule.source.file), rule.source.line)}
          </span>
        </div>
        <h2 className="mt-3 mb-1.5 text-lg leading-[1.45] font-semibold tracking-tight">{verdict.title}</h2>
        <div className="rounded-lg bg-muted px-3 py-2 text-[13px] text-zinc-700">{t.ruleText(rule.text)}</div>

        <Section title={t.whatHappened}>
          <div>{verdict.reason}</div>
        </Section>

        {evidence.length > 0 && (
          <Section title={t.evidence}>
            <ol className="ml-[5px] border-l pl-4">
              {evidence.map((n) => {
                const step = stepOf(model, n);
                const isKey = n === keyStep;
                return (
                  <li key={n} className="relative mb-3">
                    <span
                      className={cn(
                        "absolute top-1.5 -left-[21px] size-[9px] rounded-full border-[1.5px]",
                        isKey ? "border-foreground bg-foreground" : "border-ring bg-white",
                      )}
                    />
                    <div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t.stepKindSeparator(n, t.stepKind[step.kind])}{" "}
                      </span>
                      <span className={cn(isKey && "font-semibold")}>{step.summary}</span>
                      {isKey && (
                        <Badge variant="secondary" className="ml-2 h-5 rounded-md bg-muted px-2 text-foreground">
                          {t.keyStepBadge}
                        </Badge>
                      )}
                    </div>
                    {isKey ? (
                      <OriginalText step={step} t={t} />
                    ) : (
                      <details>
                        <summary className="mt-0.5 cursor-pointer text-[12.5px] text-muted-foreground">{t.showOriginal}</summary>
                        <OriginalText step={step} t={t} />
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}

        {verdict.verdict === "violated" && (
          <Section title={t.howToFix}>
            <div>{verdict.suggestion}</div>
            <FixPrompt text={verdict.fixPrompt} t={t} />
          </Section>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-card px-[22px] py-3">
        <span className="font-medium">{t.isThisRight}</span>
        {(
          [
            ["right", t.right],
            ["wrong", t.wrong],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={feedback[verdict.ruleId] === value ? "default" : "outline"}
            size="sm"
            className={cn(SMALL_BUTTON, feedback[verdict.ruleId] !== value && "bg-card hover:bg-muted")}
            onClick={() => onFeedback(verdict.ruleId, value)}
          >
            {label}
          </Button>
        ))}
        {marked !== undefined && (
          <span className={cn("text-[12.5px]", marked === "right" ? "text-followed" : "text-violated")}>
            {t.recorded(marked === "right" ? t.right : t.wrong)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ExportReviewButton model={model} feedback={feedback} />
          {onNext && (
            <Button size="sm" variant={marked === undefined ? "outline" : "default"} className={SMALL_BUTTON} onClick={onNext}>
              {t.next}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function FixPrompt({ text, t }: { text: string; t: Strings }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={box} className="mt-2 rounded-lg border border-orange-200 bg-violated-soft px-3 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
      <CopyButton text={text} fallbackTarget={box} t={t} />
    </>
  );
}

// The async Clipboard API is blocked in embedded browsers and some file:// contexts; execCommand still works there.
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function selectContents(target: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function CopyButton({ text, fallbackTarget, t }: { text: string; fallbackTarget: RefObject<HTMLDivElement | null>; t: Strings }) {
  const [status, setStatus] = useState<"idle" | "copied" | "selected">("idle");
  const copy = async () => {
    if (await writeClipboard(text)) {
      setStatus("copied");
      return;
    }
    if (fallbackTarget.current) selectContents(fallbackTarget.current);
    setStatus("selected");
  };
  return (
    <Button size="sm" className={cn(SMALL_BUTTON, "mt-2")} onClick={copy}>
      {status === "idle" ? t.copy : status === "copied" ? t.copied : t.selected}
    </Button>
  );
}

function ExportReviewButton({ model, feedback }: { model: ReportModel; feedback: FeedbackMap }) {
  const { session, verdicts } = model.data;
  const exportReview = () => {
    const review = { sessionId: session.sessionId, model: verdicts.model, judgedAt: verdicts.judgedAt, feedback };
    downloadText(`rulesight-review-${session.sessionId.slice(0, 8)}.json`, "application/json", JSON.stringify(review, null, 2));
  };
  return (
    <Button variant="outline" size="sm" className={cn(SMALL_BUTTON, "bg-card hover:bg-muted")} onClick={exportReview}>
      {model.t.exportReview(Object.keys(feedback).length, verdicts.verdicts.length)}
    </Button>
  );
}

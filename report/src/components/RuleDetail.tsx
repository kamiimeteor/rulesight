import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OriginalText } from "@/components/OriginalText";
import type { Feedback, FeedbackMap } from "@/hooks/use-feedback";
import { downloadText } from "@/lib/download";
import { fileName } from "@/lib/format";
import { evidenceOf, keyStepOf, ruleOf, stepOf, type ReportModel } from "@/lib/model";
import { STEP_KIND_LABEL, TONE } from "@/lib/tone";
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
  const keyStep = keyStepOf(verdict);
  const evidence = [...evidenceOf(verdict)].sort((a, b) => (model.stepIndex.get(a) ?? 0) - (model.stepIndex.get(b) ?? 0));

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-[22px] py-5">
        <div className="flex items-center gap-2.5">
          <Badge variant="secondary" className={cn("h-[22px] rounded-md px-2", tone.soft)}>
            {tone.label}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {fileName(rule.source.file)} 第 {rule.source.line} 行
          </span>
        </div>
        <h2 className="mt-3 mb-1.5 text-lg leading-[1.45] font-semibold tracking-tight">{verdict.title}</h2>
        <div className="rounded-lg bg-muted px-3 py-2 text-[13px] text-zinc-700">规则：{rule.text}</div>

        <Section title="发生了什么">
          <div>{verdict.reason}</div>
        </Section>

        {evidence.length > 0 && (
          <Section title="证据">
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
                        第 {n} 步 · {STEP_KIND_LABEL[step.kind]}{" "}
                      </span>
                      <span className={cn(isKey && "font-semibold")}>{step.summary}</span>
                      {isKey && (
                        <Badge variant="secondary" className="ml-2 h-5 rounded-md bg-muted px-2 text-foreground">
                          判定依据
                        </Badge>
                      )}
                    </div>
                    {isKey ? (
                      <OriginalText step={step} />
                    ) : (
                      <details>
                        <summary className="mt-0.5 cursor-pointer text-[12.5px] text-muted-foreground">看原文</summary>
                        <OriginalText step={step} />
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}

        {verdict.verdict === "violated" && (
          <Section title="建议怎么处理">
            <div>{verdict.suggestion}</div>
            <FixPrompt text={verdict.fixPrompt} />
          </Section>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-card px-[22px] py-3">
        <span className="font-medium">这条判得对吗</span>
        {(
          [
            ["right", "判对了"],
            ["wrong", "判错了"],
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
            已记录：{marked === "right" ? "判对了" : "判错了"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ExportReviewButton model={model} feedback={feedback} />
          {onNext && (
            <Button size="sm" variant={marked === undefined ? "outline" : "default"} className={SMALL_BUTTON} onClick={onNext}>
              下一条 →
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function FixPrompt({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={box} className="mt-2 rounded-lg border border-orange-200 bg-violated-soft px-3 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
      <CopyButton text={text} fallbackTarget={box} />
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

function CopyButton({ text, fallbackTarget }: { text: string; fallbackTarget: RefObject<HTMLDivElement | null> }) {
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
      {status === "idle" ? "复制给 agent" : status === "copied" ? "已复制" : "已选中，按 ⌘C 复制"}
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
      导出复核结果（{Object.keys(feedback).length}/{verdicts.verdicts.length}）
    </Button>
  );
}

import type { Strings } from "@/lib/i18n";
import type { Step } from "../../../src/steps.ts";

const CAP = 1500;

function Label({ children }: { children: string }) {
  return <div className="mt-1 text-[11px] text-muted-foreground">{children}</div>;
}

export function OriginalText({ step, t }: { step: Step; t: Strings }) {
  return (
    <div className="mt-1.5 max-h-[260px] overflow-auto rounded-lg border bg-zinc-50 px-[11px] py-2 font-mono text-[12.5px] break-words whitespace-pre-wrap">
      {step.kind === "tool_call" ? (
        <>
          <Label>{t.input}</Label>
          <div>{JSON.stringify(step.tool.input, null, 2).slice(0, CAP)}</div>
          <Label>{step.tool.isError ? t.outputError : t.output}</Label>
          <div>{step.tool.output === null ? t.notCaptured : step.tool.output.slice(0, CAP)}</div>
        </>
      ) : (
        step.text
      )}
    </div>
  );
}

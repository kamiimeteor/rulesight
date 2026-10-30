import type { Step } from "../../../src/steps.ts";

const CAP = 1500;

function Label({ children }: { children: string }) {
  return <div className="mt-1 text-[11px] text-muted-foreground">{children}</div>;
}

export function OriginalText({ step }: { step: Step }) {
  return (
    <div className="mt-1.5 max-h-[260px] overflow-auto rounded-lg border bg-zinc-50 px-[11px] py-2 font-mono text-[12.5px] break-words whitespace-pre-wrap">
      {step.kind === "tool_call" ? (
        <>
          <Label>输入</Label>
          <div>{JSON.stringify(step.tool.input, null, 2).slice(0, CAP)}</div>
          <Label>{step.tool.isError ? "输出（报错）" : "输出"}</Label>
          <div>{step.tool.output === null ? "（结果未读到）" : step.tool.output.slice(0, CAP)}</div>
        </>
      ) : (
        step.text
      )}
    </div>
  );
}

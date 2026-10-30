import type { Step } from "../../../src/steps.ts";
import type { VerdictKind } from "../../../src/verdict.ts";

// Full class strings on purpose: Tailwind only generates classes it can read as literals.
export const TONE = {
  violated: {
    label: "违反",
    text: "text-violated",
    soft: "bg-violated-soft text-violated",
    solid: "bg-violated text-white",
    tint: "bg-violated/35",
    bar: "bg-violated",
  },
  followed: {
    label: "遵守",
    text: "text-followed",
    soft: "bg-followed-soft text-followed",
    solid: "bg-followed text-white",
    tint: "bg-followed/30",
    bar: "bg-followed",
  },
  not_applicable: {
    label: "不适用",
    text: "text-not-applicable",
    soft: "bg-not-applicable-soft text-not-applicable",
    solid: "bg-not-applicable text-white",
    tint: "bg-zinc-400",
    bar: "bg-not-applicable",
  },
} as const satisfies Record<VerdictKind, Record<string, string>>;

export const STEP_KIND_LABEL = {
  user_message: "用户消息",
  agent_message: "Agent 回复",
  thinking: "Agent 思考",
  tool_call: "工具调用",
  system: "系统事件",
} as const satisfies Record<Step["kind"], string>;

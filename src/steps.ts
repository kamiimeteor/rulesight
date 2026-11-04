import type { Lang } from "./lang.ts";

export type Step = TextStep | ToolCallStep;

// Summaries of compaction steps, per output language. Segmenting finds compaction points by these.
export const COMPACTION_LABELS = {
  zh: { compaction: "上下文压缩", summary: "上下文压缩摘要" },
  en: { compaction: "Context compacted", summary: "Compaction summary" },
} as const satisfies Record<Lang, { compaction: string; summary: string }>;

// How the plugin's own command shows up as a user message: "/rulesight:rulesight", "/rulesight", with or without text after.
export const RULESIGHT_COMMAND = /^\/rulesight(?::rulesight)?(?![\w:-])/;

export interface Session {
  formatVersion: 2;
  source: "claude_code";
  sessionId: string;
  title: string;
  cwd: string | null;
  startedAt: string;
  endedAt: string;
  steps: Step[];
}

interface StepBase {
  n: string;
  agent: string;
  summary: string;
  parentStep: string | null;
  // ISO timestamp of the step's first raw entry; null when that entry had none.
  at: string | null;
  raw: string[];
}

export interface TextStep extends StepBase {
  kind: "user_message" | "agent_message" | "thinking" | "system";
  text: string;
  tool: null;
}

export interface ToolCallStep extends StepBase {
  kind: "tool_call";
  text: null;
  tool: ToolCall;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string | null;
  isError: boolean;
}

export const STEP_KINDS = ["user_message", "agent_message", "thinking", "tool_call", "system"] as const;
export const SESSION_FIELDS = ["formatVersion", "source", "sessionId", "title", "cwd", "startedAt", "endedAt", "steps"] as const;
export const STEP_FIELDS = ["n", "kind", "agent", "summary", "text", "tool", "parentStep", "at", "raw"] as const;
export const TOOL_FIELDS = ["name", "input", "output", "isError"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Boundary: the judge and the verdict checker read steps.json from disk, so parse it instead of casting.
export function parseSession(raw: unknown): Session {
  if (!isRecord(raw)) throw new Error("步骤文件不是 JSON 对象");
  if (raw.formatVersion !== 2) throw new Error(`不支持的 formatVersion：${String(raw.formatVersion)}`);
  if (raw.source !== "claude_code") throw new Error(`不支持的 source：${String(raw.source)}`);
  const { sessionId, title, cwd, startedAt, endedAt, steps } = raw;
  if (
    typeof sessionId !== "string" ||
    typeof title !== "string" ||
    !(cwd === null || typeof cwd === "string") ||
    typeof startedAt !== "string" ||
    typeof endedAt !== "string" ||
    !Array.isArray(steps)
  ) {
    throw new Error("步骤文件的会话字段缺失或类型不对");
  }
  return { formatVersion: 2, source: "claude_code", sessionId, title, cwd, startedAt, endedAt, steps: steps.map(parseStep) };
}

function parseStep(raw: unknown, index: number): Step {
  const bad = (why: string) => new Error(`第 ${index} 个步骤${why}`);
  if (!isRecord(raw)) throw bad("不是对象");
  const { n, kind, agent, summary, text, tool, parentStep, at, raw: rawIds } = raw;
  if (
    typeof n !== "string" ||
    typeof agent !== "string" ||
    typeof summary !== "string" ||
    !(parentStep === null || typeof parentStep === "string") ||
    !(at === null || typeof at === "string") ||
    !Array.isArray(rawIds) ||
    !rawIds.every((id): id is string => typeof id === "string")
  ) {
    throw bad("的公共字段缺失或类型不对");
  }
  const base = { n, agent, summary, parentStep, at, raw: rawIds };
  if (kind === "tool_call") {
    if (!isRecord(tool) || typeof tool.name !== "string" || !isRecord(tool.input) || typeof tool.isError !== "boolean") {
      throw bad(`（${n}）的 tool 缺失或类型不对`);
    }
    const output = tool.output;
    if (!(output === null || typeof output === "string")) throw bad(`（${n}）的 tool.output 类型不对`);
    return { ...base, kind, text: null, tool: { name: tool.name, input: tool.input, output, isError: tool.isError } };
  }
  if (kind === "user_message" || kind === "agent_message" || kind === "thinking" || kind === "system") {
    if (typeof text !== "string") throw bad(`（${n}）缺少 text`);
    return { ...base, kind, text, tool: null };
  }
  throw bad(`（${n}）的 kind 未知：${String(kind)}`);
}

import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Session, Step, TextStep, ToolCallStep } from "../steps.ts";

// Boundary: everything below `parseEntryLine` works on these typed shapes only.

type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; output: string; isError: boolean }
  | { type: "other"; blockType: string };

type Origin =
  | { kind: "human" }
  | { kind: "peer"; name: string }
  | { kind: "task-notification" }
  | { kind: "unknown"; label: string };

export interface RawEntry {
  type: "user" | "assistant" | "system";
  uuid: string;
  timestamp: string | null;
  cwd: string | null;
  isMeta: boolean;
  isCompactSummary: boolean;
  // Delivered through an `attachment` entry of type queued_command, not a user entry.
  queued: boolean;
  // system entries only
  subtype: string | null;
  systemText: string | null;
  origin: Origin | null;
  blocks: Block[];
}

export interface ParsedFile {
  entries: RawEntry[];
  customTitle: string | null;
  invalidLines: number;
}

export interface SubagentFile {
  agentId: string;
  parentToolUseId: string | null;
  file: ParsedFile;
}

function parseQueuedCommand(raw: Record<string, unknown>): RawEntry | null {
  const { attachment } = raw;
  if (!isRecord(attachment) || attachment.type !== "queued_command" || typeof raw.uuid !== "string") return null;
  const prompt = attachment.prompt;
  const blocks: Block[] = typeof prompt === "string" ? [{ type: "text", text: prompt }] : Array.isArray(prompt) ? prompt.map(parseBlock) : [];
  const fallbackOrigin: Origin | null = attachment.commandMode === "task-notification" ? { kind: "task-notification" } : null;
  const origin = parseOrigin(attachment.origin) ?? fallbackOrigin;
  return {
    type: "user",
    uuid: raw.uuid,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : null,
    cwd: typeof raw.cwd === "string" ? raw.cwd : null,
    isMeta: false,
    isCompactSummary: false,
    queued: true,
    subtype: null,
    systemText: null,
    origin,
    blocks,
  };
}

type Line = { kind: "entry"; entry: RawEntry } | { kind: "custom-title"; title: string } | { kind: "ignored" } | { kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResultOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined ? "" : JSON.stringify(content);
  return content
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : JSON.stringify(part)))
    .join("\n");
}

function parseBlock(block: unknown): Block {
  if (!isRecord(block) || typeof block.type !== "string") return { type: "other", blockType: "invalid" };
  switch (block.type) {
    case "text":
      return { type: "text", text: typeof block.text === "string" ? block.text : "" };
    case "thinking":
      return { type: "thinking", thinking: typeof block.thinking === "string" ? block.thinking : "" };
    case "tool_use":
      if (typeof block.id === "string" && typeof block.name === "string") {
        return { type: "tool_use", id: block.id, name: block.name, input: isRecord(block.input) ? block.input : {} };
      }
      return { type: "other", blockType: "tool_use" };
    case "tool_result":
      if (typeof block.tool_use_id === "string") {
        return {
          type: "tool_result",
          toolUseId: block.tool_use_id,
          output: parseResultOutput(block.content),
          isError: block.is_error === true,
        };
      }
      return { type: "other", blockType: "tool_result" };
    default:
      return { type: "other", blockType: block.type };
  }
}

function parseOrigin(origin: unknown): Origin | null {
  if (origin === undefined || origin === null) return null;
  if (!isRecord(origin) || typeof origin.kind !== "string") return { kind: "unknown", label: "unknown" };
  switch (origin.kind) {
    case "human":
      return { kind: "human" };
    case "peer":
      return { kind: "peer", name: typeof origin.name === "string" ? origin.name : "unknown" };
    case "task-notification":
      return { kind: "task-notification" };
    default:
      return { kind: "unknown", label: origin.kind };
  }
}

function parseBlocks(message: unknown): Block[] {
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.map(parseBlock) : [];
}

export function parseEntryLine(line: string): Line {
  if (line.trim() === "") return { kind: "ignored" };
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "invalid" };
  }
  if (!isRecord(raw)) return { kind: "invalid" };
  if (raw.type === "custom-title") {
    return typeof raw.customTitle === "string" && raw.customTitle.trim() !== ""
      ? { kind: "custom-title", title: raw.customTitle.trim() }
      : { kind: "ignored" };
  }
  if (raw.type === "attachment") {
    const entry = parseQueuedCommand(raw);
    return entry === null ? { kind: "ignored" } : { kind: "entry", entry };
  }
  if (raw.type !== "user" && raw.type !== "assistant" && raw.type !== "system") return { kind: "ignored" };
  if (typeof raw.uuid !== "string") return { kind: "invalid" };
  return {
    kind: "entry",
    entry: {
      type: raw.type,
      uuid: raw.uuid,
      timestamp: typeof raw.timestamp === "string" ? raw.timestamp : null,
      cwd: typeof raw.cwd === "string" ? raw.cwd : null,
      isMeta: raw.isMeta === true,
      isCompactSummary: raw.isCompactSummary === true,
      queued: false,
      subtype: typeof raw.subtype === "string" ? raw.subtype : null,
      systemText: raw.type === "system" && typeof raw.content === "string" && raw.content.trim() !== "" ? raw.content : null,
      origin: parseOrigin(raw.origin),
      blocks: raw.type === "system" ? [] : parseBlocks(raw.message),
    },
  };
}

// Summaries: deterministic, no model calls.

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

function displayPath(filePath: string, cwd: string | null): string {
  const root = cwd?.replace(/\/+$/, "");
  return root && filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

type Summarizer = (input: Record<string, unknown>, cwd: string | null) => string | undefined;

const withPath =
  (label: string): Summarizer =>
  (input, cwd) => {
    const filePath = str(input.file_path);
    return filePath === undefined ? undefined : `${label} ${displayPath(filePath, cwd)}`;
  };

const withField =
  (label: string, field: string, max: number): Summarizer =>
  (input) => {
    const value = str(input[field]);
    return value === undefined ? undefined : `${label}${label.endsWith("：") ? "" : " "}${clip(value, max)}`;
  };

const SUMMARIZERS = new Map<string, Summarizer>([
  ["Bash", (input) => {
    const command = str(input.command);
    return command === undefined ? undefined : `运行命令 ${clip(command.split("\n")[0] ?? "", 60)}`;
  }],
  ["Read", withPath("读取文件")],
  ["Edit", withPath("修改文件")],
  ["MultiEdit", withPath("修改文件")],
  ["Write", withPath("写入文件")],
  ["Grep", withField("搜索", "pattern", 60)],
  ["Glob", withField("搜索", "pattern", 60)],
  ["Agent", withField("启动子 agent：", "description", 60)],
  ["Task", withField("启动子 agent：", "description", 60)],
  ["WebFetch", withField("抓取网页", "url", 80)],
  ["WebSearch", withField("搜索网页", "query", 60)],
  ["TodoWrite", () => "更新待办列表"],
]);

function summarizeTool(name: string, input: Record<string, unknown>, cwd: string | null): string {
  return SUMMARIZERS.get(name)?.(input, cwd) ?? `调用工具 ${name}`;
}

// Conversion.

export interface AdaptStats {
  entriesRead: number;
  duplicateEntries: number;
  invalidLines: number;
  skippedMetaMessages: number;
  skippedCliNoise: number;
  slashCommandsWithArgs: number;
  skippedSystemEntries: number;
  compactions: number;
  queuedCommands: number;
  subagentFiles: number;
  skippedEmptyBlocks: number;
  skippedOtherBlocks: Record<string, number>;
  duplicateToolUseIds: number;
  unmatchedToolUses: number;
  orphanToolResults: number;
}

export interface AdaptResult {
  session: Session;
  stats: AdaptStats;
}

interface Context {
  cwd: string | null;
  stats: AdaptStats;
  seenUuids: Set<string>;
  callsByToolUseId: Map<string, ToolCallStep>;
}

interface ToolResult {
  uuid: string;
  output: string;
  isError: boolean;
}

// Text the CLI wrote around slash commands. It is not something the user typed.
const CLI_NOISE_PREFIXES = ["<command-name>", "<command-message>", "<local-command-stdout>", "<local-command-caveat>", "<command-args>"];

function isCliNoise(text: string): boolean {
  const head = text.trimStart();
  return CLI_NOISE_PREFIXES.some((prefix) => head.startsWith(prefix));
}

// A slash command typed with arguments carries the user's own instruction in <command-args>.
function typedCommand(text: string): string | null {
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
  if (args === undefined || args === "") return null;
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  return name === undefined || name === "" ? args : `${name} ${args}`;
}

function orderByTime(entries: RawEntry[]): RawEntry[] {
  let last = 0;
  const keyed = entries.map((entry) => {
    const ms = entry.timestamp === null ? Number.NaN : Date.parse(entry.timestamp);
    if (!Number.isNaN(ms)) last = ms;
    return { entry, ms: last };
  });
  // Array.prototype.sort is stable, so equal timestamps keep file order.
  return keyed.sort((a, b) => a.ms - b.ms).map((item) => item.entry);
}

function convertConversation(ctx: Context, file: ParsedFile, agent: string, parentStep: string | null): Step[] {
  const steps: Step[] = [];
  const nextN = () => (parentStep === null ? String(steps.length + 1) : `${parentStep}.${steps.length + 1}`);
  ctx.stats.invalidLines += file.invalidLines;

  const entries = orderByTime(
    file.entries.filter((entry) => {
      ctx.stats.entriesRead += 1;
      if (ctx.seenUuids.has(entry.uuid)) {
        ctx.stats.duplicateEntries += 1;
        return false;
      }
      ctx.seenUuids.add(entry.uuid);
      return true;
    }),
  );

  // A result can be far from its call, so pair across the whole file.
  const results = new Map<string, ToolResult>();
  for (const entry of entries) {
    for (const block of entry.blocks) {
      if (block.type !== "tool_result") continue;
      if (results.has(block.toolUseId)) ctx.stats.orphanToolResults += 1;
      else results.set(block.toolUseId, { uuid: entry.uuid, output: block.output, isError: block.isError });
    }
  }

  const pushText = (kind: TextStep["kind"], text: string, summary: string, entry: RawEntry) => {
    steps.push({ n: nextN(), kind, agent, summary, text, tool: null, parentStep, at: entry.timestamp, raw: [entry.uuid] });
  };

  const userTextStep = (entry: RawEntry, text: string) => {
    const { origin } = entry;
    if (entry.isCompactSummary) {
      pushText("system", text, "上下文压缩摘要", entry);
    } else if (isCliNoise(text)) {
      const typed = typedCommand(text);
      if (typed === null) {
        ctx.stats.skippedCliNoise += 1;
      } else {
        ctx.stats.slashCommandsWithArgs += 1;
        pushText("user_message", typed, `用户消息：${clip(typed, 40)}`, entry);
      }
    } else if (origin === null || origin.kind === "human") {
      pushText("user_message", text, `用户消息：${clip(text, 40)}`, entry);
    } else if (origin.kind === "peer") {
      pushText("system", text, `子 agent 交回结果：${origin.name}`, entry);
    } else if (origin.kind === "task-notification") {
      pushText("system", text, "后台任务通知", entry);
    } else {
      pushText("system", text, `系统事件：${origin.label}`, entry);
    }
  };

  for (const entry of entries) {
    if (entry.queued) ctx.stats.queuedCommands += 1;
    if (entry.type === "system") {
      if (entry.subtype === "compact_boundary") {
        ctx.stats.compactions += 1;
        pushText("system", entry.systemText ?? "上下文压缩", "上下文压缩", entry);
      } else {
        ctx.stats.skippedSystemEntries += 1;
      }
      continue;
    }
    // isMeta marks text the harness injected (reminders, image captions, skill bodies). Sub-agent hand-backs
    // and coordinator messages are isMeta too, but they carry a non-human origin and stay as system steps.
    if (entry.isMeta && (entry.origin === null || entry.origin.kind === "human")) {
      ctx.stats.skippedMetaMessages += 1;
      continue;
    }
    for (const block of entry.blocks) {
      switch (block.type) {
        case "text":
        case "thinking": {
          const text = block.type === "text" ? block.text : block.thinking;
          if (text.trim() === "") {
            ctx.stats.skippedEmptyBlocks += 1;
          } else if (block.type === "thinking") {
            pushText("thinking", text, `Agent 思考：${clip(text, 40)}`, entry);
          } else if (entry.type === "assistant") {
            pushText("agent_message", text, `Agent 回复：${clip(text, 40)}`, entry);
          } else {
            userTextStep(entry, text);
          }
          break;
        }
        case "tool_use": {
          if (ctx.callsByToolUseId.has(block.id)) ctx.stats.duplicateToolUseIds += 1;
          const step: ToolCallStep = {
            n: nextN(),
            kind: "tool_call",
            agent,
            summary: summarizeTool(block.name, block.input, ctx.cwd),
            text: null,
            tool: { name: block.name, input: block.input, output: null, isError: false },
            parentStep,
            at: entry.timestamp,
            raw: [entry.uuid],
          };
          const result = results.get(block.id);
          if (result === undefined) {
            ctx.stats.unmatchedToolUses += 1;
          } else {
            step.tool.output = result.output;
            step.tool.isError = result.isError;
            step.raw.push(result.uuid);
            results.delete(block.id);
          }
          steps.push(step);
          ctx.callsByToolUseId.set(block.id, step);
          break;
        }
        case "tool_result":
          break;
        case "other":
          ctx.stats.skippedOtherBlocks[block.blockType] = (ctx.stats.skippedOtherBlocks[block.blockType] ?? 0) + 1;
          break;
        default: {
          const _exhaustive: never = block;
          return _exhaustive;
        }
      }
    }
  }
  ctx.stats.orphanToolResults += results.size;
  return steps;
}

export interface AdaptInput {
  sessionId: string;
  main: ParsedFile;
  subagents: SubagentFile[];
}

export function toSessionWithStats({ sessionId, main, subagents }: AdaptInput): AdaptResult {
  const stats: AdaptStats = {
    entriesRead: 0,
    duplicateEntries: 0,
    invalidLines: 0,
    skippedMetaMessages: 0,
    skippedCliNoise: 0,
    slashCommandsWithArgs: 0,
    skippedSystemEntries: 0,
    compactions: 0,
    queuedCommands: 0,
    subagentFiles: subagents.length,
    skippedEmptyBlocks: 0,
    skippedOtherBlocks: {},
    duplicateToolUseIds: 0,
    unmatchedToolUses: 0,
    orphanToolResults: 0,
  };
  const orderedMain = orderByTime(main.entries);
  const cwd = orderedMain.find((entry) => entry.cwd !== null)?.cwd ?? null;
  const ctx: Context = { cwd, stats, seenUuids: new Set(), callsByToolUseId: new Map() };

  const mainSteps = convertConversation(ctx, main, "main", null);

  const childrenByParent = new Map<string, Step[]>();
  let remaining = subagents.filter((sub) => sub.file.entries.length > 0);
  // A nested subagent's parent call lives in another subagent, so resolve in rounds.
  while (remaining.length > 0) {
    const unresolved: SubagentFile[] = [];
    for (const sub of remaining) {
      const parent = sub.parentToolUseId === null ? undefined : ctx.callsByToolUseId.get(sub.parentToolUseId);
      if (parent === undefined) {
        unresolved.push(sub);
        continue;
      }
      childrenByParent.set(parent.n, convertConversation(ctx, sub.file, sub.agentId, parent.n));
    }
    if (unresolved.length === remaining.length) {
      throw new Error(
        `找不到启动这些子 agent 的步骤：${unresolved.map((s) => `${s.agentId}（toolUseId ${s.parentToolUseId ?? "缺失"}）`).join(", ")}`,
      );
    }
    remaining = unresolved;
  }

  const flatten = (steps: Step[]): Step[] => steps.flatMap((step) => [step, ...flatten(childrenByParent.get(step.n) ?? [])]);
  const steps = flatten(mainSteps);

  const times = [main, ...subagents.map((sub) => sub.file)]
    .flatMap((file) => file.entries)
    .flatMap((entry) => (entry.timestamp === null ? [] : [Date.parse(entry.timestamp)]))
    .filter((ms) => !Number.isNaN(ms));
  if (times.length === 0) throw new Error(`会话 ${sessionId} 里没有带时间的消息`);
  const firstUserStep = mainSteps.find((step) => step.kind === "user_message");
  const title = main.customTitle ?? (firstUserStep?.text ? clip(firstUserStep.text, 40) : "未命名会话");

  return {
    session: {
      formatVersion: 2,
      source: "claude_code",
      sessionId,
      title,
      cwd,
      startedAt: new Date(times.reduce((a, b) => Math.min(a, b))).toISOString(),
      endedAt: new Date(times.reduce((a, b) => Math.max(a, b))).toISOString(),
      steps,
    },
    stats,
  };
}

// Thin shell around the filesystem.

export const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

async function readParsedFile(file: string): Promise<ParsedFile> {
  const parsed: ParsedFile = { entries: [], customTitle: null, invalidLines: 0 };
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const text of lines) {
    const line = parseEntryLine(text);
    if (line.kind === "entry") parsed.entries.push(line.entry);
    else if (line.kind === "custom-title") parsed.customTitle = line.title;
    else if (line.kind === "invalid") parsed.invalidLines += 1;
  }
  return parsed;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  );
}

async function findSessionFile(projectsDir: string, sessionId: string): Promise<{ file: string; sessionDir: string }> {
  const folders = await readdir(projectsDir, { withFileTypes: true }).catch(() => {
    throw new Error(`读不到项目目录 ${projectsDir}`);
  });
  const hits: string[] = [];
  for (const folder of folders) {
    const file = path.join(projectsDir, folder.name, `${sessionId}.jsonl`);
    if (folder.isDirectory() && (await exists(file))) hits.push(file);
  }
  const [file] = hits;
  if (file === undefined) throw new Error(`在 ${projectsDir} 下找不到会话 ${sessionId}`);
  if (hits.length > 1) throw new Error(`会话 ${sessionId} 在多个项目目录里都有：${hits.join("、")}`);
  return { file, sessionDir: path.join(path.dirname(file), sessionId) };
}

async function readToolUseId(metaFile: string): Promise<string | null> {
  const meta: unknown = await readFile(metaFile, "utf8").then(
    (text) => JSON.parse(text),
    () => null,
  );
  return isRecord(meta) && typeof meta.toolUseId === "string" ? meta.toolUseId : null;
}

async function readSubagents(sessionDir: string): Promise<SubagentFile[]> {
  const dir = path.join(sessionDir, "subagents");
  const names = await readdir(dir).catch(() => []);
  const agentFiles = names.filter((name) => /^agent-.+\.jsonl$/.test(name)).sort();
  return Promise.all(
    agentFiles.map(async (name) => {
      const agentId = name.slice("agent-".length, -".jsonl".length);
      return {
        agentId,
        parentToolUseId: await readToolUseId(path.join(dir, `agent-${agentId}.meta.json`)),
        file: await readParsedFile(path.join(dir, name)),
      };
    }),
  );
}

export async function readClaudeCodeSession(
  sessionId: string,
  options: { projectsDir?: string } = {},
): Promise<AdaptResult> {
  const { file, sessionDir } = await findSessionFile(path.resolve(options.projectsDir ?? DEFAULT_PROJECTS_DIR), sessionId);
  const main = await readParsedFile(file);
  return toSessionWithStats({ sessionId, main, subagents: await readSubagents(sessionDir) });
}

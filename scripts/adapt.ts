import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readClaudeCodeSession } from "../src/adapters/claude-code.ts";
import { STEP_KINDS } from "../src/steps.ts";
import { parseCli } from "./args.ts";

const { sessionId, projectsDir } = parseCli("node scripts/adapt.ts <sessionId> [--projects-dir <path>]");
const { session, stats } = await readClaudeCodeSession(sessionId, { projectsDir });

const outFile = path.resolve("private/out", `${sessionId}.steps.json`);
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(session, null, 2)}\n`);

console.log(`写入 ${path.relative(process.cwd(), outFile)}，共 ${session.steps.length} 步`);
for (const kind of STEP_KINDS) {
  console.log(`  ${kind}: ${session.steps.filter((step) => step.kind === kind).length}`);
}
console.log(`子 agent 步骤: ${session.steps.filter((step) => step.agent !== "main").length}`);
console.log(`读取的子 agent 文件: ${stats.subagentFiles}`);
console.log(`读取的条目（user/assistant/system）: ${stats.entriesRead}，按 uuid 去掉的重复: ${stats.duplicateEntries}，解析失败的行: ${stats.invalidLines}`);
console.log(`上下文压缩: ${stats.compactions}`);
console.log(`排队送达的消息（attachment queued_command）: ${stats.queuedCommands}`);
console.log(`跳过的命令行噪音消息: ${stats.skippedCliNoise}`);
console.log(`带参数的斜杠命令（按用户消息保留）: ${stats.slashCommandsWithArgs}`);
console.log(`跳过的 isMeta 消息: ${stats.skippedMetaMessages}`);
console.log(`跳过的其他 system 条目: ${stats.skippedSystemEntries}`);
console.log(`跳过的空块（空思考/空文本）: ${stats.skippedEmptyBlocks}`);
console.log(`跳过的其他块: ${JSON.stringify(stats.skippedOtherBlocks)}`);
console.log(`重复的 tool_use id: ${stats.duplicateToolUseIds}`);
console.log(`没有结果的 tool_use: ${stats.unmatchedToolUses}`);
console.log(`找不到调用的 tool_result: ${stats.orphanToolResults}`);

import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTool } from "../src/adapters/claude-code.ts";
import type { Lang } from "../src/lang.ts";

const bash = (command: string) => ({ command });
const LONG = "a".repeat(70);

const CASES: readonly [name: string, input: Record<string, unknown>, lang: Lang, expected: string][] = [
  ["Bash", bash("npm test"), "zh", "运行测试 · npm test"],
  ["Bash", bash("pnpm run test -- --watch=false"), "zh", "运行测试 · pnpm run test -- --watch=false"],
  ["Bash", bash("npx vitest run src"), "zh", "运行测试 · npx vitest run src"],
  ["Bash", bash("pytest -q tests"), "zh", "运行测试 · pytest -q tests"],
  ["Bash", bash("go test ./..."), "zh", "运行测试 · go test ./..."],
  ["Bash", bash("flutter test test/widget_test.dart"), "zh", "运行测试 · flutter test test/widget_test.dart"],
  ["Bash", bash("cd app && TZ=UTC flutter test"), "zh", "运行测试 · flutter test"],
  ["Bash", bash("pnpm add zod"), "zh", "安装依赖 · pnpm add zod"],
  ["Bash", bash("pip3 install requests"), "zh", "安装依赖 · pip3 install requests"],
  ["Bash", bash("uv pip install -r requirements.txt"), "zh", "安装依赖 · uv pip install -r requirements.txt"],
  ["Bash", bash("brew install jq"), "zh", "安装依赖 · brew install jq"],
  ["Bash", bash("flutter pub get"), "zh", "安装依赖 · flutter pub get"],
  ["Bash", bash("npm run build"), "zh", "构建项目 · npm run build"],
  ["Bash", bash("tsc --noEmit"), "zh", "构建项目 · tsc --noEmit"],
  ["Bash", bash("vite build --mode production"), "zh", "构建项目 · vite build --mode production"],
  ["Bash", bash("flutter build apk --debug"), "zh", "构建项目 · flutter build apk --debug"],
  ["Bash", bash('git commit -m "Fix login"'), "zh", '提交代码 · git commit -m "Fix login"'],
  ["Bash", bash("git push origin main"), "zh", "推送代码 · git push origin main"],
  ["Bash", bash("rm -rf dist"), "zh", "删除文件 · rm -rf dist"],
  ["Bash", bash(`rm -rf ${LONG}`), "zh", `删除文件 · rm -rf ${"a".repeat(53)}…`],
  ["Bash", bash("npm test\necho done"), "zh", "运行测试 · npm test"],
  ["Bash", bash("cd /Users/me/app && npm install"), "zh", "安装依赖 · npm install"],
  ["Bash", bash('cd "My App"; cd web && cargo test'), "zh", "运行测试 · cargo test"],
  ["Bash", bash("ls -la src"), "zh", "运行命令 ls -la src"],
  ["Bash", bash("cd app && ls"), "zh", "运行命令 cd app && ls"],
  ["Bash", bash("rmdir old"), "zh", "运行命令 rmdir old"],
  ["Bash", bash("git status"), "zh", "运行命令 git status"],
  ["Bash", bash("npm run typecheck"), "zh", "运行命令 npm run typecheck"],
  ["Bash", bash("flutter analyze"), "zh", "运行命令 flutter analyze"],
  ["mcp__claude-in-chrome__read_page", {}, "zh", "read page · claude-in-chrome"],
  ["mcp__notion__notion-search", {}, "zh", "notion search · notion"],
  ["mcp__0b7f3c2e-1111-4a2b-9c3d-5e6f7a8b9c0d__create_pages", {}, "zh", "create pages · MCP"],
  ["Skill", { skill: "pstack:tdd" }, "zh", "使用 skill：pstack:tdd"],
  ["Skill", {}, "zh", "调用工具 Skill"],
  ["Read", { file_path: "/tmp/a.ts" }, "zh", "读取文件 /tmp/a.ts"],
  ["NotebookEdit", {}, "zh", "调用工具 NotebookEdit"],
  ["Bash", bash("yarn test"), "en", "Ran tests · yarn test"],
  ["Bash", bash("git push"), "en", "Pushed · git push"],
  ["Bash", bash("ls"), "en", "Ran command ls"],
  ["Skill", { skill: "unslop" }, "en", "Used skill: unslop"],
];

test("tool calls are summarized as plain actions", () => {
  const failures = CASES.flatMap(([name, input, lang, expected]) => {
    const actual = summarizeTool(name, input, null, lang);
    return actual === expected ? [] : [`${name} ${JSON.stringify(input)} (${lang})\n  expected: ${expected}\n  actual:   ${actual}`];
  });
  assert.equal(failures.length, 0, failures.join("\n"));
});

import fs from "node:fs";
import type { VerdictKind, VerdictsFile } from "../src/verdict.ts";

interface Expected {
  sessionId: string;
  rules: Record<string, { text: string; verdict: VerdictKind; keySteps: string[] }>;
}

const [expectedPath, ...runPaths] = process.argv.slice(2);
if (expectedPath === undefined || runPaths.length === 0) {
  console.error("用法：node scripts/score.ts <expected.json> <verdicts.json> [更多 verdicts.json…]");
  process.exit(2);
}

const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as Expected;
const runs = runPaths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as VerdictsFile);

const LABEL: Record<VerdictKind, string> = { violated: "违反", followed: "遵守", not_applicable: "不适用" };
const totals = { verdictOk: 0, keyOk: 0, keyChecked: 0, cells: 0 };
let stable = 0;
const misses: string[] = [];

for (const [run, file] of runs.entries()) {
  if (file.sessionId !== expected.sessionId) throw new Error(`第 ${run + 1} 次的会话是 ${file.sessionId}，答案文件是 ${expected.sessionId}`);
  for (const [id, exp] of Object.entries(expected.rules)) {
    const rule = file.rules.find((r) => r.id === id);
    if (rule?.text !== exp.text) throw new Error(`第 ${run + 1} 次的 ${id} 规则原文和答案文件对不上`);
  }
}

for (const [id, exp] of Object.entries(expected.rules)) {
  const got = runs.map((file) => file.verdicts.find((v) => v.ruleId === id));
  const cells = got.map((v) => {
    totals.cells += 1;
    if (v === undefined) return "（没有判定）";
    const verdictOk = v.verdict === exp.verdict;
    if (verdictOk) totals.verdictOk += 1;
    let mark = verdictOk ? "✓" : "✗";
    if (verdictOk && v.verdict !== "not_applicable") {
      totals.keyChecked += 1;
      const keyOk = exp.keySteps.includes(v.keyStep);
      if (keyOk) totals.keyOk += 1;
      else mark += "（关键步骤 " + v.keyStep + " 不在答案里）";
    }
    return `${mark} ${LABEL[v.verdict]}${"keyStep" in v && v.keyStep ? " 第 " + v.keyStep + " 步" : ""}`;
  });
  if (new Set(got.map((v) => v?.verdict)).size === 1) stable += 1;
  if (cells.some((c) => !c.startsWith("✓ ") || c.includes("不在答案里"))) misses.push(id);
  console.log(`${id} 应为${LABEL[exp.verdict]} | ${cells.join(" | ")} | ${exp.text}`);
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 100)}%`);
const n = Object.keys(expected.rules).length;
console.log(
  `\n结论正确 ${totals.verdictOk}/${totals.cells}（${pct(totals.verdictOk, totals.cells)}）` +
    ` · 关键步骤正确 ${totals.keyOk}/${totals.keyChecked}（${pct(totals.keyOk, totals.keyChecked)}）` +
    (runs.length > 1 ? ` · ${runs.length} 次结论一致 ${stable}/${n}（${pct(stable, n)}）` : "") +
    (misses.length ? ` · 有问题的规则：${misses.join("、")}` : ""),
);

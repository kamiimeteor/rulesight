import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectRules, findImports, splitFrontmatter } from "../src/rule-files.ts";

// os.homedir() follows HOME, so every test gets its own fake home folder.
async function fakeHome(files: Record<string, string>): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "rulesight-rules-"));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(home, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  process.env.HOME = home;
  return home;
}

const texts = (rules: { text: string }[]) => rules.map((rule) => rule.text);

test("imports are found outside code, with escaped spaces, and not when quoted", () => {
  const md = ["- see @a.md and @~/x/b.md", "- `@not-this.md` stays text", "```", "@inside-fence.md", "```", '- quoted "@q.md"', "- spaced @Design\\ Docs/c.md", "mail me@example.com"].join("\n");
  assert.deepEqual(findImports(md), ["a.md", "~/x/b.md", "Design Docs/c.md"]);
});

test("frontmatter paths are read and its lines are not rules", () => {
  const { body, paths } = splitFrontmatter(["---", "paths:", '  - "src/**/*.ts"', "  - lib/*.ts", "---", "- Use strict types."].join("\n"));
  assert.deepEqual(paths, ["src/**/*.ts", "lib/*.ts"]);
  assert.equal(body.split("\n")[5], "- Use strict types.");
  assert.deepEqual(splitFrontmatter("---\npaths: [a/*.md, 'b/*.md']\n---\n").paths, ["a/*.md", "b/*.md"]);
});

test("global and project files, imports up to four hops, rules folders, and broken imports", async () => {
  await fakeHome({
    ".claude/CLAUDE.md": "- G1\n@~/agent-rules/ask.md\n- talk to @someone\n- @missing/rule.md",
    "agent-rules/ask.md": "- A1\n@./hop2.md",
    "agent-rules/hop2.md": "- H2\n@hop3.md\n@ask.md",
    "agent-rules/hop3.md": "- H3\n@hop4.md",
    "agent-rules/hop4.md": "- H4\n@hop5.md",
    "agent-rules/hop5.md": "- H5 is five hops away",
    ".claude/rules/sub/ts.md": "---\npaths:\n  - src/**/*.ts\n---\n# Types\n- T1",
    "proj/CLAUDE.md": "- P1",
    "proj/.claude/CLAUDE.md": "- P2",
    "proj/CLAUDE.local.md": "- P3",
    "proj/.claude/rules/x.md": "- P4",
  });
  const set = await collectRules(path.join(process.env.HOME ?? "", "proj"), "zh");
  assert.deepEqual(texts(set.rules), ["G1", "talk to @someone", "@missing/rule.md", "A1", "H2", "H3", "H4", "T1", "P1", "P2", "P3", "P4"]);
  assert.deepEqual(set.rules.map((rule) => rule.id), set.rules.map((_, i) => `R${i + 1}`));
  const t1 = set.rules.find((rule) => rule.text === "T1");
  assert.equal(t1?.section, "只在处理 src/**/*.ts 时生效 > Types");
  assert.equal(t1?.source.line, 6);
  assert.equal(t1?.source.file, "~/.claude/rules/sub/ts.md");
  assert.deepEqual(set.brokenImports, ["~/.claude/missing/rule.md"]);
  assert.deepEqual(set.missing, []);
  assert.equal(set.files.find((file) => file.displayPath === "~/agent-rules/ask.md")?.count, 1);
});

test("files in ~/.rulesight/skip.txt are left out with their imports, and counted", async () => {
  await fakeHome({
    ".claude/CLAUDE.md": "- G1\n@~/agent-rules/decisions.md\n@~/agent-rules/ask.md",
    "agent-rules/decisions.md": "- D1\n- D2\n- D3\n@more.md",
    "agent-rules/more.md": "- M1",
    "agent-rules/ask.md": "- A1",
    ".rulesight/skip.txt": "# not rules, a log\n~/agent-rules/decisions.md\n",
  });
  const set = await collectRules(null, "en");
  assert.deepEqual(texts(set.rules), ["G1", "A1"]);
  assert.deepEqual(set.skipped, [{ displayPath: "~/agent-rules/decisions.md", count: 3 }]);
});

test("only the two main CLAUDE.md files are reported missing", async () => {
  const home = await fakeHome({ "proj/.claude/rules/r.md": "- R" });
  const set = await collectRules(path.join(home, "proj"), "zh");
  assert.deepEqual(set.missing, ["~/.claude/CLAUDE.md", "~/proj/CLAUDE.md"]);
  assert.deepEqual(texts(set.rules), ["R"]);
});

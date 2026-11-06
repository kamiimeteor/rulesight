import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Lang } from "./lang.ts";
import { parseRules, type Rule } from "./rules.ts";

// Which files Claude Code loads as instructions, read the way it reads them:
// https://code.claude.com/docs/en/memory (imports, .claude/rules/, CLAUDE.local.md).

// Imported files can import others, at most four hops from the file that started it.
const MAX_IMPORT_HOPS = 4;
// One file path per line, "~" allowed, "#" starts a comment. Files listed here (and what they import) are not checked.
export const SKIP_FILE = path.join(".rulesight", "skip.txt");

export interface RuleFile {
  displayPath: string;
  count: number;
}

export interface RuleSet {
  rules: Rule[];
  files: RuleFile[];
  // The two main rule files that were looked for and not there, for the plan to mention.
  missing: string[];
  // Files left out because the user listed them in the skip file, with how many rules they hold.
  skipped: RuleFile[];
  // @imports that point at a file that isn't there.
  brokenImports: string[];
}

const SCOPE_LABEL: Record<Lang, (paths: string[]) => string> = {
  zh: (paths) => `只在处理 ${paths.join("、")} 时生效`,
  en: (paths) => `Only applies when working on ${paths.join(", ")}`,
};

export function displayPath(file: string): string {
  const home = os.homedir();
  return file === home || file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

function expandHome(file: string): string {
  return file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file;
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR")) return null;
    throw error;
  }
}

// YAML frontmatter at the top of a rules file. Its lines are blanked rather than removed so rule line numbers stay right.
export function splitFrontmatter(markdown: string): { body: string; paths: string[] } {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { body: markdown, paths: [] };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return { body: markdown, paths: [] };
  const paths: string[] = [];
  const unquote = (text: string) => text.trim().replace(/^["']|["']$/g, "");
  let inPaths = false;
  for (const line of lines.slice(1, end)) {
    const key = /^(\w+):\s*(.*)$/.exec(line);
    if (key !== null) {
      inPaths = key[1] === "paths";
      const inline = (key[2] ?? "").trim();
      if (inPaths && inline.startsWith("[")) paths.push(...inline.replace(/^\[|\]$/g, "").split(",").map(unquote).filter((p) => p !== ""));
      else if (inPaths && inline !== "") paths.push(unquote(inline));
      continue;
    }
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (inPaths && item !== null) paths.push(unquote(item[1] ?? ""));
  }
  const body = [...lines.slice(0, end + 1).map(() => ""), ...lines.slice(end + 1)].join("\n");
  return { body, paths };
}

// @path imports outside code spans and fenced code blocks. "\ " escapes a space; a quoted path is not an import.
export function findImports(markdown: string): string[] {
  const found: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    const prose = line.replace(/(`+)[\s\S]*?\1/g, " ");
    for (const match of prose.matchAll(/(?:^|\s)@((?:\\ |[^\s"'`])+)/g)) found.push((match[1] ?? "").replace(/\\ /g, " "));
  }
  return found;
}

// Every .md file under a rules folder, following symlinks, in a stable order.
async function rulesFolder(dir: string, seen = new Set<string>()): Promise<string[]> {
  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    return [];
  }
  if (seen.has(real)) return [];
  seen.add(real);
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    const info = await stat(full).catch(() => null);
    if (info?.isDirectory()) files.push(...(await rulesFolder(full, seen)));
    else if (info?.isFile() && name.endsWith(".md")) files.push(full);
  }
  return files;
}

export async function readSkipList(): Promise<Set<string>> {
  const text = await readIfExists(path.join(os.homedir(), SKIP_FILE));
  const skip = new Set<string>();
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const file = path.resolve(expandHome(line));
    skip.add(file);
    skip.add(await realpath(file).catch(() => file));
  }
  return skip;
}

// The user's global files, then the session project's, each followed by what it imports. Ids run on across files (R1, R2, ...).
export async function collectRules(cwd: string | null, lang: Lang = "zh"): Promise<RuleSet> {
  const home = os.homedir();
  const project = cwd === null ? null : path.resolve(cwd);
  const required = [path.join(home, ".claude", "CLAUDE.md"), ...(project === null ? [] : [path.join(project, "CLAUDE.md")])];
  const roots = [
    path.join(home, ".claude", "CLAUDE.md"),
    ...(await rulesFolder(path.join(home, ".claude", "rules"))),
    ...(project === null
      ? []
      : [
          path.join(project, "CLAUDE.md"),
          path.join(project, ".claude", "CLAUDE.md"),
          path.join(project, "CLAUDE.local.md"),
          ...(await rulesFolder(path.join(project, ".claude", "rules"))),
        ]),
  ];
  const skip = await readSkipList();
  const set: RuleSet = { rules: [], files: [], missing: [], skipped: [], brokenImports: [] };
  const visited = new Set<string>();

  const visit = async (file: string, hops: number, importedFrom: string | null): Promise<void> => {
    const real = await realpath(file).catch(() => file);
    if (visited.has(real)) return;
    visited.add(real);
    const markdown = await readIfExists(file);
    if (markdown === null) {
      if (importedFrom !== null) set.brokenImports.push(displayPath(file));
      else if (required.includes(file)) set.missing.push(displayPath(file));
      return;
    }
    const { body, paths } = splitFrontmatter(markdown);
    const parsed = parseRules(body, displayPath(file));
    if (skip.has(file) || skip.has(real)) {
      set.skipped.push({ displayPath: displayPath(file), count: parsed.length });
      return;
    }
    set.files.push({ displayPath: displayPath(file), count: parsed.length });
    const scope = paths.length === 0 ? null : SCOPE_LABEL[lang](paths);
    for (const rule of parsed) {
      const section = scope === null ? rule.section : rule.section === "" ? scope : `${scope} > ${rule.section}`;
      set.rules.push({ ...rule, id: `R${set.rules.length + 1}`, section });
    }
    if (hops >= MAX_IMPORT_HOPS) return;
    for (const target of findImports(body)) {
      const resolved = path.resolve(path.dirname(file), expandHome(target));
      // "@someone" in prose is not a file; only report a missing import when it looks like a path.
      if ((await stat(resolved).catch(() => null)) === null && !/[./]/.test(target)) continue;
      await visit(resolved, hops + 1, file);
    }
  };

  for (const root of roots) await visit(root, 0, null);
  return set;
}

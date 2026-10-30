export interface Rule {
  id: string;
  text: string;
  source: { file: string; line: number };
  section: string;
}

interface Draft {
  text: string;
  line: number;
  section: string;
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function renderRow(header: string[], cells: string[]): string {
  const [first = "", ...rest] = cells;
  const details = rest
    .map((cell, i) => (cell === "" ? "" : `${header[i + 1] ?? ""} ${cell}`.trim()))
    .filter((detail) => detail !== "");
  return details.length === 0 ? first : `${first}: ${details.join("; ")}`;
}

export function parseRules(markdown: string, displayPath: string): Rule[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: Draft[] = [];
  const headings: { level: number; title: string }[] = [];
  const section = () => headings.map((heading) => heading.title).join(" > ");

  let fence: { char: string; length: number } | null = null;
  let item: Draft | null = null;
  let tableHeader: string[] | null = null;
  // "Never do any of the following:" flips the meaning of the bullets under it, so it travels with them.
  let lead: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;

    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1]?.[0] === fence.char && (fenceMatch[1]?.length ?? 0) >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch !== null) {
      const marker = fenceMatch[1] ?? "```";
      fence = { char: marker[0] ?? "`", length: marker.length };
      item = null;
      tableHeader = null;
      continue;
    }

    if (line.trim() === "") {
      item = null;
      tableHeader = null;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? "#").length;
      while ((headings.at(-1)?.level ?? 0) >= level) headings.pop();
      headings.push({ level, title: heading[2] ?? "" });
      item = null;
      lead = null;
      tableHeader = null;
      continue;
    }

    if (tableHeader !== null) {
      if (!line.includes("|")) {
        tableHeader = null;
      } else {
        drafts.push({ text: renderRow(tableHeader, splitCells(line)), line: lineNo, section: section() });
        continue;
      }
    }
    if (line.includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      tableHeader = splitCells(line);
      item = null;
      i += 1;
      continue;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem !== null) {
      const text = (listItem[1] ?? "").trim();
      item = { text: lead === null ? text : `${lead} ${text}`, line: lineNo, section: section() };
      drafts.push(item);
      continue;
    }

    if (item !== null) {
      item.text = `${item.text} ${line.trim()}`.trim();
    } else {
      lead = /[:：]$/.test(line.trim()) ? line.trim() : null;
    }
  }

  return drafts
    .filter((draft) => draft.text !== "")
    .map((draft, i) => ({
      id: `R${i + 1}`,
      text: draft.text,
      source: { file: displayPath, line: draft.line },
      section: draft.section,
    }));
}

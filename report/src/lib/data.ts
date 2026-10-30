import { parseReportData } from "../../../src/report.ts";
import { browserLang, STRINGS } from "./i18n.ts";
import { buildModel, type ReportModel } from "./model.ts";

export type LoadResult = { ok: true; model: ReportModel } | { ok: false; error: string };

// Boundary: scripts/report.ts writes the JSON into the page; parse it once here and hand typed data down.
export function loadReport(): LoadResult {
  const t = STRINGS[browserLang()];
  const text = document.getElementById("rulesight-data")?.textContent?.trim();
  if (!text) return { ok: false, error: t.noData };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: t.badData };
  }
  try {
    return { ok: true, model: buildModel(parseReportData(raw)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

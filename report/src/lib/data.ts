import { parseReportData } from "../../../src/report.ts";
import { buildModel, type ReportModel } from "./model.ts";

export type LoadResult = { ok: true; model: ReportModel } | { ok: false; error: string };

// Boundary: scripts/report.ts writes the JSON into the page; parse it once here and hand typed data down.
export function loadReport(): LoadResult {
  const text = document.getElementById("rulesight-data")?.textContent?.trim();
  if (!text) return { ok: false, error: "页面里没有报告数据。请用 npm run report 生成报告。" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "报告数据读不出来。请用 npm run report 生成报告，不要直接打开 report/dist/index.html。" };
  }
  try {
    return { ok: true, model: buildModel(parseReportData(raw)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

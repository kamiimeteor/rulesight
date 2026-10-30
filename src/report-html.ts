import type { ReportData } from "./report.ts";

const PLACEHOLDER = "__RULESIGHT_DATA__";

// The data sits inside <script type="application/json">, so "<" must never appear literally
// (no "</script>", no "<!--"), and U+2028/2029 are escaped to keep the text valid in older parsers.
function embeddableJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderReportHtml(template: string, data: ReportData): string {
  if (template.split(PLACEHOLDER).length !== 2) throw new Error("报告模板里的数据占位符不是恰好一个，重新运行 npm run build:report");
  // A function replacer: a string replacement would expand "$&" and "$1" found in session text.
  return template.replace(PLACEHOLDER, () => embeddableJson(data));
}

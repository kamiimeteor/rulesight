import { Button } from "@/components/ui/button";
import { currentPageHtml, downloadText } from "@/lib/download";
import { fileName, formatDuration, formatStart } from "@/lib/format";
import type { ReportModel } from "@/lib/model";

export function Header({ model, reviewed }: { model: ReportModel; reviewed: number }) {
  const { session, verdicts } = model.data;
  const started = formatStart(session.startedAt);
  const duration = formatDuration(session.startedAt, session.endedAt);
  const meta = [
    started && `${started} 开始`,
    duration && `用时 ${duration}`,
    `${session.steps.length} 步`,
    `对照 ${verdicts.rules.length} 条规则（${fileName(verdicts.rulesFile)}）`,
  ]
    .filter(Boolean)
    .join(" · ");

  const failedSegments = verdicts.segments.filter((segment) => segment.status === "failed").length;
  const total = verdicts.verdicts.length;
  const exportPage = () => {
    const html = currentPageHtml();
    if (html !== null) downloadText(`rulesight-${session.sessionId.slice(0, 8)}.html`, "text/html", html);
  };

  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">{session.title}</h1>
        <div className="text-muted-foreground">{meta}</div>
        {failedSegments > 0 && <div className="mt-1 font-medium text-violated">有 {failedSegments} 段没判成，这份报告不完整</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={reviewed === total ? "font-medium text-followed" : "text-muted-foreground"}>
          {reviewed === total ? `已全部复核（${total} 条）` : `已复核 ${reviewed} / ${total}`}
        </span>
        <Button variant="outline" size="sm" className="bg-card hover:bg-muted" onClick={exportPage}>
          导出报告
        </Button>
      </div>
    </header>
  );
}

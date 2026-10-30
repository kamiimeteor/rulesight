import { Button } from "@/components/ui/button";
import { currentPageHtml, downloadText } from "@/lib/download";
import { fileName, formatDuration, formatStart } from "@/lib/format";
import type { ReportModel } from "@/lib/model";

export function Header({ model, reviewed }: { model: ReportModel; reviewed: number }) {
  const { session, verdicts } = model.data;
  const { t } = model;
  const started = formatStart(session.startedAt, t);
  const duration = formatDuration(session.startedAt, session.endedAt, t);
  const meta = [
    started && t.started(started),
    duration && t.duration(duration),
    t.stepCount(session.steps.length),
    t.ruleCount(verdicts.rules.length, fileName(verdicts.rulesFile)),
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
        {failedSegments > 0 && <div className="mt-1 font-medium text-violated">{t.failedSegments(failedSegments)}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={reviewed === total ? "font-medium text-followed" : "text-muted-foreground"}>
          {reviewed === total ? t.allReviewed(total) : t.reviewed(reviewed, total)}
        </span>
        <Button variant="outline" size="sm" className="bg-card hover:bg-muted" onClick={exportPage}>
          {t.exportReport}
        </Button>
      </div>
    </header>
  );
}

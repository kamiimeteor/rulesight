import type { Strings } from "./i18n.ts";

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function formatStart(iso: string, t: Strings): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(t.htmlLang === "en" ? "en-GB" : "zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(startIso: string, endIso: string, t: Strings): string | null {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (Number.isNaN(ms)) return null;
  const minutes = Math.round(ms / 60000);
  return minutes >= 60 ? t.hoursMinutes(Math.floor(minutes / 60), minutes % 60) : t.minutes(minutes);
}

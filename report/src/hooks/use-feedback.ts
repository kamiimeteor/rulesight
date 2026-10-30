import { useState } from "react";
import { isRecord } from "../../../src/steps.ts";

export type Feedback = "right" | "wrong";
export type FeedbackMap = Readonly<Record<string, Feedback>>;

function load(storageKey: string, ruleIds: ReadonlySet<string>): FeedbackMap {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (!isRecord(stored)) return {};
    const map: Record<string, Feedback> = {};
    for (const [ruleId, value] of Object.entries(stored)) {
      if (ruleIds.has(ruleId) && (value === "right" || value === "wrong")) map[ruleId] = value;
    }
    return map;
  } catch {
    return {};
  }
}

// Review marks live in localStorage per session, so reopening the exported file keeps them.
export function useFeedback(sessionId: string, ruleIds: ReadonlySet<string>) {
  const storageKey = `rulesight-feedback-${sessionId}`;
  const [feedback, setFeedback] = useState(() => load(storageKey, ruleIds));
  const mark = (ruleId: string, value: Feedback) => {
    const next = { ...feedback, [ruleId]: value };
    setFeedback(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage can be blocked (private mode); the mark still holds for this visit.
    }
  };
  return { feedback, mark };
}

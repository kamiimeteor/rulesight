import type { VerdictKind } from "../../../src/verdict.ts";

// Full class strings on purpose: Tailwind only generates classes it can read as literals.
export const TONE = {
  violated: {
    text: "text-violated",
    soft: "bg-violated-soft text-violated",
    solid: "bg-violated text-white",
    tint: "bg-violated/35",
    bar: "bg-violated",
  },
  followed: {
    text: "text-followed",
    soft: "bg-followed-soft text-followed",
    solid: "bg-followed text-white",
    tint: "bg-followed/30",
    bar: "bg-followed",
  },
  not_applicable: {
    text: "text-not-applicable",
    soft: "bg-not-applicable-soft text-not-applicable",
    solid: "bg-not-applicable text-white",
    tint: "bg-zinc-400",
    bar: "bg-not-applicable",
  },
} as const satisfies Record<VerdictKind, Record<string, string>>;

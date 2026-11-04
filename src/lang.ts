import type { Step } from "./steps.ts";

// Output language for everything a user reads: CLI lines, step summaries, the judge's verdict text and the report page.
export const LANGS = ["en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = "en";

// Accepts plain codes and POSIX/BCP 47 locales: "en", "zh", "zh_CN.UTF-8", "en-GB", "zh-Hans-CN".
export function parseLang(text: string | undefined): Lang | undefined {
  const code = text?.trim().toLowerCase().split(/[_.@-]/)[0];
  return LANGS.find((lang) => lang === code);
}

export interface LangSources {
  env?: Readonly<Record<string, string | undefined>>;
  // The language the user wrote in during the session being checked; see sessionLang.
  sessionLang?: Lang | undefined;
  intlLocale?: string | undefined;
}

function systemIntlLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

// RULESIGHT_LANG wins, then the language of the session, then the POSIX locale variables in their usual precedence,
// then the runtime's Intl locale. Someone on an English system who talks to Claude in Chinese gets a Chinese report.
// A variable naming a language Rulesight does not speak (fr_FR, C, POSIX) is skipped, not treated as English.
export function detectLang(sources: LangSources = {}): Lang {
  const env = sources.env ?? process.env;
  const intlLocale = "intlLocale" in sources ? sources.intlLocale : systemIntlLocale();
  for (const value of [env.RULESIGHT_LANG, sources.sessionLang, env.LC_ALL, env.LC_MESSAGES, env.LANG, intlLocale]) {
    const lang = parseLang(value);
    if (lang !== undefined) return lang;
  }
  return DEFAULT_LANG;
}

const CODE_OR_URL = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+/g;
const HAN = /\p{Script=Han}/gu;
const KANA_OR_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER = /\p{L}/u;

// Counts the user's own messages in the main session: Chinese when at least as many are Chinese as not. Code, links
// and messages without letters don't vote; Japanese and Korean count as "not Chinese". Undefined when nothing voted.
export function sessionLang(steps: readonly Step[]): Lang | undefined {
  let zh = 0;
  let other = 0;
  for (const step of steps) {
    if (step.kind !== "user_message" || step.agent !== "main") continue;
    const prose = step.text.replace(CODE_OR_URL, " ");
    if (!LETTER.test(prose)) continue;
    if ((prose.match(HAN)?.length ?? 0) >= 2 && !KANA_OR_HANGUL.test(prose)) zh += 1;
    else other += 1;
  }
  if (zh + other === 0) return undefined;
  return zh >= other ? "zh" : "en";
}

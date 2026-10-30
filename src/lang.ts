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
  intlLocale?: string | undefined;
}

function systemIntlLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

// RULESIGHT_LANG wins, then the POSIX locale variables in their usual precedence, then the runtime's Intl locale.
// A variable naming a language Rulesight does not speak (fr_FR, C, POSIX) is skipped, not treated as English.
export function detectLang(sources: LangSources = {}): Lang {
  const env = sources.env ?? process.env;
  const intlLocale = "intlLocale" in sources ? sources.intlLocale : systemIntlLocale();
  for (const value of [env.RULESIGHT_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG, intlLocale]) {
    const lang = parseLang(value);
    if (lang !== undefined) return lang;
  }
  return DEFAULT_LANG;
}

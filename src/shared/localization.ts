import { macMessages } from './mac-messages.js';
import { localeAliases } from './locale-aliases.js';
import { windowsMessages } from './windows-messages.js';
export const languages = ['ko', 'en', 'ja', 'es', 'fr', 'pt', 'de', 'ru'] as const;
export type Language = typeof languages[number];
const base = [...macMessages, ...windowsMessages];
export const messages = [...base, ...Object.entries(localeAliases).flatMap(([key, target]) => {
  const row = [...base].reverse().find(row => row[0] === target);
  return row ? [[key, ...row.slice(1)]] : [];
})];
export function resolveLanguage(value: string, system = 'en'): Language {
  const code = (value === 'system' ? system : value).toLowerCase().split(/[-_]/)[0];
  return languages.includes(code as Language) ? code as Language : 'en';
}
export function translate(source: string, language: Language, args: Record<string, string | number> = {}): string {
  const row = [...messages].reverse().find(row => row[0] === source);
  const text = row?.[languages.indexOf(language)] ?? source;
  return text.replace(/\{([^{}]+)\}/g, (match, key: string) => String(args[key] ?? match));
}

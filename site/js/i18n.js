// Lightweight i18n: register locale bundles, then call t() anywhere.
// Bundles are plain key→string objects; {0}, {1}, … are positional placeholders.
// Falls back to English, then to the key itself if a string is missing.

const LOCALES = {};
let _lang = 'en';
let _strings = {};

export function registerLocale(lang, strings) {
  LOCALES[lang] = strings;
}

export function setLocale(lang) {
  _lang = lang;
  _strings = LOCALES[lang] ?? LOCALES['en'] ?? {};
}

export function currentLang() { return _lang; }

export function t(key, ...args) {
  let str = _strings[key] ?? LOCALES['en']?.[key] ?? key;
  for (let i = 0; i < args.length; i++) str = str.replace(`{${i}}`, String(args[i]));
  return str;
}

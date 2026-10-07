// Game-agnostic i18n layer (PLAN.md Phase 4; a primary kit candidate for
// Phase 6 — keep it free of DOM/Phaser/game imports; the DOM sweep below is
// opt-in and the app owns every other side effect via onLocaleChange).
//
//   t(key, params)          message lookup + {param} interpolation
//   setLocale(tag)          switch the active locale, notify listeners
//   onLocaleChange(cb)      app hook: re-render DOM + canvas, <html lang>…
//   resolveLanguage(tag)    BCP-47-ish tag → a shipped locale ('pl' | 'en')
//   numF(n)                 locale-aware compact display numbers (replaces
//                           core/economy fmt() at call sites; fmt itself
//                           stays pinned by its unit tests)
//   selectVariant(msg, …)   the plural rule t() uses — exported for tests
//
// Message values are either a plain string, or a plural object keyed by
// Intl.PluralRules categories (one/few/many/other for 'pl', one/other for
// 'en') selected through params.n — plural messages carry their driving
// count as {n}. locales/pl.json is the source of truth:
// its values are the byte-identical extraction of the legacy UI strings
// (emoji included), pinned by a snapshot test.

import en from '../../locales/en.json';
import pl from '../../locales/pl.json';

export type Locale = 'pl' | 'en';
/** A message: plain, or plural variants keyed by Intl.PluralRules categories. */
export type Message = string | Record<string, string>;
export type Messages = Record<string, Message>;
export type TParams = Record<string, string | number | undefined>;

const bundles: Record<Locale, Messages> = { pl, en };

let locale: Locale = 'pl';
const listeners = new Set<() => void>();
const compacts = new Map<Locale, Intl.NumberFormat>();

export const getLocale = (): Locale => locale;

/** BCP-47-ish tag → shipped locale; unknown languages fall back to 'en'
 *  (the kit ships 'pl' as its default — the platform adapters supply 'pl'
 *  when nothing else is known — and English as the international fallback). */
export function resolveLanguage(tag: string | null | undefined): Locale {
  const l = (tag ?? '').trim().toLowerCase();
  if (l.startsWith('pl')) return 'pl';
  if (l.startsWith('en')) return 'en';
  return 'en';
}

/** Switches the locale (unknown tags resolve like resolveLanguage) and
 *  notifies onLocaleChange listeners — always, so boot can rely on one call. */
export function setLocale(tag: string): Locale {
  locale = bundles[tag as Locale] ? (tag as Locale) : resolveLanguage(tag);
  listeners.forEach((cb) => cb());
  return locale;
}

/** Subscribe to locale switches; returns an unsubscribe function. */
export function onLocaleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Picks the plural variant for `n` under `l`'s rules — the piece `t()` uses
 * for plural message objects. Exported so tests can pin the selection itself
 * with distinguishable variants (the shipped pl variants are byte-identical
 * by the extraction rule above).
 */
export function selectVariant(variants: Record<string, string>, l: Locale, n: number): string {
  const cat = new Intl.PluralRules(l).select(n); // 'one' | 'few' | 'many' | 'other'
  return variants[cat] ?? variants.other ?? Object.values(variants)[0] ?? '';
}

const interpolate = (text: string, params?: TParams): string =>
  params
    ? text.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m))
    : text;

/** Message lookup + interpolation; unknown keys return the key (visible in
 *  dev, never throws — a missing translation must not break the game). */
export function t(key: string, params?: TParams): string {
  const msg = bundles[locale][key];
  if (msg === undefined) return key;
  const text =
    typeof msg === 'string'
      ? msg
      : selectVariant(msg, locale, typeof params?.n === 'number' ? params.n : 0);
  return interpolate(text, params);
}

/**
 * Compact display number for the active locale (HUD/buttons/chips/log —
 * where core fmt() used to be called). Below 10 000 it mirrors fmt()'s
 * behavior exactly (whole numbers, no grouping — legacy pixel parity); from
 * 10 000 up it compacts locale-aware ("10K" en, "10 tys." pl). Ball texture
 * labels keep the invariant core fmt() — they are baked at generation time.
 */
export function numF(n: number): string {
  if (Math.abs(n) < 10000) return String(Math.round(n));
  let f = compacts.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    compacts.set(locale, f);
  }
  return f.format(n);
}

/**
 * Applies the static index.html strings — elements marked with data-i18n
 * (textContent), data-i18n-aria (aria-label) and data-i18n-ph (placeholder).
 * Dynamic chrome renders through t() directly and must NOT carry the
 * attributes (this would clobber the rendered value on locale switches).
 */
export function applyStatic(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n ?? '');
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria ?? ''));
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh ?? '');
  });
}

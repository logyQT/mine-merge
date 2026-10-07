// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyStatic,
  getLocale,
  numF,
  onLocaleChange,
  resolveLanguage,
  selectVariant,
  setLocale,
  t,
} from '../../src/i18n';
import en from '../../locales/en.json';
import pl from '../../locales/pl.json';

// Phase 4: the i18n engine. locales/pl.json is the source of truth — its
// values are the byte-identical extraction of the legacy UI strings (emoji
// included), so the first describe pins those bytes against the templates
// core/economy + app.ts + hud.ts used to render inline.

beforeEach(() => setLocale('pl'));

describe('locale resolution', () => {
  it('maps BCP-47-ish tags to shipped locales, unknown → en', () => {
    expect(resolveLanguage('pl')).toBe('pl');
    expect(resolveLanguage('pl-PL')).toBe('pl');
    expect(resolveLanguage('PL')).toBe('pl');
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('en-US')).toBe('en');
    expect(resolveLanguage('de-DE')).toBe('en');
    expect(resolveLanguage('fr')).toBe('en');
    expect(resolveLanguage('')).toBe('en');
    expect(resolveLanguage(null)).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
  });

  it('setLocale switches (unknown tags fall back) and notifies listeners', () => {
    const seen: string[] = [];
    const off = onLocaleChange(() => seen.push(getLocale()));
    expect(setLocale('en')).toBe('en');
    expect(setLocale('xx')).toBe('en'); // unshipped → resolveLanguage fallback
    expect(setLocale('pl')).toBe('pl');
    expect(seen).toEqual(['en', 'en', 'pl']); // always notifies — boot relies on it
    off();
    setLocale('en');
    expect(seen).toHaveLength(3); // unsubscribed
  });
});

describe('t: byte-identical pl extraction + interpolation', () => {
  it('reproduces the legacy strings exactly (emoji included)', () => {
    expect(t('app.title')).toBe('Kopalnia');
    expect(t('hud.crate', { n: 2 })).toBe('🎁 Otwórz skrzynkę (2)');
    expect(t('hud.dropResult', { coins: 60, back: 3, inv: 2 })).toBe(
      'Zdobyto 🪙60. Na planszę wróciło 3, do ekwipunku 2.',
    );
    expect(t('war.prepare', { eL: 7, n: 3, pN: 5 })).toBe(
      'Wróg poz. 7 wystawił 3 kulek (twoich: 5). Uwaga: przegrana grozi stratą kulki (50%)!',
    );
  });

  it('interpolates {param} and leaves unknown placeholders intact', () => {
    expect(t('war.prepare', { eL: 1, n: 1, pN: 1 })).toContain('Wróg poz. 1');
    expect(t('war.prepare', { eL: 1 })).toContain('{n}'); // untouched, never throws
  });

  it('returns the key for unknown messages', () => {
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('switches language for the same key', () => {
    setLocale('en');
    expect(t('hud.crate', { n: 2 })).toBe('🎁 Open crate (2)');
    expect(t('app.title')).toBe('Kopalnia'); // brand: untranslated by decision
  });
});

describe('plurals (Intl.PluralRules)', () => {
  const variants = { one: 'A', few: 'B', many: 'C', other: 'D' };

  it("selects the Polish categories: one/few/many/other", () => {
    expect(selectVariant(variants, 'pl', 1)).toBe('A');
    expect(selectVariant(variants, 'pl', 2)).toBe('B');
    expect(selectVariant(variants, 'pl', 4)).toBe('B');
    expect(selectVariant(variants, 'pl', 22)).toBe('B');
    expect(selectVariant(variants, 'pl', 0)).toBe('C');
    expect(selectVariant(variants, 'pl', 5)).toBe('C');
    expect(selectVariant(variants, 'pl', 11)).toBe('C');
    expect(selectVariant(variants, 'pl', 21)).toBe('C');
    expect(selectVariant(variants, 'pl', 101)).toBe('C');
    expect(selectVariant(variants, 'pl', 1.5)).toBe('D');
  });

  it('routes t() through the selection for plural message objects', () => {
    // en war.prepare is the only shipped key whose variants differ by number.
    setLocale('en');
    expect(t('war.prepare', { eL: 4, n: 1, pN: 5 })).toContain('fielded 1 ball ');
    expect(t('war.prepare', { eL: 4, n: 3, pN: 5 })).toContain('fielded 3 balls ');
    // pl variants are byte-identical across categories (extraction rule):
    setLocale('pl');
    const one = t('war.prepare', { eL: 4, n: 1, pN: 5 });
    const many = t('war.prepare', { eL: 4, n: 9, pN: 5 });
    expect(one).toBe(many.replace(' wystawił 9 ', ' wystawił 1 '));
  });

  it("selects the 'other' variant when no n is passed", () => {
    setLocale('en');
    // No params.n → count 0 → en 'other'; the {n} placeholder stays literal.
    expect(t('war.prepare', { eL: 1, pN: 1 })).toContain('fielded {n} balls ');
  });
});

describe('numF: locale-aware compact display numbers', () => {
  it('mirrors core fmt() below 10 000 (whole numbers, no grouping)', () => {
    expect(numF(0)).toBe('0');
    expect(numF(9999.4)).toBe('9999');
    expect(numF(1234)).toBe('1234');
    expect(numF(-42.6)).toBe('-43');
  });

  it('compacts from 10 000 up per locale', () => {
    expect(numF(10000)).toContain('tys'); // default locale is pl
    expect(numF(1500000)).toContain('mln');
    setLocale('en');
    expect(numF(10000)).toBe('10K');
    expect(numF(1500000)).toBe('1.5M');
  });
});

describe('static DOM sweep (data-i18n)', () => {
  it('fills textContent, aria-label and placeholder from t()', () => {
    document.body.innerHTML =
      '<button id="b" data-i18n="hud.crate"></button>' +
      '<div id="d" data-i18n-aria="app.title"></div>' +
      '<input id="i" data-i18n-ph="app.title">';
    applyStatic();
    expect(document.getElementById('b')!.textContent).toBe('🎁 Otwórz skrzynkę ({n})');
    expect(document.getElementById('d')!.getAttribute('aria-label')).toBe('Kopalnia');
    expect((document.getElementById('i') as HTMLInputElement).placeholder).toBe('Kopalnia');

    setLocale('en');
    applyStatic();
    expect(document.getElementById('b')!.textContent).toBe('🎁 Open crate ({n})');
    document.body.innerHTML = '';
  });
});

describe('locale files', () => {
  it('en ships every pl key (and vice versa)', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });

  it('pl.json is byte-identical to the extracted legacy strings (snapshot)', () => {
    expect(pl).toMatchSnapshot();
    expect(en).toMatchSnapshot();
  });

  it('pl plural objects carry every Intl.PluralRules("pl") category', () => {
    for (const [key, msg] of Object.entries(pl)) {
      if (typeof msg === 'string') continue;
      expect(Object.keys(msg).sort(), key).toEqual(['few', 'many', 'one', 'other']);
      // Byte-parity rule: the shipped pl variants never decline — legacy
      // renders bare numbers, so every category must be the same string.
      expect(new Set(Object.values(msg)).size, key).toBe(1);
    }
  });
});

describe('index.html extraction (mechanical byte parity)', () => {
  // The static markup keeps the original legacy text as its inline default —
  // so comparing it against pl.json pins the extraction for every static
  // string (emoji, ± signs, ellipses included) without hand-copied pins.
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const plv = pl as Record<string, unknown>;
  const value = (key: string): string => {
    const v = plv[key];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const variants = Object.values(v as Record<string, string>);
      expect(new Set(variants).size, key).toBe(1); // pl variants are identical
      return variants[0];
    }
    throw new Error(`missing pl key: ${key}`);
  };

  it('data-i18n textContent matches pl.json', () => {
    const pairs = [...html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)].map((m) => [
      m[1],
      m[2].trim(),
    ]);
    expect(pairs.length).toBeGreaterThan(15); // the sweep actually found the markup
    for (const [key, text] of pairs) expect(text, key).toBe(value(key));
  });

  it('data-i18n-aria and data-i18n-ph match pl.json', () => {
    for (const m of html.matchAll(/data-i18n-aria="([^"]+)"[^>]*aria-label="([^"]*)"/g)) {
      expect(m[2], m[1]).toBe(value(m[1]));
    }
    for (const m of html.matchAll(/data-i18n-ph="([^"]+)"[^>]*placeholder="([^"]*)"/g)) {
      expect(m[2], m[1]).toBe(value(m[1]));
    }
  });
});

describe('dynamic strings: exact legacy bytes (spot pins)', () => {
  it('HUD lines render byte-identically in pl', () => {
    expect(t('snd.on')).toBe('Dźwięk: włączony');
    expect(t('snd.off')).toBe('Dźwięk: wyłączony');
    expect(t('luck.2')).toBe('Kop, kulko, kop! ⛏️');
    expect(t('hud.discount', { p: 8, c: 384 })).toBe('🏷 Zniżka −8% 🪙384'); // U+2212 minus
    expect(t('hud.ren', { r: 60, c: 147 })).toBe('Auto-powrót 60% 🪙147');
    expect(t('hud.spawn', { l: 4, p: 60 })).toBe('Nowy (poz. 4) 🪙60');
    expect(t('inv.chip', { l: 3, p: 7, n: 2 })).toBe('poz. 3 (7) ×2');
    expect(t('stats.info', { l: 1, p: 0 })).toBe('Poziom 1 · wolne punkty: 0');
    expect(t('war.info', { l: 5, w: 2, coins: 4820 })).toBe(
      '⭐ Poziom konta 5 · Wygrane: 2 · 🪙4820',
    );
    expect(t('levelup.title', { l: 3 }) + t('levelup.crate')).toBe(
      '⭐ Awans! Poziom konta 3 · 🎁 Skrzynka!',
    );
    expect(t('crate.result', { l: 7, p: 127, where: t('crate.whereBoard') })).toBe(
      'Wylosowano kulkę poz. 7 (siła 127) — trafiła na planszę!',
    );
    expect(t('mp.infoArmy', { n: 5 })).toBe(
      'Do walki idzie twoich 5 najsilniejszych kulek (maks. 5). Przegrana nie odbiera kulek.',
    );
    expect(t('war.win', { coins: 225, xp: 90 })).toBe('Zwycięstwo! +🪙225, +90 XP. Kliknij Dalej.');
    expect(t('war.loseBall', { L: 4 })).toBe('Porażka! Tracisz kulkę poz. 4. (+🪙15)');
  });
});

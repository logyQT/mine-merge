// Temporary DOM view layer (PLAN.md Phase 2): verbatim port of the legacy
// rendering from legacy/app.js — pure READS of GameState plus DOM writes.
// Gameplay mutations live in the core, orchestration in src/app.ts.
// The stylesheet is legacy/style.css itself (pixel parity; Phase 4 cleans
// it into modules).
//
// Phase 3.2: the board (#grid + #mine) moved to the canvas — MineScene via
// the ./board façade — so this module now owns the DOM side only: HUD texts,
// buttons, inventory chips, messages and the modal screens.
//
// Signatures: state first, transient UI (sel/busy) and callbacks passed in,
// injected RNG last.

import '../../legacy/style.css';
import { curItem, curRar, curSkin, CRATES, itName, itVal, ownedMax, PCOUNT, PERK, perksOf, QW, RAR, SKINS, type CrateDef } from '../core/cosmetics';
import { accLvl, disCost, fmt, incMul, pasCost, pts, pw, renChance, sellPrice, spent, spawnPrice } from '../core/economy';
import { depth } from '../core/mine';
import type { Rng } from '../core/rng';
import type { AccStats, GameState, Perk, SkinItem, WarPowerKey } from '../core/state';
import { type Combatant, type Fight, wcost } from '../core/war';
import { boardRender, type Handlers, type Ui } from './board';
import { color } from './palette';

export type { Handlers, Ui };

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export const btn = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);

// ---- block palette: shared with the Phaser texture generator (./palette.ts) ----

// ---- skin styling (legacy stFor/bSt/skBg/skSym/bIn) ----

function skBg(k: ReturnType<typeof curSkin>, L: number): string {
  return k.pal ? k.pal[(L - 1) % k.pal.length] : color(L);
}

function skSym(k: ReturnType<typeof curSkin>, L: number): string | number {
  return k.sym ? k.sym[(L - 1) % k.sym.length] : L;
}

function stFor(k: ReturnType<typeof curSkin>, L: number, r: number): string {
  return (
    `background:${skBg(k, L)};border-radius:${k.rad};` +
    (r > 0 ? `box-shadow:inset 0 -6px 0 rgba(0,0,0,.25),0 0 0 3px ${RAR[r].c},0 0 14px ${RAR[r].c};` : '')
  );
}

const bSt = (s: GameState, L: number): string => stFor(curSkin(s), L, curRar(s));

const bIn = (s: GameState, L: number): string => {
  const k = curSkin(s);
  return k.sym ? `${skSym(k, L)}<small>${L}·${fmt(pw(L))}</small>` : `${L}<small>${fmt(pw(L))}</small>`;
};

// ---- messages / chrome ----

export function msg(t: string): void {
  $('msg').textContent = t;
}

export function updSnd(muted: boolean): void {
  $('snd').textContent = muted ? 'Dźwięk: wyłączony' : 'Dźwięk: włączony';
}

/** Hides the controls while a drop is in flight (legacy setGone). */
export function setGone(on: boolean): void {
  document.querySelectorAll('#app>.row,#sell,#drop,#crate').forEach((e) => e.classList.toggle('gone', on));
  // Phase 3: while controls collapse, the canvas rises above the DOM so the
  // flying ball passes over #inv (legacy .fly z-index:20). Everything still
  // interactive at that moment is either hidden or busy-guarded.
  document.getElementById('app')?.classList.toggle('board-top', on);
}

// ---- main render (legacy render(), minus save/bestDepth — controller) ----

export function render(s: GameState, ui: Ui, h: Handlers, rng: Rng): void {
  $('coins').textContent = fmt(s.coins);
  $('depth').textContent = String(depth(s));
  $('acc').textContent = accLvl(s) + (pts(s) > 0 ? '❗' : '');
  $('crate').style.display = (s.acc.crates || 0) > 0 ? '' : 'none';
  $('crate').textContent = `🎁 Otwórz skrzynkę (${s.acc.crates || 0})`;

  btn('spawn').textContent = `Nowy (poz. ${s.spawnLvl}) 🪙${spawnPrice(s)}`;
  btn('up').textContent = `Ulepsz start 🪙${s.upCost}`;
  btn('inc').textContent = `Zarobki ×${incMul(s, rng).toFixed(1)} 🪙${s.incCost}`;
  btn('ren').textContent = `Auto-powrót ${Math.round(renChance(s) * 100)}% 🪙${s.renCost}`;
  btn('inc').disabled = ui.busy || s.coins < s.incCost;
  btn('ren').disabled = ui.busy || s.coins < s.renCost || renChance(s) >= 1;
  btn('blast').textContent = `💥 Wybuchy ${s.blastLvl} 🪙${s.blastCost}`;
  btn('buyb').textContent = `Kup bombę 🪙${s.bombCost}`;
  btn('bomb').textContent = `💣 Mega bomba ×${s.bombs}`;
  btn('blast').disabled = ui.busy || s.coins < s.blastCost;
  btn('buyb').disabled = ui.busy || s.coins < s.bombCost;
  btn('bomb').disabled = ui.busy || s.bombs < 1;
  btn('pas').textContent = `⛏ Dochód +${s.econ.pas}/2s 🪙${pasCost(s)}`;
  btn('pas').disabled = ui.busy || s.coins < pasCost(s);
  btn('dis').textContent =
    s.econ.dis >= 6 ? '🏷 Zniżka MAX' : `🏷 Zniżka −${8 * s.econ.dis}% 🪙${disCost(s)}`;
  btn('dis').disabled = ui.busy || s.econ.dis >= 6 || s.coins < disCost(s);

  const sp = ui.sel !== null && s.grid[ui.sel] ? sellPrice(s.grid[ui.sel]) : 0;
  btn('sell').textContent = sp ? `Sprzedaj zaznaczoną kulkę 🪙${sp}` : 'Sprzedaj (najpierw zaznacz kulkę)';
  btn('sell').disabled = ui.busy || !sp;
  // legacy called save() here — the controller debounces the platform save.
  btn('spawn').disabled = ui.busy || s.coins < spawnPrice(s) || s.grid.every((x) => x !== 0);
  btn('up').disabled = ui.busy || s.coins < s.upCost;
  btn('drop').disabled = ui.busy || s.grid.every((x) => !x);
  boardRender(s, ui, h, rng); // #grid + #mine on the canvas (MineScene)
  renderInv(s, ui, h);
}

export function renderInv(s: GameState, ui: Ui, h: Handlers): void {
  const v = $('inv');
  v.innerHTML = '<b>Ekwipunek:</b>';
  const ks = Object.keys(s.inv)
    .filter((k) => s.inv[k] > 0)
    .sort((a, b) => Number(b) - Number(a));
  if (!ks.length) {
    v.innerHTML += ' pusty — zrzucone przedmioty trafią tutaj';
    return;
  }
  ks.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.style.background = color(Number(k));
    b.textContent = `poz. ${k} (${fmt(pw(Number(k)))}) ×${s.inv[k]}`;
    b.disabled = ui.busy;
    b.onclick = () => h.take(Number(k));
    v.appendChild(b);
  });
}

/** One-shot good-luck banner (legacy luckMsg). */
export function luckMsg(rng: Rng): void {
  const t = ['Powodzenia! 🍀', 'Kop, kulko, kop! ⛏️', 'Niech spadają! 🎱', 'Do dzieła! 💪'];
  const d = document.createElement('div');
  d.id = 'luck';
  d.textContent = t[Math.floor(rng() * t.length)];
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}

// ---- modal screen navigation (legacy classList toggles) ----

export const show = (id: string): void => $(id).classList.remove('hide');
export const hide = (id: string): void => $(id).classList.add('hide');

/** Strip cell width in px (legacy CW). */
export const CW = 72;

/** Strip controls shared by the level-up crate and the skin crate. */
export function stripReset(strip: HTMLElement, html: string): void {
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  strip.innerHTML = html;
}

export function stripSpinTo(strip: HTMLElement, view: HTMLElement, wi: number, cw: number, jit: number): void {
  const vw = view.clientWidth;
  void strip.offsetWidth; // reflow: settle at 0 before the transition starts
  strip.style.transition = 'transform 4.2s cubic-bezier(.12,.7,.1,1)';
  strip.style.transform = `translateX(${-(wi * cw + cw / 2 - vw / 2 + jit)}px)`;
}

export function stripWin(strip: HTMLElement, wi: number): void {
  (strip.children[wi] as HTMLElement | undefined)?.classList.add('win');
}

// ---- stats screen (legacy lines 260–270) ----

export const STATS: Array<[keyof AccStats, string, string]> = [
  ['pow', '💪 Siła kulek', '+8% obrażeń (kopalnia i wojna)'],
  ['gain', '💰 Zysk', '+6% monet'],
  ['luck', '🍀 Szczęście', '+2% szans na diament w blokach'],
  ['hp', '❤ Wytrzymałość', '+6% życia kulek w wojnie'],
];

export function renderStats(s: GameState, onAdd: (k: keyof AccStats) => void): void {
  $('sInfo').textContent = `Poziom ${accLvl(s)} · wolne punkty: ${pts(s)}`;
  const L = $('sList');
  L.innerHTML = '';
  STATS.forEach(([k, n, d]) => {
    const r = document.createElement('div');
    r.style.cssText =
      'display:flex;align-items:center;gap:8px;background:var(--line);padding:8px;border-radius:10px;text-align:left';
    r.innerHTML = `<div style="flex:1"><b>${n}: ${s.acc.s[k]}</b><div style="font-size:12px">${d}</div></div>`;
    const b = document.createElement('button');
    b.textContent = '+';
    b.setAttribute('aria-label', 'Dodaj punkt: ' + n);
    b.style.cssText = 'background:#27b36a;width:44px';
    b.disabled = pts(s) < 1;
    b.onclick = () => onAdd(k);
    r.appendChild(b);
    L.appendChild(r);
  });
  const rc = 50 * accLvl(s);
  btn('sReset').textContent = `Przydziel od nowa 🪙${rc}`;
  btn('sReset').disabled = s.coins < rc || spent(s) === 0;
}

// ---- level-up crate (legacy lines 277–294) ----

export function cellHtml(s: GameState, L: number): string {
  return `<div class="cc"><div class="it" style="${bSt(s, L)}">${bIn(s, L)}</div></div>`;
}

export function renderCrate(s: GameState, spinning: boolean): void {
  $('cInfo').textContent = `Skrzynki: ${s.acc.crates || 0} · losuje kulki od poz. 1 do ${ownedMax(s)}`;
  btn('cOpen').disabled = spinning || (s.acc.crates ?? 0) < 1; // legacy: !(acc.crates > 0)
  btn('cClose').disabled = spinning;
}

// ---- shop / skin crates / skin inventory (legacy lines 295–375) ----

export const skCell = (k: SkinDefLike, r: number, L: number): string =>
  `<div class="cc"><div class="it" style="${stFor(k, L, r)}">${skSym(k, L)}</div></div>`;

type SkinDefLike = ReturnType<typeof curSkin>;

export function renderShop(s: GameState, onBuy: (ci: number) => void): void {
  const cur = curItem(s);
  $('shInfo').textContent = `🪙${fmt(s.coins)} · skiny w ekwipunku: ${s.skins.items.length} · założony: ${cur ? itName(cur) : 'Klasyczne'}`;
  btn('shInv').textContent = `🎒 Ekwipunek skinów (${s.skins.items.length})`;
  const L = $('shList');
  L.innerHTML = '';
  CRATES.forEach((cr, ci) => {
    const r = document.createElement('div');
    r.style.cssText =
      'display:flex;align-items:center;gap:8px;background:var(--line);padding:8px;border-radius:10px;text-align:left';
    const od = cr.odds
      .map((p, i) => (p ? `<span style="color:${RAR[i].c}">${RAR[i].n} ${p}%</span>` : ''))
      .filter(Boolean)
      .join(' · ');
    r.innerHTML = `<div style="flex:1"><b>📦 ${cr.name}</b><div style="font-size:11px;margin-top:3px">${od}</div></div>`;
    const b = document.createElement('button');
    b.textContent = `🪙${fmt(cr.price)}`;
    b.style.cssText = 'width:90px;font-size:14px;padding:10px 4px;background:#d9a21f';
    b.onclick = () => onBuy(ci);
    r.appendChild(b);
    L.appendChild(r);
  });
}

export function renderSpin(s: GameState, spinning: boolean, crate: CrateDef): void {
  // Legacy quirk kept for parity: $('sInfo') resolves to the FIRST #sInfo in
  // the document — the stats screen's — so the spin screen's own copy stays
  // blank, exactly like the original (duplicate ids preserved in index.html).
  $('sInfo').textContent = `🪙${fmt(s.coins)} · Moce skina działają po jego założeniu`;
  btn('sOpen').textContent = `Otwórz 🪙${fmt(crate.price)}`;
  btn('sOpen').disabled = spinning || s.coins < crate.price;
  btn('sClose').disabled = spinning;
}

const fmtPerk = (p: Perk): string =>
  `${PERK[p.t].ic} ${PERK[p.t].n} +${PERK[p.t].v[p.q]}${PERK[p.t].u} (${RAR[p.q].n})`;

export const perkHtml = (it: SkinItem, rng: Rng): string =>
  perksOf(it, rng)
    .map((p) => `<span style="color:${RAR[p.q].c}">${fmtPerk(p)}</span>`)
    .join('<br>');

export function renderSInv(
  s: GameState,
  onToggle: (id: number | null) => void,
  onSell: (id: number) => void,
  rng: Rng,
): void {
  const cur = curItem(s);
  $('siInfo').textContent = `🪙${fmt(s.coins)} · założony: ${cur ? itName(cur) : 'Klasyczne'}`;
  const L = $('siList');
  L.innerHTML = '';
  const mkRow = (inner: string, btns: HTMLButtonElement[]): void => {
    const r = document.createElement('div');
    r.style.cssText =
      'display:flex;align-items:center;gap:8px;background:var(--line);padding:8px;border-radius:10px;text-align:left';
    r.innerHTML = inner;
    btns.forEach((b) => r.appendChild(b));
    L.appendChild(r);
  };
  const mkBtn = (t: string, bg: string, fn: () => void, dis?: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = t;
    b.style.cssText = 'font-size:12px;padding:8px 6px;background:' + bg;
    b.disabled = !!dis;
    b.onclick = fn;
    return b;
  };
  mkRow(
    `<div style="flex:1"><b>Klasyczne</b><div style="font-size:11px">domyślne kulki</div></div>`,
    [mkBtn(s.skins.cur === null ? 'Założone ✓' : 'Załóż', '#27b36a', () => onToggle(null), s.skins.cur === null)],
  );
  [...s.skins.items].sort((a, b) => b.rar - a.rar).forEach((it) => {
    const k = SKINS.find((x) => x.id === it.theme) ?? SKINS[0];
    const pv = [1, 2, 3]
      .map(
        (l) =>
          `<div style="width:30px;height:30px;font-size:15px;color:#fff;display:flex;align-items:center;justify-content:center;${stFor(k, l, it.rar)}">${skSym(k, l)}</div>`,
      )
      .join('');
    const on = s.skins.cur === it.id;
    mkRow(
      `<div style="flex:1"><b style="color:${RAR[it.rar].c}">${itName(it)}</b><div style="font-size:11px">Wartość 🪙${fmt(itVal(it, rng))}</div><div style="font-size:11px;margin-top:3px">${perkHtml(it, rng)}</div><div style="display:flex;gap:6px;margin-top:4px">${pv}</div></div>`,
      [
        mkBtn(on ? 'Zdejmij' : 'Załóż', '#27b36a', () => onToggle(it.id)),
        mkBtn(`Sprzedaj 🪙${fmt(itVal(it, rng))}`, '#b8202f', () => onSell(it.id)),
      ],
    );
  });
}

/** The "what can drop" explainer body (legacy openCont, lines 365–369). */
export function renderContBody(): void {
  const od = CRATES[0].odds;
  let h = `<div style="font-size:12px">Wszystkie skiny są w jednej skrzynce. Motywy: ${SKINS.slice(1)
    .map((k) => k.name)
    .join(', ')}. Każdy skin ma losowe moce (działają po założeniu), a ich jakość zależy od rzadkości skina.</div>`;
  RAR.forEach((r, i) => {
    h += `<div style="background:var(--line);padding:8px;border-radius:10px"><b style="color:${r.c}">${r.n} · szansa ${od[i]}% · wartość od 🪙${fmt(r.v)}</b><div style="display:flex;gap:6px;margin:6px 0">${SKINS.slice(1)
      .map(
        (k) =>
          `<div title="${k.name}" style="width:34px;height:34px;color:#fff;font-size:17px;display:flex;align-items:center;justify-content:center;${stFor(k, 2, i)}">${skSym(k, 2)}</div>`,
      )
      .join('')}</div><div style="font-size:11px">Liczba mocy: ${PCOUNT[i]}<br>Jakość mocy: ${QW[i]
      .map((p, q) => `<span style="color:${RAR[q].c}">${RAR[q].n} ${p}%</span>`)
      .join(' · ')}</div></div>`;
  });
  h += `<div style="background:var(--line);padding:8px;border-radius:10px;font-size:11px"><b style="font-size:13px">Możliwe moce</b>${(
    Object.keys(PERK) as Array<keyof typeof PERK>
  )
    .map(
      (t) =>
        `<div style="margin-top:4px">${PERK[t].ic} ${PERK[t].n}: ${PERK[t].v.map(
          (v, q) => `<span style="color:${RAR[q].c}">+${v}${PERK[t].u}</span>`,
        ).join(' / ')}</div>`,
    )
    .join('')}</div>`;
  $('scBody').innerHTML = h;
}

// ---- war screen (legacy lines 211–230) ----

export function wLog(t: string): void {
  $('wLog').textContent = t;
}

// ---- multiplayer screen (legacy dbg / mpMsg, lines 377–378) ----

export function mpDbg(t: string): void {
  const l = $('mpLog');
  l.textContent += `[${new Date().toLocaleTimeString()}] ${t}\n`;
  l.scrollTop = l.scrollHeight;
}

export function mpMsg(t: string): void {
  $('mpMsg').textContent = t;
  mpDbg(t);
}

/** One army row: ball + HP bar + burn/slow/weak markers (legacy row()). */
function warRow(s: GameState, arr: Combatant[]): string {
  return arr
    .map(
      (b) =>
        `<div class="wb${b.hp <= 0 ? ' dead' : ''}"><div class="it" style="${bSt(s, b.L)}">${bIn(s, b.L)}</div><div class="hp"><i style="width:${Math.max(0, (b.hp / b.max) * 100)}%"></i></div><div>${b.burn > 0 ? '🔥' : ''}${b.slow > 0 ? '❄' : ''}${b.wk > 0 ? '☠' : ''}&nbsp;</div></div>`,
    )
    .join('');
}

const WAR_UPGRADES: Array<[string, string, WarPowerKey]> = [
  ['pFire', '🔥 Podpalenie', 'fire'],
  ['pSlow', '❄ Spowolnienie', 'slow'],
  ['pWeak', '☠ Osłabienie', 'weak'],
];

export function renderWar(s: GameState, fight: Fight | null, mpOn: boolean): void {
  $('wInfo').textContent = `⭐ Poziom konta ${accLvl(s)} · Wygrane: ${s.war.wave - 1} · 🪙${s.coins}`;
  const fT = fight && (fight.flip ? fight.p : fight.e);
  const fB = fight && (fight.flip ? fight.e : fight.p);
  $('eRow').innerHTML = fT ? warRow(s, fT) : '';
  $('pRow').innerHTML = fB ? warRow(s, fB) : '';
  const live = !!(fight && fight.run && !fight.over);
  btn('wGo').textContent = !fight ? 'Odśwież' : fight.over ? 'Dalej' : live ? 'Walka trwa…' : 'Walka!';
  btn('wGo').disabled = live;
  WAR_UPGRADES.forEach(([id, n, k]) => {
    btn(id).textContent = `${n} ${s.war[k]} 🪙${wcost(s.war[k])}`;
    btn(id).disabled = live || s.coins < wcost(s.war[k]);
  });
  if (mpOn) {
    btn('wGo').textContent = fight && fight.over ? 'Zakończ' : 'Walka PvP…';
    btn('wGo').disabled = !(fight && fight.over);
    (btn('pFire').parentElement as HTMLElement).style.display = 'none';
  } else {
    (btn('pFire').parentElement as HTMLElement).style.display = '';
  }
}

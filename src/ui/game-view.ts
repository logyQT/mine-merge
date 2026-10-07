// Temporary DOM view layer (PLAN.md Phase 2): verbatim port of the legacy
// rendering from legacy/app.js — pure READS of GameState plus DOM writes.
// Gameplay mutations live in the core, orchestration in src/app.ts.
// The stylesheet is legacy/style.css itself (pixel parity; Phase 4 cleans
// it into modules).
//
// Signatures: state first, transient UI (sel/busy) and callbacks passed in,
// injected RNG last.

import '../../legacy/style.css';
import { COLS } from '../config';
import { curRar, curSkin, RAR } from '../core/cosmetics';
import { accLvl, disCost, fmt, incMul, pasCost, pts, pw, renChance, sellPrice, spawnPrice } from '../core/economy';
import { depth, rowAt, viewRows } from '../core/mine';
import type { Rng } from '../core/rng';
import type { GameState } from '../core/state';

export interface Ui {
  sel: number | null;
  busy: boolean;
}

export interface Handlers {
  tap(i: number): void;
  take(level: number): void;
}

export interface Hit {
  c: number;
  r: number;
}

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export const btn = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);

// ---- block palette (legacy color/TC/PAT/tier/blockColor) ----

function color(l: number): string {
  return `hsl(${(l * 47 + 200) % 360} 65% 52%)`;
}

const TC = ['#d64545', '#3f7fd9', '#3fae5a', '#d9b83f', '#8d5cc9', '#e0802f', '#2fb3a8', '#d95fa0', '#7d8aa0', '#3b3b4a'];

const PAT = [
  'radial-gradient(rgba(255,255,255,.35) 1.5px,transparent 2px) 0 0/8px 8px',
  'repeating-linear-gradient(45deg,rgba(0,0,0,.18) 0 4px,transparent 4px 8px)',
  'linear-gradient(rgba(0,0,0,.25) 2px,transparent 2px) 0 0/100% 50%,linear-gradient(90deg,rgba(0,0,0,.25) 2px,transparent 2px) 0 0/50% 100%',
  'repeating-linear-gradient(45deg,rgba(0,0,0,.2) 0 2px,transparent 2px 7px),repeating-linear-gradient(-45deg,rgba(0,0,0,.2) 0 2px,transparent 2px 7px)',
  'conic-gradient(rgba(0,0,0,.2) 25%,transparent 0 50%,rgba(0,0,0,.2) 0 75%,transparent 0) 0 0/10px 10px',
];

const tier = (hp: number): number => Math.min(9, hp <= 1 ? 0 : Math.floor(Math.log2(hp)) + 1);

const blockColor = (b: { hp: number }): string | null => (b.hp <= 0 ? null : TC[tier(b.hp)]);

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
}

// ---- main render (legacy render(), minus save/bestDepth — controller) ----

export function render(s: GameState, ui: Ui, h: Handlers, rng: Rng): void {
  $('coins').textContent = fmt(s.coins);
  $('depth').textContent = String(depth(s));
  $('acc').textContent = accLvl(s) + (pts(s) > 0 ? '❗' : '');
  $('crate').style.display = (s.acc.crates || 0) > 0 ? '' : 'none';
  $('crate').textContent = `🎁 Otwórz skrzynkę (${s.acc.crates || 0})`;

  const g = $('grid');
  g.innerHTML = '';
  s.grid.forEach((l, i) => {
    const c = document.createElement('div');
    c.className = 'c' + (ui.sel === i ? ' sel' : '');
    c.setAttribute('role', 'gridcell');
    c.onclick = () => h.tap(i);
    if (l) {
      const d = document.createElement('div');
      d.className = 'it';
      d.style.cssText += bSt(s, l);
      d.innerHTML = bIn(s, l);
      c.appendChild(d);
    }
    g.appendChild(c);
  });

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
  renderMine(s, rng);
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

/** Renders the visible mine rows; `hit` flashes a just-landed cell. */
export function renderMine(s: GameState, rng: Rng, hit?: Hit): void {
  const m = $('mine');
  m.innerHTML = '';
  for (let k = 0; k < viewRows(s, rng); k++) {
    const r = s.topRow + k;
    const row = rowAt(s, r, rng); // legacy renderMine reads via rowAt — generates the frontier
    row.forEach((b, c) => {
      const d = document.createElement('div');
      const col = blockColor(b);
      d.className = 'b' + (col ? '' : ' empty') + (hit && hit.c === c && hit.r === r ? ' hit' : '');
      if (hit && hit.c === c && hit.r === r) d.style.setProperty('--d', String(k));
      if (col) {
        d.style.background = `${PAT[tier(b.hp) % 5]},${col}`;
        d.style.textShadow = '0 1px 2px rgba(0,0,0,.6)';
        if (b.gem) d.style.boxShadow = 'inset 0 0 0 3px #ffd1f0';
        d.textContent = (b.gem ? '💎 ' : '') + fmt(b.hp);
      }
      m.appendChild(d);
    });
  }
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

/** Animates a ball from the merge grid into the mine (legacy flyBall). */
export function flyBall(s: GameState, i: number, c: number, r: number, L: number, rng: Rng): Promise<void> {
  return new Promise((res) => {
    const cell = $('grid').children[i] as HTMLElement | undefined;
    const m = $('mine');
    const k = Math.max(0, Math.min(r - s.topRow, Math.floor(m.children.length / COLS) - 1));
    const tg = m.children[k * COLS + c] as HTMLElement | undefined;
    if (matchMedia('(prefers-reduced-motion:reduce)').matches || !cell || !tg) {
      setTimeout(res, 60);
      return;
    }
    const a = cell.getBoundingClientRect();
    const t = tg.getBoundingClientRect();
    const sz = Math.min(a.width, a.height) * 0.8;
    const dx = t.left + t.width / 2 - (a.left + a.width / 2);
    const dy = t.top + t.height * 0.2 - (a.top + a.height / 2);
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:${a.left + a.width / 2 - sz / 2}px;top:${a.top + a.height / 2 - sz / 2}px;width:${sz}px;height:${sz}px;z-index:20;pointer-events:none`;
    const ball = document.createElement('div');
    ball.className = 'it';
    ball.style.cssText = `width:100%;height:100%;${bSt(s, L)}`;
    ball.innerHTML = bIn(s, L);
    el.appendChild(ball);
    document.body.appendChild(el);
    const D = 130 + Math.sqrt(Math.abs(dy)) * 11;
    const rot = (rng() < 0.5 ? -1 : 1) * (180 + rng() * 180);
    const ao = el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }], {
      duration: D,
      easing: 'linear',
      fill: 'forwards',
    });
    const ai = ball.animate(
      [{ transform: 'translateY(0) rotate(0deg)' }, { transform: `translateY(${dy}px) rotate(${rot}deg)` }],
      { duration: D, easing: 'cubic-bezier(.55,.085,.68,.53)', fill: 'forwards' },
    );
    Promise.all([ao.finished, ai.finished])
      .then(() => {
        res();
        const drift = (rng() - 0.5) * 40;
        el.animate([{ transform: `translateX(${dx}px)` }, { transform: `translateX(${dx + drift}px)` }], {
          duration: 340,
          fill: 'forwards',
        });
        const bn = ball.animate(
          [
            { transform: `translateY(${dy}px) rotate(${rot}deg) scale(1.3,.7)`, opacity: 1 },
            { transform: `translateY(${dy - 20}px) rotate(${rot + 50}deg) scale(1)`, opacity: 1, offset: 0.4 },
            { transform: `translateY(${dy + 6}px) rotate(${rot + 80}deg) scale(1.1,.9)`, opacity: 0 },
          ],
          { duration: 340, easing: 'ease-out', fill: 'forwards' },
        );
        bn.onfinish = () => el.remove();
      })
      .catch(() => {
        el.remove();
        res();
      });
  });
}

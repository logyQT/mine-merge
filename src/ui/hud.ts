// In-game HUD (PLAN.md Phase 3.4): the play-screen chrome stays in the DOM —
// top bar, upgrade/action buttons, inventory chips and transient messages —
// because it is text-heavy and needs to be i18n/accessibility-friendly
// (Phase 4). The board itself renders on the canvas via ./board (MineScene),
// and the modal screens (shop/stats/crates/war/mp) live in ./game-view.
//
// Pure READS of GameState plus DOM writes; orchestration stays in src/app.ts.
// Signatures: state first, transient UI (sel/busy) and callbacks passed in,
// injected RNG last.

import '../../legacy/style.css';
import { accLvl, disCost, fmt, incMul, pasCost, pts, pw, renChance, sellPrice, spawnPrice } from '../core/economy';
import { depth } from '../core/mine';
import type { Rng } from '../core/rng';
import type { GameState } from '../core/state';
import { boardRender, type Handlers, type Ui } from './board';
import { color } from './palette';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export const btn = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);

// ---- transient chrome (legacy msg/updSnd/setGone/luckMsg) ----

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

/** One-shot good-luck banner (legacy luckMsg). */
export function luckMsg(rng: Rng): void {
  const t = ['Powodzenia! 🍀', 'Kop, kulko, kop! ⛏️', 'Niech spadają! 🎱', 'Do dzieła! 💪'];
  const d = document.createElement('div');
  d.id = 'luck';
  d.textContent = t[Math.floor(rng() * t.length)];
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}

// ---- main HUD render (legacy render(), minus save/bestDepth — controller) ----

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

/** Inventory chips under the buttons (legacy renderInv). */
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

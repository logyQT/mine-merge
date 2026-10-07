// Temporary app shell (PLAN.md Phase 2): wires the ported DOM view to the
// extracted core, ported from legacy/app.js. Everything here is orchestration
// — rules/math live in src/core, rendering in src/ui/game-view.ts. When a
// screen's slice is not ported yet, its menu button stays hidden (index.html).
//
// Replaces the legacy YG/IN_PLAY/cloudLoad/sendBest blocks: persistence goes
// through platform.saveSave (debounced), scores through platform.sendScore,
// pause/resume through platform.onPause/onResume (PLAN §1.2).

import { N } from './config';
import { isMuted, setAudioGate, setMuted, sfx, warmAudio } from './audio/sfx';
import { perk } from './core/cosmetics';
import {
  accLvl,
  addXp,
  disCost,
  fmt,
  incMul,
  pasCost,
  pts,
  pw,
  renChance,
  sellPrice,
  spawnPrice,
} from './core/economy';
import { advanceTopRow, applyBomb, depth, land, planDrop } from './core/mine';
import type { Rng } from './core/rng';
import { serialize } from './core/save';
import { createInitialState, resetState, type GameState } from './core/state';
import type { Platform } from './platform/types';
import {
  $,
  btn,
  flyBall,
  luckMsg,
  msg,
  render,
  renderMine,
  setGone,
  updSnd,
  type Handlers,
  type Ui,
} from './ui/game-view';

// ---- module state (legacy globals: transient UI + timers) ----

export const state: GameState = createInitialState();
const rng: Rng = Math.random; // play uses true randomness, like legacy
let sel: number | null = null;
let busy = false;
let paused = false;
let passiveIv: ReturnType<typeof setInterval> | null = null;
let saveT: ReturnType<typeof setTimeout> | null = null;
let wipeT: ReturnType<typeof setTimeout> | null = null;
let platform: Platform;

// ---- pause-aware sleep (legacy line 153) ----

const sleep = (ms: number): Promise<void> =>
  new Promise((res) => {
    const step = (): void => {
      if (paused) setTimeout(step, 50);
      else res();
    };
    setTimeout(step, ms);
  });

// ---- platform save: debounced per PLAN §1.2, flushed on pause/shutdown ----

function requestSave(): void {
  if (saveT !== null) clearTimeout(saveT);
  saveT = setTimeout(() => {
    saveT = null;
    void platform.saveSave(serialize(state));
  }, 500);
}

function flushSave(): void {
  if (saveT !== null) {
    clearTimeout(saveT);
    saveT = null;
  }
  void platform.saveSave(serialize(state));
}

// ---- render driver: bestDepth/sendScore moved out of the view ----

const HANDLERS: Handlers = { tap, take };

function refresh(): void {
  const d = depth(state);
  if (d > state.bestDepth) {
    state.bestDepth = d;
    platform.sendScore(d);
  }
  const ui: Ui = { sel, busy };
  render(state, ui, HANDLERS, rng);
  requestSave(); // legacy render() called save() here
}

/** addXp port: core returns the level-up, the toast + jingle stay here. */
function gainXp(n: number): void {
  const up = addXp(state, n, rng);
  if (up) {
    setTimeout(() => {
      msg(`⭐ Awans! Poziom konta ${up.level}` + (up.crates ? ' · 🎁 Skrzynka!' : ''));
      sfx.up();
    }, 60);
  }
}

// ---- merge grid interactions (legacy tap / take) ----

function tap(i: number): void {
  if (busy) return;
  if (sel === null) {
    if (state.grid[i]) {
      sel = i;
      sfx.click();
    }
  } else if (sel === i) {
    sel = null;
  } else if (!state.grid[i]) {
    state.grid[i] = state.grid[sel];
    state.grid[sel] = 0;
    sel = null;
    sfx.click();
  } else if (state.grid[i] === state.grid[sel]) {
    state.grid[i] += 1;
    state.grid[sel] = 0;
    sel = null;
    sfx.merge(state.grid[i]);
    msg(`Połączono! Poziom ${state.grid[i]}`);
  } else {
    sel = i;
  }
  refresh();
}

function take(L: number): void {
  if (busy) return;
  const e = state.grid.indexOf(0);
  if (e < 0) {
    msg('Plansza pełna — połącz przedmioty.');
    return;
  }
  state.grid[e] = L;
  state.inv[L] -= 1;
  refresh();
}

// ---- shop / upgrade buttons (legacy onclick blocks, verbatim) ----

function bindControls(): void {
  btn('spawn').onclick = () => {
    const e = state.grid.indexOf(0);
    if (e < 0 || state.coins < spawnPrice(state)) return;
    state.coins -= spawnPrice(state);
    sfx.spawn();
    state.grid[e] = state.spawnLvl;
    refresh();
  };
  btn('up').onclick = () => {
    if (state.coins < state.upCost) return;
    state.coins -= state.upCost;
    sfx.up();
    state.spawnLvl += 1;
    state.upCost = Math.round(state.upCost * 2.6);
    msg(`Nowe kulki startują od poz. ${state.spawnLvl}, ale kosztują już 🪙${spawnPrice(state)}`);
    refresh();
  };
  btn('inc').onclick = () => {
    if (state.coins < state.incCost) return;
    state.coins -= state.incCost;
    sfx.up();
    state.incLvl += 1;
    state.incCost = Math.round(state.incCost * 2.2);
    msg(`Zarobki ×${incMul(state, rng).toFixed(1)}`);
    refresh();
  };
  btn('ren').onclick = () => {
    if (state.coins < state.renCost || renChance(state) >= 1) return;
    state.coins -= state.renCost;
    sfx.up();
    state.renLvl += 1;
    state.renCost = Math.round(state.renCost * 2.1);
    msg(`Szansa odnowy: ${Math.round(renChance(state) * 100)}%`);
    refresh();
  };
  btn('pas').onclick = () => {
    const c = pasCost(state);
    if (busy || state.coins < c) return;
    state.coins -= c;
    state.econ.pas += 1;
    sfx.up();
    msg(`Pasywny dochód: +${state.econ.pas} monet co 2 sekundy`);
    refresh();
  };
  btn('dis').onclick = () => {
    const c = disCost(state);
    if (busy || state.econ.dis >= 6 || state.coins < c) return;
    state.coins -= c;
    state.econ.dis += 1;
    sfx.up();
    msg(`Nowe kulki kosztują teraz 🪙${spawnPrice(state)}`);
    refresh();
  };
  btn('blast').onclick = () => {
    if (state.coins < state.blastCost) return;
    state.coins -= state.blastCost;
    sfx.up();
    state.blastLvl += 1;
    state.blastCost = Math.round(state.blastCost * 2.3);
    msg('Upadające kulki wybuchają po bokach i w dół!');
    refresh();
  };
  btn('buyb').onclick = () => {
    if (state.coins < state.bombCost) return;
    state.coins -= state.bombCost;
    sfx.up();
    state.bombs += 1;
    state.bombCost = Math.round(state.bombCost * 1.7);
    refresh();
  };
  btn('bomb').onclick = () => {
    if (state.bombs < 1 || busy) return;
    state.bombs -= 1;
    sfx.boom();
    const raw = applyBomb(state, rng);
    const e = Math.round(raw * incMul(state, rng));
    state.coins += e;
    gainXp(e);
    advanceTopRow(state, rng);
    msg(`💣 BUM! Trzy górne rzędy osłabione o połowę: +🪙${e}`);
    refresh();
  };
  btn('sell').onclick = () => {
    if (sel === null || !state.grid[sel] || busy) return;
    const p = sellPrice(state.grid[sel]);
    state.coins += p;
    sfx.coin();
    state.grid[sel] = 0;
    sel = null;
    msg(`Sprzedano za 🪙${p}`);
    refresh();
  };
  // #crate (level-up reward) gets its handler with the crate screen slice.
}

// ---- the drop sequence (legacy lines 180–205) ----

function bindDrop(): void {
  btn('drop').onclick = async () => {
    if (busy) return;
    busy = true;
    sel = null;
    setGone(true);
    luckMsg(rng);
    let earned = 0;
    let nInv = 0;
    const back: Array<[number, number]> = [];
    const P: Array<Promise<void>> = [];
    const pend: Record<string, number> = {};
    await sleep(450);
    for (let i = 0; i < state.grid.length; i++) {
      if (!state.grid[i]) continue;
      const L = state.grid[i];
      const c = i % N;
      const dmg = Math.round(pw(L) * (1 + 0.08 * state.acc.s.pow + perk(state, 'pow', rng) / 100));
      const r = planDrop(state, c, dmg, pend, rng);
      const fl = flyBall(state, i, c, r, L, rng);
      state.grid[i] = 0;
      if (rng() < renChance(state)) back.push([i, L]);
      else {
        state.inv[L] = (state.inv[L] || 0) + 1;
        nInv += 1;
      }
      refresh();
      P.push(
        fl.then(() => {
          const o = land(state, c, L, dmg, rng);
          earned += o.e;
          refresh();
          renderMine(state, rng, { c, r: o.fr });
          advanceTopRow(state, rng);
        }),
      );
      await sleep(110);
    }
    await Promise.all(P);
    await sleep(300);
    earned = Math.round(earned * incMul(state, rng));
    if (earned > 0) sfx.coin();
    gainXp(earned);
    back.forEach(([i, L]) => (state.grid[i] = L));
    state.coins += earned;
    busy = false;
    setGone(false);
    msg(`Zdobyto 🪙${earned}. Na planszę wróciło ${back.length}, do ekwipunku ${nInv}.`);
    if (state.coins < spawnPrice(state) && state.grid.every((x) => !x)) {
      state.coins = spawnPrice(state);
      msg('Dostajesz zapasowe monety, kop dalej!');
    }
    refresh();
  };
}

// ---- passive income (legacy lines 123–127) ----

function passiveTick(): void {
  if (paused || state.econ.pas < 1) return;
  state.coins += Math.round(state.econ.pas * (1 + 0.05 * (accLvl(state) - 1)));
  $('coins').textContent = fmt(state.coins);
}

function startPassive(): void {
  if (passiveIv === null) passiveIv = setInterval(passiveTick, 2000);
}

function stopPassive(): void {
  if (passiveIv !== null) {
    clearInterval(passiveIv);
    passiveIv = null;
  }
}

// ---- menu (legacy lines 442–457) ----

const hasProgress = (): boolean =>
  state.topRow > 0 ||
  state.coins !== 30 ||
  state.grid.some((x) => x !== 0) ||
  state.spawnLvl > 1 ||
  state.incLvl > 0 ||
  state.renLvl > 0 ||
  state.blastLvl > 0 ||
  state.war.wave > 1 ||
  state.acc.xp > 0;

function openMenu(): void {
  btn('statsBtn').textContent = '⭐ Statystyki' + (pts(state) > 0 ? ` (${pts(state)} pkt)` : '');
  btn('play').textContent = hasProgress() ? 'Kontynuuj' : 'Graj';
  $('menu').classList.remove('hide');
  btn('play').focus();
}

function armWipe(on: boolean): void {
  if (wipeT !== null) clearTimeout(wipeT);
  btn('wipe').textContent = on ? 'Na pewno? Kliknij jeszcze raz' : 'Resetuj postęp';
  if (on) wipeT = setTimeout(() => armWipe(false), 4000);
  btn('wipe').dataset.armed = on ? '1' : '';
}

function bindMenu(): void {
  btn('play').onclick = () => {
    warmAudio();
    $('menu').classList.add('hide');
    armWipe(false);
  };
  btn('how').onclick = () => $('rules').classList.toggle('show');
  btn('menuBtn').onclick = () => {
    if (!busy) openMenu();
  };
  btn('snd').onclick = () => {
    setMuted(!isMuted());
    updSnd(isMuted());
    sfx.click();
  };
  btn('wipe').onclick = () => {
    if (!btn('wipe').dataset.armed) {
      armWipe(true);
      return;
    }
    armWipe(false);
    resetState(state);
    sel = null;
    busy = false;
    platform.sendScore(0);
    flushSave(); // legacy removed the save key, then render() re-saved defaults
    msg('Postęp wyzerowany. Zaczynasz od nowa!');
    refresh();
    btn('play').textContent = 'Graj';
  };
}

// ---- platform pause/resume (legacy lines 459–470) ----
// The war-timer halves arrive with the war screen slice (legacy: wTimer).

function pauseGame(): void {
  if (paused) return;
  paused = true;
  stopPassive();
  try {
    document.getAnimations().forEach((a) => {
      try {
        a.pause();
      } catch {
        // an animation may already be finished — ignore
      }
    });
  } catch {
    // getAnimations unsupported — ignore (legacy guard)
  }
  flushSave(); // SHOULD: persist before a possible close
}

function resumeGame(): void {
  if (!paused) return;
  paused = false;
  startPassive();
  try {
    document.getAnimations().forEach((a) => {
      try {
        a.play();
      } catch {
        // ignore finished animations
      }
    });
  } catch {
    // getAnimations unsupported — ignore (legacy guard)
  }
}

/** Blocks all input while paused (legacy blockIfPaused, capture phase). */
const blockIfPaused = (e: Event): void => {
  if (paused) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }
};

// ---- boot sequence (legacy boot(): updSnd → render → openMenu → sendBest) ----

export function startApp(p: Platform): void {
  platform = p;
  setAudioGate(() => platform.isAudioEnabled()); // PLAN DoD: sfx follows the platform

  bindControls();
  bindDrop();
  bindMenu();
  // statsBtn/warBtn/shopBtn/mpBtn + #crate stay unwired until their slices;
  // their menu buttons are hidden in index.html meanwhile.

  (['click', 'keydown', 'pointerdown', 'touchstart'] as const).forEach((t) =>
    document.addEventListener(t, blockIfPaused, true),
  );

  startPassive();
  updSnd(isMuted());
  refresh();
  openMenu();

  p.onPause(pauseGame);
  p.onResume(resumeGame);
  window.addEventListener('pagehide', flushSave);
  p.sendScore(state.bestDepth || 0);

  if (__PLATFORM__ === 'yt') btn('snd').style.display = 'none'; // legacy IN_PLAY: platform owns audio
}

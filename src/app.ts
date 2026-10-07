// Temporary app shell (PLAN.md Phase 2): wires the ported DOM view to the
// extracted core, ported from legacy/app.js. Everything here is orchestration
// — rules/math live in src/core, rendering in src/ui/hud.ts (play screen),
// src/ui/game-view.ts (modals) and the canvas board (src/scenes/MineScene
// via src/ui/board). When a screen's slice is not ported yet, its menu button
// stays hidden (index.html).
//
// Replaces the legacy YG/IN_PLAY/cloudLoad/sendBest blocks: persistence goes
// through platform.saveSave (debounced), scores through platform.sendScore,
// pause/resume through platform.onPause/onResume (PLAN §1.2).

import { N } from './config';
import { isMuted, setAudioGate, setMuted, sfx, warmAudio } from './audio/sfx';
import { crateRoll, CRATES, itName, itVal, ownedMax, perk, RAR, rollPerks, rollRar, rollTheme, rnd5, type CrateDef } from './core/cosmetics';
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
  spent,
  spawnPrice,
  type LevelUp,
} from './core/economy';
import { advanceTopRow, applyBomb, depth, land, planDrop } from './core/mine';
import type { Rng } from './core/rng';
import { serialize } from './core/save';
import {
  createInitialState,
  resetState,
  type AccStats,
  type GameState,
  type SkinItem,
  type WarPowerKey,
} from './core/state';
import { createNet, type Net } from './mp';
import { prepareFight, tick, wcost, wEnd, armyList, mk, type Fight, type Power } from './core/war';
import type { Platform } from './platform/types';
import { flyBall, renderMine, type Handlers, type Ui } from './ui/board';
import { $, btn, luckMsg, msg, render, setGone, updSnd } from './ui/hud';
import { setWarOpen } from './ui/war-canvas';
import {
  cellHtml,
  CW,
  hide,
  perkHtml,
  renderContBody,
  renderCrate,
  renderShop,
  renderSInv,
  renderSpin,
  renderStats,
  renderWar,
  show,
  skCell,
  stripReset,
  stripSpinTo,
  stripWin,
  mpDbg,
  mpMsg,
  wLog,
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

/** Level-up side effects: toast + jingle 60 ms later (legacy addXp inline). */
function announceLevelUp(up: LevelUp | null): void {
  if (up) {
    setTimeout(() => {
      msg(`⭐ Awans! Poziom konta ${up.level}` + (up.crates ? ' · 🎁 Skrzynka!' : ''));
      sfx.up();
    }, 60);
  }
}

/** addXp port: core applies the XP; the announcement stays here. */
function gainXp(n: number): void {
  announceLevelUp(addXp(state, n, rng));
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
          sfx.hit(); // legacy land() ended with sfx.hit() + sfx.brk()
          if (o.e > 0) sfx.brk(); // any earned coins ⇔ a block broke
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
    sfx.click();
    $('menu').classList.add('hide');
    armWipe(false);
  };
  btn('how').onclick = () => {
    sfx.click();
    $('rules').classList.toggle('show');
  };
  btn('menuBtn').onclick = () => {
    if (busy) return;
    sfx.click();
    openMenu();
  };
  btn('snd').onclick = () => {
    setMuted(!isMuted());
    updSnd(isMuted());
    sfx.click();
  };
  btn('wipe').onclick = () => {
    sfx.click();
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

// ---- stats screen (legacy lines 260–272) ----

function renderStatsView(): void {
  renderStats(state, addStat);
}

function addStat(k: keyof AccStats): void {
  if (pts(state) < 1) return;
  state.acc.s[k] += 1;
  sfx.up();
  requestSave(); // legacy save()
  renderStatsView();
}

function bindStats(): void {
  btn('statsBtn').onclick = () => {
    warmAudio();
    sfx.click();
    hide('menu');
    show('stats');
    renderStatsView();
  };
  btn('sReset').onclick = () => {
    const rc = 50 * accLvl(state);
    if (state.coins < rc || spent(state) === 0) return;
    state.coins -= rc;
    state.acc.s = { pow: 0, gain: 0, luck: 0, hp: 0 };
    requestSave();
    renderStatsView();
  };
  btn('sBack').onclick = () => {
    hide('stats');
    refresh();
    openMenu();
  };
}

// ---- level-up crate (legacy lines 273–294) ----

let spinning = false;

function bindCrate(): void {
  btn('crate').onclick = () => {
    if (busy) return;
    warmAudio();
    const m = ownedMax(state);
    const cells = Array.from({ length: 12 }, () => cellHtml(state, crateRoll(m, rng))).join('');
    stripReset($('cstrip'), cells);
    $('cRes').textContent = '';
    show('crateov');
    renderCrate(state, spinning);
  };
  btn('cClose').onclick = () => {
    if (spinning) return;
    hide('crateov');
    refresh();
  };
  btn('cOpen').onclick = () => {
    if (spinning || (state.acc.crates ?? 0) < 1) return;
    spinning = true;
    state.acc.crates = (state.acc.crates ?? 0) - 1;
    const m = ownedMax(state);
    const win = crateRoll(m, rng);
    const N = 44;
    const WI = 36;
    const arr = Array.from({ length: N }, () => crateRoll(m, rng));
    arr[WI] = win;
    stripReset($('cstrip'), arr.map((L) => cellHtml(state, L)).join(''));
    $('cRes').textContent = 'Losowanie…';
    renderCrate(state, spinning);
    const jit = (rng() - 0.5) * 40;
    stripSpinTo($('cstrip'), $('cview'), WI, CW, jit);
    for (let k = 1; k <= 28; k++) setTimeout(() => sfx.click(), 4200 * (1 - Math.pow(1 - k / 28, 2.4)));
    setTimeout(() => {
      spinning = false;
      stripWin($('cstrip'), WI);
      sfx.merge(win);
      const e = state.grid.indexOf(0);
      let where: string;
      if (e >= 0) {
        state.grid[e] = win;
        where = 'na planszę';
      } else {
        state.inv[win] = (state.inv[win] || 0) + 1;
        where = 'do ekwipunku';
      }
      $('cRes').textContent = `Wylosowano kulkę poz. ${win} (siła ${fmt(pw(win))}) — trafiła ${where}!`;
      requestSave(); // legacy save()
      renderCrate(state, spinning);
    }, 4400);
  };
}

// ---- shop / skin crates / skin inventory (legacy lines 295–375) ----

let spinS = false;
let curCrate: CrateDef | null = null;
let contFrom: 'shop' | 'sspin' = 'shop';

function renderShopView(): void {
  renderShop(state, openSpin);
}

function renderSpinView(): void {
  if (!curCrate) return;
  renderSpin(state, spinS, curCrate);
}

function renderSInvView(): void {
  renderSInv(state, toggleEquip, sellSkin, rng);
}

function openSpin(ci: number): void {
  const crate = CRATES[ci];
  curCrate = crate;
  warmAudio();
  hide('shop');
  show('sspin');
  $('sTitle').textContent = '📦 ' + crate.name;
  $('sRes').textContent = '';
  const cells = Array.from(
    { length: 12 },
    () => skCell(rollTheme(rng), rollRar(crate.odds, rng), rnd5(rng)),
  ).join('');
  stripReset($('sstrip'), cells);
  renderSpinView();
}

function openCont(from: 'shop' | 'sspin'): void {
  contFrom = from;
  hide(from);
  show('scont');
  renderContBody();
}

function toggleEquip(id: number | null): void {
  state.skins.cur = id === null ? null : state.skins.cur === id ? null : id;
  sfx.click();
  requestSave();
  renderSInvView();
}

function sellSkin(id: number): void {
  const it = state.skins.items.find((x) => x.id === id);
  if (!it) return;
  state.coins += itVal(it, rng);
  if (state.skins.cur === id) state.skins.cur = null;
  state.skins.items = state.skins.items.filter((x) => x.id !== id);
  sfx.coin();
  requestSave();
  renderSInvView();
}

function bindShop(): void {
  btn('shopBtn').onclick = () => {
    warmAudio();
    sfx.click();
    hide('menu');
    show('shop');
    renderShopView();
  };
  btn('shBack').onclick = () => {
    hide('shop');
    refresh();
    openMenu();
  };
  btn('shInv').onclick = () => {
    hide('shop');
    show('sinv');
    renderSInvView();
  };
  btn('siBack').onclick = () => {
    hide('sinv');
    show('shop');
    renderShopView();
  };
  btn('sClose').onclick = () => {
    if (spinS) return;
    hide('sspin');
    show('shop');
    renderShopView();
  };
  btn('sCont').onclick = () => {
    if (!spinS) openCont('sspin');
  };
  btn('scBack').onclick = () => {
    hide('scont');
    show(contFrom);
  };
  btn('sOpen').onclick = () => {
    const crate = curCrate;
    if (!crate) return;
    if (spinS || state.coins < crate.price) return;
    state.coins -= crate.price;
    spinS = true;
    const od = crate.odds;
    const rar = rollRar(od, rng);
    const th = rollTheme(rng);
    const N = 44;
    const WI = 36;
    const L0 = rnd5(rng);
    const arr = Array.from({ length: N }, (_, i) =>
      i === WI ? skCell(th, rar, L0) : skCell(rollTheme(rng), rollRar(od, rng), rnd5(rng)),
    );
    stripReset($('sstrip'), arr.join(''));
    $('sRes').textContent = 'Losowanie…';
    renderSpinView();
    const jit = (rng() - 0.5) * 40;
    stripSpinTo($('sstrip'), $('sview'), WI, CW, jit);
    for (let k = 1; k <= 28; k++) setTimeout(() => sfx.click(), 4200 * (1 - Math.pow(1 - k / 28, 2.4)));
    setTimeout(() => {
      spinS = false;
      stripWin($('sstrip'), WI);
      sfx.merge(2 + rar * 3);
      const it: SkinItem = { id: state.skins.nid++, theme: th.id, rar, perks: rollPerks(rar, rng) };
      state.skins.items.push(it);
      $('sRes').innerHTML = `<span style="color:${RAR[rar].c}">${itName(it)}</span><br><span style="font-size:12px">${perkHtml(it, rng)}</span><br>Wartość: 🪙${fmt(itVal(it, rng))} — dodano do ekwipunku skinów`;
      requestSave(); // legacy save()
      renderSpinView();
    }, 4400);
  };
}

// ---- war screen (legacy lines 211–259) ----

let fight: Fight | null = null;
let wTimer: ReturnType<typeof setInterval> | null = null;
let warWasRunning = false;

function stopWarTimer(): void {
  if (wTimer !== null) {
    clearInterval(wTimer);
    wTimer = null;
  }
}

function startTicker(): void {
  stopWarTimer();
  wTimer = setInterval(tickOnce, 100);
}

function renderWarView(): void {
  renderWar(state, fight, mp.on);
}

function tickOnce(): void {
  if (!fight) return;
  const ev = tick(state, fight, rng);
  for (let i = 0; i < ev.hits; i++) sfx.hit(); // legacy tick called sfx per attack
  for (let i = 0; i < ev.kills; i++) sfx.brk();
  if (ev.done) {
    if (fight.pvp) mpEnd(fight, ev.done.pa, ev.done.ea); // legacy line 253
    else endFight(ev.done.playerWon);
  }
  renderWarView();
}

function endFight(win: boolean): void {
  if (!fight) return;
  stopWarTimer();
  const r = wEnd(state, fight, win, rng);
  if (win) sfx.coin();
  announceLevelUp(r.levelUp);
  wLog(r.message);
  requestSave(); // legacy save()
  renderWarView();
}

function prepareWar(): void {
  stopWarTimer(); // legacy prepare(): clearInterval(wTimer)
  const p = prepareFight(state, rng);
  fight = p.fight;
  wLog(p.message);
  renderWarView();
}

function bindWar(): void {
  btn('warBtn').onclick = () => {
    warmAudio();
    sfx.click();
    hide('menu');
    show('war');
    setWarOpen(true); // canvas above the overlay before the first draw
    prepareWar();
  };
  btn('wGo').onclick = () => {
    if (mp.on) {
      if (fight && fight.over) mpLeave();
      return;
    }
    if (!fight || fight.over) {
      prepareWar();
      return;
    }
    if (!fight.run) {
      fight.run = true;
      wLog('Bitwa!');
      startTicker();
      renderWarView();
    }
  };
  const ups: Array<[string, WarPowerKey]> = [
    ['pFire', 'fire'],
    ['pSlow', 'slow'],
    ['pWeak', 'weak'],
  ];
  ups.forEach(([id, k]) => {
    btn(id).onclick = () => {
      const c = wcost(state.war[k]);
      if (state.coins < c || (fight && fight.run && !fight.over)) return;
      state.coins -= c;
      state.war[k] += 1;
      sfx.up();
      requestSave();
      renderWarView();
    };
  });
  btn('wBack').onclick = () => {
    mpClose();
    stopWarTimer();
    fight = null;
    hide('war');
    setWarOpen(false); // hand the canvas back to the board first
    refresh();
    openMenu();
  };
}

// ---- multiplayer (legacy lines 376–441) ----
// The MQTT transport (CDN + wss brokers) lives in src/mp.ts and is only
// instantiated for non-YT builds — Playables' CSP forbids those servers.

interface MpArmy {
  a: Array<{ L: number; am: number; hm: number }>;
  pw: Power;
}

const mp = {
  on: false,
  isHost: false,
  mine: null as MpArmy | null,
  opp: null as MpArmy | null,
  oppName: '',
  started: false,
  iv: null as ReturnType<typeof setInterval> | null,
  seekIv: null as ReturnType<typeof setInterval> | null,
  searching: false,
  room: null as string | null,
};

let net: Net | null = null;

function mpClose(): void {
  if (mp.iv !== null) clearInterval(mp.iv);
  if (mp.seekIv !== null) clearInterval(mp.seekIv);
  mp.searching = false;
  if (net?.connected()) {
    if (mp.room && mp.opp) net.pub(mp.room, { t: 'bye' });
    net.close();
  }
  mp.room = null;
  mp.on = false;
  mp.started = false;
  mp.opp = null;
}

function mpLeave(): void {
  mpClose();
  stopWarTimer();
  fight = null;
  hide('war');
  setWarOpen(false);
  refresh();
  openMenu();
}

async function mpPrep(): Promise<boolean> {
  $('mpLog').textContent = '';
  if (!armyList(state).length) {
    mpMsg('Najpierw zdobądź jakieś kulki!');
    return false;
  }
  if (!net) return false; // no transport (YT builds never reach here)
  mpClose();
  if (!(await net.loadLibrary())) {
    mpMsg('Nie udało się załadować biblioteki sieciowej.');
    return false;
  }
  mp.mine = {
    a: armyList(state).map((L) => ({
      L,
      am: 1 + 0.08 * state.acc.s.pow + perk(state, 'pow', rng) / 100,
      hm: 1 + 0.06 * state.acc.s.hp,
    })),
    pw: {
      fire: state.war.fire + perk(state, 'fire', rng),
      slow: state.war.slow + perk(state, 'slow', rng),
      weak: state.war.weak,
    },
  };
  if (!(await net.connect())) {
    mpMsg('Nie udało się połączyć z żadnym serwerem pośredniczącym. Sprawdź internet albo spróbuj później.');
    return false;
  }
  return true;
}

function mpRoom(code: string, isHost: boolean, maxN: number, onFail?: () => void): void {
  if (!net || !mp.mine) return;
  const n = net;
  const mine = mp.mine;
  const room = 'room/' + code;
  mp.isHost = isHost;
  mp.room = room;
  mp.opp = null;
  mp.started = false;
  const hello = (): void => {
    n.pub(room, {
      t: 'hello',
      host: isHost,
      a: mine.a,
      pw: mine.pw,
      name: `Gracz ⭐${accLvl(state)}`,
    });
  };
  n.sub(room, (d) => {
    if (d.t === 'hello') {
      if (d.host === isHost || mp.started) return;
      mp.opp = { a: d.a!, pw: d.pw! };
      mp.oppName = d.name!;
      mpDbg('Przeciwnik w pokoju: ' + d.name);
      if (isHost) {
        hello();
        const seed = Math.floor(rng() * 1e6);
        mp.started = true;
        const go = (): void => n.pub(room, { t: 'go', seed, to: d.from });
        go();
        setTimeout(go, 700);
        setTimeout(go, 1500);
        mpBegin(seed);
      }
    } else if (d.t === 'go' && !isHost && d.to === n.id && mp.opp && !mp.started) {
      mp.started = true;
      mpBegin(d.seed!);
    } else if (d.t === 'bye' && mp.on && fight && !fight.over) {
      stopWarTimer();
      fight.over = true;
      gainXp(20);
      requestSave();
      wLog('Przeciwnik opuścił grę — wygrywasz walkowerem! (+20 XP)');
      renderWarView();
    }
  });
  hello();
  if (mp.iv !== null) clearInterval(mp.iv);
  let cnt = 0;
  mp.iv = setInterval(() => {
    if (mp.started) {
      if (mp.iv !== null) clearInterval(mp.iv);
      return;
    }
    if (++cnt > maxN) {
      if (mp.iv !== null) clearInterval(mp.iv);
      if (onFail) onFail();
      else mpMsg(isHost ? 'Nikt nie dołączył. Spróbuj ponownie.' : 'Nie ma takiego pojedynku albo przeciwnik już wyszedł. Sprawdź kod.');
      return;
    }
    hello();
  }, 1500);
}

function mpBegin(seed: number): void {
  if (mp.seekIv !== null) clearInterval(mp.seekIv);
  mp.searching = false;
  const A = (mp.isHost ? mp.mine : mp.opp)!;
  const B = (mp.isHost ? mp.opp : mp.mine)!;
  fight = {
    p: A.a.map((b, i) => mk(b.L, b.am, b.hm, (seed * 31 + i * 97) % 500, rng)),
    e: B.a.map((b, i) => mk(b.L, b.am, b.hm, (seed * 31 + i * 97 + 53) % 500, rng)),
    pw: { p: A.pw, e: B.pw },
    pvp: true,
    flip: !mp.isHost,
    eLvl: 1,
    over: false,
    run: true,
  };
  mp.on = true;
  hide('mp');
  show('war');
  setWarOpen(true);
  startTicker();
  renderWarView();
  wLog(`Pojedynek z: ${mp.oppName}`);
}

function mpEnd(f: Fight, pa: boolean, ea: boolean): void {
  stopWarTimer();
  f.over = true;
  const draw = !pa && !ea;
  const win = f.flip ? !pa && ea : pa && !ea;
  if (draw) wLog('Remis!');
  else if (win) {
    const r = Math.round(40 * (1 + accLvl(state) * 0.5));
    state.coins += r;
    gainXp(60);
    sfx.coin();
    wLog(`Wygrywasz pojedynek! +🪙${r}, +60 XP`);
  } else {
    state.coins += 10;
    gainXp(15);
    wLog('Przegrana w pojedynku. +🪙10, +15 XP (kulki bezpieczne)');
  }
  requestSave();
  renderWarView();
}

async function mpHost(): Promise<void> {
  if (!(await mpPrep())) return;
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(rng() * 31)]).join('');
  mpRoom(code, true, 80);
  mpMsg(`Twój kod: ${code} — przekaż go przeciwnikowi i czekaj…`);
}

async function mpJoin(): Promise<void> {
  const code = ($('mpCode') as HTMLInputElement).value.trim().toUpperCase();
  if (!code) {
    mpMsg('Wpisz kod pojedynku.');
    return;
  }
  if (!(await mpPrep())) return;
  mpMsg('Łączenie z pojedynkiem ' + code + '…');
  mpRoom(code, false, 20);
}

async function mpFind(): Promise<void> {
  if (!(await mpPrep())) return;
  const n = net;
  if (!n) return;
  mp.searching = true;
  mpMsg('Szukam przeciwnika…');
  let matched = false;
  const end = Date.now() + 60000;
  mp.seekIv = setInterval(() => {
    if (matched) return;
    if (Date.now() > end) {
      mpMsg('Nie znaleziono przeciwnika. Spróbuj ponownie albo użyj kodu.');
      mpClose();
      return;
    }
    n.pub('lobby', { t: 'seek' });
  }, 2000);
  n.pub('lobby', { t: 'seek' });
  const enter = (room: string, host: boolean): void => {
    matched = true;
    mpMsg('Znaleziono przeciwnika! Łączenie…');
    mpRoom(room, host, host ? 12 : 20, () => {
      if (!mp.searching) return;
      matched = false;
      n.unsubscribe(mp.room ?? '');
      mp.room = null;
      mpMsg('Szukam przeciwnika…');
    });
  };
  n.sub('lobby', (d) => {
    if (matched || !mp.searching) return;
    if (d.t === 'seek' && n.id < (d.from ?? '')) {
      const room = Math.random().toString(36).slice(2, 8);
      n.pub('lobby', { t: 'match', to: d.from, room });
      enter(room, true);
    } else if (d.t === 'match' && d.to === n.id) {
      enter(d.room ?? '', false);
    }
  });
}

function bindMp(): void {
  btn('mpBtn').onclick = () => {
    warmAudio();
    sfx.click();
    $('mpLog').textContent = '';
    hide('menu');
    show('mp');
    mpMsg('');
    const army = armyList(state);
    btn('mpInfo').textContent = army.length
      ? `Do walki idzie twoich ${army.length} najsilniejszych kulek (maks. 5). Przegrana nie odbiera kulek.`
      : 'Nie masz jeszcze kulek. Połącz je w kopalni.';
  };
  btn('mpFind').onclick = () => void mpFind();
  btn('mpHost').onclick = () => void mpHost();
  btn('mpJoin').onclick = () => void mpJoin();
  btn('mpBack').onclick = () => {
    mpClose();
    hide('mp');
    openMenu();
  };
}

// ---- platform pause/resume (legacy lines 459–470) ----
// The war-timer halves arrive with the war screen slice (legacy: wTimer).

function pauseGame(): void {
  if (paused) return;
  paused = true;
  warWasRunning = !!(fight && fight.run && !fight.over);
  stopWarTimer();
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
  if (warWasRunning && fight && !fight.over && !wTimer) wTimer = setInterval(tickOnce, 100);
  warWasRunning = false;
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
  bindStats();
  bindCrate();
  bindShop();
  bindWar();
  // Compile-time platform gate: no MQTT transport, no mp handlers on YT
  // (legacy hid mpBtn behind IN_PLAY — PLAN wants it tree-shaken instead).
  if (__PLATFORM__ !== 'yt') {
    net = createNet(mpDbg);
    bindMp();
  }

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

  if (__PLATFORM__ === 'yt') {
    // Legacy IN_PLAY: the platform owns audio; no external connections (CSP).
    btn('snd').style.display = 'none';
    btn('mpBtn').style.display = 'none';
  }
}

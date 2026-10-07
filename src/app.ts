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
import { crateRoll, CRATES, itVal, ownedMax, perk, RAR, rollPerks, rollRar, rollTheme, rnd5, type CrateDef } from './core/cosmetics';
import {
  accLvl,
  addXp,
  disCost,
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
import { applyStatic, getLocale, numF, onLocaleChange, resolveLanguage, setLocale, t, type TParams } from './i18n';
import type { Platform } from './platform/types';
import { flyBall, renderMine, type Handlers, type Ui } from './ui/board';
import { $, btn, luckMsg, msg, render, setGone, updSnd } from './ui/hud';
import { setWarOpen, warLog } from './ui/war-canvas';
import {
  cellHtml,
  CW,
  hide,
  nameOf,
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
      msg(t('levelup.title', { l: up.level }) + (up.crates ? t('levelup.crate') : ''));
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
    msg(t('msg.merged', { n: state.grid[i] }));
  } else {
    sel = i;
  }
  refresh();
}

function take(L: number): void {
  if (busy) return;
  const e = state.grid.indexOf(0);
  if (e < 0) {
    msg(t('msg.boardFull'));
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
    msg(t('msg.spawnLevel', { l: state.spawnLvl, p: spawnPrice(state) }));
    refresh();
  };
  btn('inc').onclick = () => {
    if (state.coins < state.incCost) return;
    state.coins -= state.incCost;
    sfx.up();
    state.incLvl += 1;
    state.incCost = Math.round(state.incCost * 2.2);
    msg(t('msg.income', { m: incMul(state, rng).toFixed(1) }));
    refresh();
  };
  btn('ren').onclick = () => {
    if (state.coins < state.renCost || renChance(state) >= 1) return;
    state.coins -= state.renCost;
    sfx.up();
    state.renLvl += 1;
    state.renCost = Math.round(state.renCost * 2.1);
    msg(t('msg.renew', { p: Math.round(renChance(state) * 100) }));
    refresh();
  };
  btn('pas').onclick = () => {
    const c = pasCost(state);
    if (busy || state.coins < c) return;
    state.coins -= c;
    state.econ.pas += 1;
    sfx.up();
    msg(t('msg.passive', { n: state.econ.pas }));
    refresh();
  };
  btn('dis').onclick = () => {
    const c = disCost(state);
    if (busy || state.econ.dis >= 6 || state.coins < c) return;
    state.coins -= c;
    state.econ.dis += 1;
    sfx.up();
    msg(t('msg.discount', { p: spawnPrice(state) }));
    refresh();
  };
  btn('blast').onclick = () => {
    if (state.coins < state.blastCost) return;
    state.coins -= state.blastCost;
    sfx.up();
    state.blastLvl += 1;
    state.blastCost = Math.round(state.blastCost * 2.3);
    msg(t('msg.blast'));
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
    msg(t('msg.bomb', { e }));
    refresh();
  };
  btn('sell').onclick = () => {
    if (sel === null || !state.grid[sel] || busy) return;
    const p = sellPrice(state.grid[sel]);
    state.coins += p;
    sfx.coin();
    state.grid[sel] = 0;
    sel = null;
    msg(t('msg.sold', { p }));
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
    msg(t('hud.dropResult', { coins: earned, back: back.length, inv: nInv }));
    if (state.coins < spawnPrice(state) && state.grid.every((x) => !x)) {
      state.coins = spawnPrice(state);
      msg(t('msg.refill'));
    }
    refresh();
  };
}

// ---- passive income (legacy lines 123–127) ----

function passiveTick(): void {
  if (paused || state.econ.pas < 1) return;
  state.coins += Math.round(state.econ.pas * (1 + 0.05 * (accLvl(state) - 1)));
  $('coins').textContent = numF(state.coins);
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

/** Menu button labels (also re-run on locale switches). */
function updateMenuLabels(): void {
  btn('statsBtn').textContent =
    t('stats.title') + (pts(state) > 0 ? t('menu.statsPoints', { n: pts(state) }) : '');
  btn('play').textContent = hasProgress() ? t('menu.continue') : t('menu.play');
}

function openMenu(): void {
  updateMenuLabels();
  $('menu').classList.remove('hide');
  btn('play').focus();
}

function armWipe(on: boolean): void {
  if (wipeT !== null) clearTimeout(wipeT);
  btn('wipe').textContent = on ? t('menu.resetConfirm') : t('menu.reset');
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
    msg(t('msg.wiped'));
    refresh();
    btn('play').textContent = t('menu.play');
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
    $('cRes').textContent = t('common.rolling');
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
        where = t('crate.whereBoard');
      } else {
        state.inv[win] = (state.inv[win] || 0) + 1;
        where = t('crate.whereInv');
      }
      $('cRes').textContent = t('crate.result', { l: win, p: numF(pw(win)), where });
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
  $('sTitle').textContent = '📦 ' + t(`crate.name.${CRATES.indexOf(crate)}`);
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
    $('sRes').textContent = t('common.rolling');
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
      $('sRes').innerHTML = `<span style="color:${RAR[rar].c}">${nameOf(it)}</span><br><span style="font-size:12px">${perkHtml(it, rng)}</span><br>${t('spin.added', { v: numF(itVal(it, rng)) })}`;
      requestSave(); // legacy save()
      renderSpinView();
    }, 4400);
  };
}

// ---- war screen (legacy lines 211–259) ----

let fight: Fight | null = null;
let wTimer: ReturnType<typeof setInterval> | null = null;
let warWasRunning = false;

// The war log renders on the canvas; keep the current key+params so a
// locale switch can re-render the line (Phase 4: canvas draws t() at
// render time). Core still returns its own Polish message — unused here
// (view-side composition, core/war.ts untouched).
let logKey: string | null = null;
let logParams: TParams | undefined;

function wLogKey(key: string, params?: TParams): void {
  logKey = key;
  logParams = params;
  warLog(t(key, params));
}

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
  if (win) wLogKey('war.win', { coins: r.coins, xp: r.xp });
  else if (r.lostLvl !== undefined) wLogKey('war.loseBall', { L: r.lostLvl });
  else wLogKey('war.loseSafe');
  requestSave(); // legacy save()
  renderWarView();
}

function prepareWar(): void {
  stopWarTimer(); // legacy prepare(): clearInterval(wTimer)
  const p = prepareFight(state, rng);
  fight = p.fight;
  if (p.fight) {
    wLogKey('war.prepare', { eL: p.fight.eLvl, n: p.fight.e.length, pN: p.fight.p.length });
  } else {
    wLogKey('war.prepare.empty');
  }
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
      wLogKey('war.bitwa');
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
    mpMsg(t('mp.needBalls'));
    return false;
  }
  if (!net) return false; // no transport (YT builds never reach here)
  mpClose();
  if (!(await net.loadLibrary())) {
    mpMsg(t('mp.libFail'));
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
    mpMsg(t('mp.connectFail'));
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
      mpDbg(t('mp.opponentJoined', { name: d.name }));
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
      wLogKey('war.forfeit');
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
      else mpMsg(isHost ? t('mp.hostIdle') : t('mp.noRoom'));
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
  wLogKey('war.duelOpp', { name: mp.oppName });
}

function mpEnd(f: Fight, pa: boolean, ea: boolean): void {
  stopWarTimer();
  f.over = true;
  const draw = !pa && !ea;
  const win = f.flip ? !pa && ea : pa && !ea;
  if (draw) wLogKey('war.draw');
  else if (win) {
    const r = Math.round(40 * (1 + accLvl(state) * 0.5));
    state.coins += r;
    gainXp(60);
    sfx.coin();
    wLogKey('war.duelWin', { r });
  } else {
    state.coins += 10;
    gainXp(15);
    wLogKey('war.duelLoss');
  }
  requestSave();
  renderWarView();
}

async function mpHost(): Promise<void> {
  if (!(await mpPrep())) return;
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(rng() * 31)]).join('');
  mpRoom(code, true, 80);
  mpMsg(t('mp.yourCode', { code }));
}

async function mpJoin(): Promise<void> {
  const code = ($('mpCode') as HTMLInputElement).value.trim().toUpperCase();
  if (!code) {
    mpMsg(t('mp.enterCode'));
    return;
  }
  if (!(await mpPrep())) return;
  mpMsg(t('mp.connecting', { code }));
  mpRoom(code, false, 20);
}

async function mpFind(): Promise<void> {
  if (!(await mpPrep())) return;
  const n = net;
  if (!n) return;
  mp.searching = true;
  mpMsg(t('mp.seeking'));
  let matched = false;
  const end = Date.now() + 60000;
  mp.seekIv = setInterval(() => {
    if (matched) return;
    if (Date.now() > end) {
      mpMsg(t('mp.noOpponent'));
      mpClose();
      return;
    }
    n.pub('lobby', { t: 'seek' });
  }, 2000);
  n.pub('lobby', { t: 'seek' });
  const enter = (room: string, host: boolean): void => {
    matched = true;
    mpMsg(t('mp.found'));
    mpRoom(room, host, host ? 12 : 20, () => {
      if (!mp.searching) return;
      matched = false;
      n.unsubscribe(mp.room ?? '');
      mp.room = null;
      mpMsg(t('mp.seeking'));
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

/** The multiplayer intro line (open + locale switches). */
function updateMpInfo(): void {
  const army = armyList(state);
  btn('mpInfo').textContent = army.length
    ? t('mp.infoArmy', { n: army.length })
    : t('mp.infoEmpty');
}

function bindMp(): void {
  btn('mpBtn').onclick = () => {
    warmAudio();
    sfx.click();
    $('mpLog').textContent = '';
    hide('menu');
    show('mp');
    mpMsg('');
    updateMpInfo();
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

// ---- locale switch (Phase 4: setLocale re-renders DOM + canvas) ----

/** One full re-render in the active locale — registered as the setLocale listener. */
function applyLocale(): void {
  document.documentElement.lang = getLocale();
  document.title = t('app.title');
  applyStatic(); // static index.html markup (data-i18n / -aria / -ph)
  updSnd(isMuted());
  armWipe(false); // re-translate the reset button (and disarm — safest)
  updateMenuLabels();
  refresh(); // HUD + board: render()/MineScene draw t()/numF() at call time
  // Dynamic chrome of whichever screen is open follows the switch:
  if (!$('war').classList.contains('hide')) {
    renderWarView();
    if (logKey !== null) warLog(t(logKey, logParams)); // canvas log, same line
  }
  if (!$('stats').classList.contains('hide')) renderStatsView();
  if (!$('crateov').classList.contains('hide')) renderCrate(state, spinning);
  if (!$('shop').classList.contains('hide')) renderShopView();
  if (!$('sinv').classList.contains('hide')) renderSInvView();
  if (!$('sspin').classList.contains('hide')) {
    if (curCrate) $('sTitle').textContent = '📦 ' + t(`crate.name.${CRATES.indexOf(curCrate)}`);
    renderSpinView();
  }
  if (!$('scont').classList.contains('hide')) renderContBody();
  if (!$('mp').classList.contains('hide')) updateMpInfo();
}

// ---- boot sequence (legacy boot(): updSnd → render → openMenu → sendBest) ----

export function startApp(p: Platform): void {
  platform = p;
  setAudioGate(() => platform.isAudioEnabled()); // PLAN DoD: sfx follows the platform

  // Phase 4 i18n: locale from the platform (mock defaults to pl locally);
  // the listener fires once now (one boot render) and on every setLocale.
  onLocaleChange(applyLocale);
  setLocale(resolveLanguage(p.getLanguage()));

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

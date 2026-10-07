// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPlatform } from '../../src/platform/mock.ts';
import type { Platform } from '../../src/platform/types.ts';

// Part 1 contract tests: the mock platform must satisfy the Platform interface
// and behave predictably enough to act as the local "SDK" (PLAN.md §1.2, §1.5).

beforeEach(() => {
  localStorage.clear();
});

describe('mock platform', () => {
  it('is a valid Platform implementation', () => {
    const p: Platform = createMockPlatform();
    expect(p.id).toBe('local');
    expect(p.features).toEqual({ ads: true, multiplayer: true, cloudSave: false });
  });

  it('reports init progress 0 → 100 and resolves', async () => {
    const p = createMockPlatform();
    const seen: number[] = [];
    await p.init((pct) => seen.push(pct));
    expect(seen).toEqual([0, 100]);
    expect(p.progress).toEqual([0, 100]);
  });

  it('records first-frame and ready marks', () => {
    const p = createMockPlatform();
    expect(p.firstFrame).toBe(false);
    expect(p.ready).toBe(false);
    p.markFirstFrame();
    p.markReady();
    expect(p.firstFrame).toBe(true);
    expect(p.ready).toBe(true);
  });

  it('round-trips a save through localStorage', async () => {
    const p = createMockPlatform();
    expect(await p.loadSave()).toBeNull();
    await p.saveSave('{"coins":42}');
    expect(await p.loadSave()).toBe('{"coins":42}');
    expect(localStorage.getItem('mine-merge-save-v1')).toBe('{"coins":42}');
  });

  it('returns initialSave only once, then prefers stored saves', async () => {
    const p = createMockPlatform({ initialSave: 'cloud-save' });
    expect(await p.loadSave()).toBe('cloud-save');
    expect(await p.loadSave()).toBeNull();
    await p.saveSave('local-save');
    expect(await p.loadSave()).toBe('local-save');
  });

  it('notifies audio listeners only on actual changes', () => {
    const p = createMockPlatform();
    const seen: boolean[] = [];
    p.onAudioChange((on) => seen.push(on));
    expect(p.isAudioEnabled()).toBe(true);
    p.setAudioEnabled(true);
    expect(seen).toEqual([]);
    p.setAudioEnabled(false);
    p.setAudioEnabled(true);
    expect(seen).toEqual([false, true]);
    expect(p.isAudioEnabled()).toBe(true);
  });

  it('honors an explicit initial audio state (YT can boot muted)', () => {
    const p = createMockPlatform({ audioEnabled: false });
    expect(p.isAudioEnabled()).toBe(false);
  });

  it('fires pause/resume callbacks and tracks the paused flag', () => {
    const p = createMockPlatform();
    let pauses = 0;
    let resumes = 0;
    p.onPause(() => pauses++);
    p.onResume(() => resumes++);
    p.emitPause();
    expect(p.paused).toBe(true);
    p.emitResume();
    expect(p.paused).toBe(false);
    expect([pauses, resumes]).toEqual([1, 1]);
  });

  it('records scores and warnings', () => {
    const p = createMockPlatform();
    p.sendScore(12);
    p.sendScore(30);
    p.logWarning('test');
    expect(p.scores).toEqual([12, 30]);
    expect(p.warnings).toEqual(['test']);
  });

  it('resolves ads: interstitial counts, rewarded records the reward id', async () => {
    const p = createMockPlatform();
    await expect(p.requestInterstitial()).resolves.toBeUndefined();
    await expect(p.requestInterstitial()).resolves.toBeUndefined();
    await expect(p.requestRewarded('crate-free-1')).resolves.toBe(true);
    expect(p.interstitials).toBe(2);
    expect(p.rewards).toEqual(['crate-free-1']);
  });

  it('resolves an explicit language, else derives from navigator', () => {
    expect(createMockPlatform({ language: 'pl' }).getLanguage()).toBe('pl');
    // jsdom reports en-US by default
    expect(createMockPlatform().getLanguage()).toBe('en');
  });
});

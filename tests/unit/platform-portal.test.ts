// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPortalPlatform } from '../../src/platform/portal.ts';
import { isDebugPlatform } from '../../src/platform/debug-hud.ts';

// The portal build (PLATFORM=portal → dist/web) must report the portal
// identity while the real SDK is still a stub (PLAN.md §1.1 portal.ts).

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe('portal platform (stub)', () => {
  it('identifies as portal with conservative feature flags', () => {
    const p = createPortalPlatform();
    expect(p.id).toBe('portal');
    expect(p.features).toEqual({ ads: false, multiplayer: true, cloudSave: false });
  });

  it('persists saves through storage (mock underneath)', async () => {
    const p = createPortalPlatform({ storage: memoryStorage() });
    expect(await p.loadSave()).toBeNull();
    await p.saveSave('{"x":1}');
    expect(await p.loadSave()).toBe('{"x":1}');
  });

  it('delegates init progress to the mock underneath', async () => {
    const p = createPortalPlatform();
    const seen: number[] = [];
    await p.init((pct) => seen.push(pct));
    p.markFirstFrame();
    p.markReady();
    expect(seen).toEqual([0, 100]);
  });

  it('honors mock options for language and audio', () => {
    const p = createPortalPlatform({ language: 'pl', audioEnabled: false });
    expect(p.getLanguage()).toBe('pl');
    expect(p.isAudioEnabled()).toBe(false);
  });

  it('never exposes the local debug-HUD hooks', () => {
    expect(isDebugPlatform(createPortalPlatform())).toBe(false);
  });
});

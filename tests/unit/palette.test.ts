import { describe, expect, it } from 'vitest';
import { blockColor, color, PAT, TC, tier } from '../../src/ui/palette';

// Phase 3.1 pins the palette the Phaser texture generator reads (verbatim
// legacy color/TC/PAT/tier/blockColor) so a refactor can't silently re-tint
// the board — the side-by-side check vs legacy-vanilla depends on these.

describe('palette', () => {
  it('color(L): hsl ramp, hue = (L*47+200) mod 360, 65% / 52%', () => {
    expect(color(1)).toBe('hsl(247 65% 52%)');
    expect(color(3)).toBe('hsl(341 65% 52%)');
    expect(color(8)).toBe('hsl(216 65% 52%)'); // wraps past 360
  });

  it('TC: 10 tier colors, PAT: 5 pattern layers', () => {
    expect(TC).toHaveLength(10);
    expect(PAT).toHaveLength(5);
    expect(TC[0]).toBe('#d64545');
  });

  it('tier(hp): floor(log2)+1 with the legacy 0 → 2 jump and cap 9', () => {
    expect(tier(1)).toBe(0);
    expect(tier(0)).toBe(0);
    expect(tier(2)).toBe(2); // legacy quirk: no tier 1
    expect(tier(3)).toBe(2);
    expect(tier(4)).toBe(3);
    expect(tier(512)).toBe(9);
    expect(tier(1e9)).toBe(9); // capped
  });

  it('blockColor: tier color while alive, null once destroyed', () => {
    expect(blockColor({ hp: 2 })).toBe(TC[2]);
    expect(blockColor({ hp: 0 })).toBeNull();
    expect(blockColor({ hp: -3 })).toBeNull();
  });
});

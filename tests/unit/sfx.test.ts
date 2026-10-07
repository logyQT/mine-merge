// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Phase 2: audio/sfx ported from legacy/app.js — gating (muted / platform
// flag / suspended context) and exact tone/noise parameters are pinned with
// a recording fake AudioContext.

class FakeParam {
  value = 0;
  events: Array<{ v: number; t: number }> = [];
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.events.push({ v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.events.push({ v, t });
  }
}

class FakeOsc {
  type = 'sine';
  frequency = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  connect(target: unknown): unknown {
    return target;
  }
  start(t: number): void {
    this.started = t;
  }
  stop(t: number): void {
    this.stopped = t;
  }
}

class FakeGain {
  gain = new FakeParam();
  connect(target: unknown): unknown {
    return target;
  }
}

class FakeFilter {
  type = '';
  frequency = new FakeParam();
  connect(target: unknown): unknown {
    return target;
  }
}

class FakeBufferSource {
  buffer: { getChannelData(i: number): Float32Array } | null = null;
  started = false;
  connect(target: unknown): unknown {
    return target;
  }
  start(): void {
    this.started = true;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static nextState: 'running' | 'suspended' = 'running';

  state: string;
  currentTime = 1.5;
  sampleRate = 48000;
  destination = {};
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  buffers: Float32Array[] = [];
  bufferSources: FakeBufferSource[] = [];
  resumed = 0;

  constructor() {
    this.state = FakeAudioContext.nextState;
    FakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o;
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createBuffer(_ch: number, n: number, _sr: number): { getChannelData(i: number): Float32Array } {
    const data = new Float32Array(n);
    this.buffers.push(data);
    return { getChannelData: () => data };
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.bufferSources.push(s);
    return s;
  }
}

type SfxModule = typeof import('../../src/audio/sfx');

async function loadSfx(opts: { muted?: boolean; nextState?: 'running' | 'suspended' } = {}): Promise<SfxModule> {
  vi.resetModules(); // fresh module state (muted, cached AudioContext, gate)
  localStorage.clear();
  if (opts.muted) localStorage.setItem('kopalnia-mute', '1');
  FakeAudioContext.instances = [];
  FakeAudioContext.nextState = opts.nextState ?? 'running';
  (window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  return import('../../src/audio/sfx');
}

const ctx0 = (): FakeAudioContext => {
  expect(FakeAudioContext.instances.length).toBeGreaterThan(0);
  return FakeAudioContext.instances[0];
};

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).AudioContext;
});

describe('gating', () => {
  it('plays by default: click makes one square-wave tone at 500 Hz', async () => {
    const { sfx } = await loadSfx();
    sfx.click();
    const c = ctx0();
    expect(c.oscs).toHaveLength(1);
    const o = c.oscs[0];
    expect(o.type).toBe('square');
    expect(o.frequency.events).toEqual([{ v: 500, t: 1.5 }]);
    expect(o.started).toBeCloseTo(1.5, 10);
    expect(o.stopped).toBeCloseTo(1.56, 10); // 1.5 + 0.06
    expect(c.gains[0].gain.events[0]).toEqual({ v: 0.05, t: 1.5 });
    expect(c.gains[0].gain.events[1].v).toBeCloseTo(0.001, 10);
    expect(c.gains[0].gain.events[1].t).toBeCloseTo(1.56, 10);
  });

  it('muted (persisted under the legacy kopalnia-mute key) silences everything', async () => {
    const mod = await loadSfx({ muted: true });
    mod.sfx.click();
    mod.sfx.boom();
    mod.sfx.brk();
    expect(FakeAudioContext.instances).toHaveLength(0); // never even created

    mod.setMuted(false);
    expect(localStorage.getItem('kopalnia-mute')).toBe('0');
    mod.sfx.click();
    expect(ctx0().oscs).toHaveLength(1);

    mod.setMuted(true);
    expect(localStorage.getItem('kopalnia-mute')).toBe('1');
    // A fresh module boot picks the stored choice back up (legacy behavior).
    const reloaded = await loadSfx({ muted: true });
    expect(reloaded.isMuted()).toBe(true);
  });

  it('the platform audio gate silences SFX (PLAN: platform.isAudioEnabled)', async () => {
    const mod = await loadSfx();
    mod.setAudioGate(() => false);
    mod.sfx.click();
    mod.sfx.coin();
    expect(FakeAudioContext.instances).toHaveLength(0);
    mod.setAudioGate(() => true);
    mod.sfx.click();
    expect(ctx0().oscs).toHaveLength(1);
  });

  it('warmAudio resumes a suspended context (user-gesture unlock)', async () => {
    const mod = await loadSfx({ nextState: 'suspended' });
    mod.warmAudio();
    const c = ctx0();
    expect(c.resumed).toBe(1);
    expect(c.state).toBe('running');
  });
});

describe('tone parameters', () => {
  it('spawn ramps the frequency 400 → 800 over 100 ms', async () => {
    const { sfx } = await loadSfx();
    sfx.spawn();
    const o = ctx0().oscs[0];
    expect(o.type).toBe('triangle');
    expect(o.frequency.events).toHaveLength(2);
    expect(o.frequency.events[0]).toEqual({ v: 400, t: 1.5 });
    expect(o.frequency.events[1].v).toBe(800);
    expect(o.frequency.events[1].t).toBeCloseTo(1.6, 10);
  });

  it('up plays the three-note arpeggio with 80 ms delays', async () => {
    const { sfx } = await loadSfx();
    sfx.up();
    const oscs = ctx0().oscs;
    expect(oscs.map((o) => o.frequency.events[0].v)).toEqual([523, 659, 784]);
    expect(oscs[0].started).toBeCloseTo(1.5, 10);
    expect(oscs[1].started).toBeCloseTo(1.58, 10);
    expect(oscs[2].started).toBeCloseTo(1.66, 10);
  });

  it('merge scales with the ball level and caps at level 12', async () => {
    const { sfx } = await loadSfx();
    sfx.merge(3);
    const oscs = ctx0().oscs;
    expect(oscs[0].frequency.events[0].v).toBeCloseTo(330 * Math.pow(1.12, 3), 10);
    expect(oscs[1].frequency.events[0].v).toBeCloseTo(330 * Math.pow(1.12, 3) * 1.5, 10);
    expect(oscs[1].started).toBeCloseTo(1.58, 10);

    const { sfx: fresh } = await loadSfx();
    fresh.merge(15);
    expect(ctx0().oscs[0].frequency.events[0].v).toBeCloseTo(330 * Math.pow(1.12, 12), 10);
  });

  it('hit pitch stays in the legacy 160–220 Hz band', async () => {
    const { sfx } = await loadSfx();
    for (let i = 0; i < 100; i++) sfx.hit();
    const freqs = ctx0().oscs.map((o) => o.frequency.events[0].v);
    expect(freqs).toHaveLength(100);
    expect(Math.min(...freqs)).toBeGreaterThanOrEqual(160);
    expect(Math.max(...freqs)).toBeLessThan(220);
  });
});

describe('noise', () => {
  it('sizes the buffer from the duration, low-passes at 700, fills decaying noise', async () => {
    const { sfx } = await loadSfx();
    sfx.brk();
    const c = ctx0();
    expect(c.buffers).toHaveLength(1);
    expect(c.buffers[0]).toHaveLength(Math.floor(48000 * 0.12)); // 5760
    expect(c.filters[0].type).toBe('lowpass');
    expect(c.filters[0].frequency.value).toBe(700);
    expect(c.gains[0].gain.value).toBe(0.2);
    expect(c.bufferSources[0].started).toBe(true);
    const data = c.buffers[0];
    expect(Math.abs(data[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(data[data.length - 1])).toBeLessThan(0.01); // decayed to ~0
    expect(c.oscs).toHaveLength(1); // brk also plays the tone half
    expect(c.oscs[0].type).toBe('sawtooth');
  });
});

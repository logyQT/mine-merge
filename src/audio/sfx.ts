// WebAudio SFX (PLAN.md Phase 2 audio/sfx.ts), ported verbatim from
// legacy/app.js lines 104–118.
//
// Gating (PLAN DoD): sound only plays when the local mute is off AND the
// platform reports audio enabled — main.ts wires
// setAudioGate(() => platform.isAudioEnabled()) at boot. Legacy's `ytAudio`
// flag is that platform gate; the legacy `kopalnia-mute` localStorage key is
// kept so a local player's mute choice carries over.

type AudioCtor = typeof AudioContext;

let AC: AudioContext | null = null;
let muted = false;
let audioGate: () => boolean = () => true; // legacy default: ytAudio = true

try {
  muted = localStorage.getItem('kopalnia-mute') === '1';
} catch {
  // storage unavailable — stay unmuted
}

/** Wires the platform audio flag (platform.isAudioEnabled) into the SFX. */
export function setAudioGate(gate: () => boolean): void {
  audioGate = gate;
}

export const isMuted = (): boolean => muted;

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem('kopalnia-mute', v ? '1' : '0');
  } catch {
    // storage unavailable — mute still applies for this session
  }
}

const canPlay = (): boolean => !muted && audioGate();

/** Lazily creates the AudioContext and resumes it after a user gesture. */
function ctx(): AudioContext | null {
  if (!AC) {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (Ctor) {
      try {
        AC = new Ctor();
      } catch {
        // no WebAudio — every sound stays a no-op (legacy behavior)
      }
    }
  }
  if (AC && AC.state === 'suspended') void AC.resume();
  return AC;
}

/** Pre-creates/resumes the context on the first user gesture (legacy ctx()). */
export function warmAudio(): void {
  ctx();
}

export function tone(
  f: number,
  d: number,
  type: OscillatorType = 'sine',
  v = 0.15,
  to: number | null = null,
  delay = 0,
): void {
  if (!canPlay()) return;
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + d);
}

export function noise(d: number, v = 0.25): void {
  if (!canPlay()) return;
  const a = ctx();
  if (!a) return;
  const n = Math.floor(a.sampleRate * d);
  const b = a.createBuffer(1, n, a.sampleRate);
  const x = b.getChannelData(0);
  for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 700;
  g.gain.value = v;
  s.buffer = b;
  s.connect(f);
  f.connect(g);
  g.connect(a.destination);
  s.start();
}

export interface Sfx {
  click(): void;
  spawn(): void;
  merge(level: number): void;
  hit(): void;
  brk(): void;
  boom(): void;
  coin(): void;
  up(): void;
}

/** The game's sound set — parameters verbatim from legacy app.js. */
export const sfx: Sfx = {
  click: () => tone(500, 0.06, 'square', 0.05),
  spawn: () => tone(400, 0.1, 'triangle', 0.15, 800),
  merge: (l) => {
    const f = 330 * Math.pow(1.12, Math.min(l, 12));
    tone(f, 0.12, 'triangle', 0.2);
    tone(f * 1.5, 0.2, 'triangle', 0.18, null, 0.08);
  },
  hit: () => tone(160 + Math.random() * 60, 0.08, 'square', 0.08, 70),
  brk: () => {
    noise(0.12, 0.2);
    tone(220, 0.1, 'sawtooth', 0.06, 80);
  },
  boom: () => {
    noise(0.5, 0.5);
    tone(120, 0.4, 'sawtooth', 0.2, 30);
  },
  coin: () => {
    tone(880, 0.08, 'square', 0.08);
    tone(1320, 0.15, 'square', 0.08, null, 0.08);
  },
  up: () => [523, 659, 784].forEach((f, i) => tone(f, 0.12, 'triangle', 0.18, null, i * 0.08)),
};

import { describe, expect, it } from 'vitest';
import config from '../../vite.config.ts';

// Playables technical requirements: paths in the game bundle MUST be
// relative — a base of '/' (Vite's default) only works when the ZIP is
// hosted at the domain root. Pin the constraint so a future vite.config
// edit fails here instead of surfacing at upload time.
describe('vite config', () => {
  it('emits relative asset paths (base: "./")', () => {
    expect(config.base).toBe('./');
  });
});

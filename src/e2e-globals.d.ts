// Local-only e2e handles exposed by src/main.ts on globalThis so the
// Playwright suite (tests/e2e) can drive the mock platform's simulation hooks
// and observe the game loop. Both stay undefined outside PLATFORM=local
// builds — main.ts guards every assignment with __PLATFORM__ === 'local'
// (verified by grepping dist/yt after each build).

import type { MockPlatform } from './platform/mock';

declare global {
  var __platform: MockPlatform | undefined;
  var __game: { loop: { time: number }; sound: { mute: boolean } } | undefined;
}

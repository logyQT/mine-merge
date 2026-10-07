// Vite config for the kit (PLAN.md §1.3):
//  1. PLATFORM=yt → inject the YouTube SDK <script> into <head>, before game code.
//  2. PLATFORM=yt → serve YouTube's strict CSP in dev/preview so violations
//     appear in DevTools locally (sandbox directive omitted for dev tooling).
//  3. define __PLATFORM__ / import.meta.env.PLATFORM so `if (__PLATFORM__ !== 'yt')`
//     tree-shakes platform-specific code (e.g. MQTT multiplayer) out of YT builds.

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

export type BuildPlatform = 'yt' | 'portal' | 'local';

const raw = process.env.PLATFORM ?? 'local';
if (!['yt', 'portal', 'local'].includes(raw)) {
  throw new Error(`Unknown PLATFORM "${raw}" (expected yt | portal | local)`);
}
const PLATFORM = raw as BuildPlatform;

const YT_SDK = 'https://www.youtube.com/game_api/v1';

const YT_CSP = [
  "default-src 'self'",
  `script-src 'self' ${YT_SDK} blob: 'unsafe-eval' 'unsafe-inline'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  'worker-src blob:',
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function injectYtSdk(): Plugin {
  return {
    name: 'inject-yt-sdk',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { src: YT_SDK },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

const headers = PLATFORM === 'yt' ? { 'Content-Security-Policy': YT_CSP } : {};

export default defineConfig({
  // Certification requires relative paths only (Playables technical
  // requirements) — the uploaded ZIP may not be served from the domain root.
  base: './',
  define: {
    __PLATFORM__: JSON.stringify(PLATFORM),
    'import.meta.env.PLATFORM': JSON.stringify(PLATFORM),
  },
  plugins: PLATFORM === 'yt' ? [injectYtSdk()] : [],
  server: { headers },
  preview: { headers },
  test: {
    // Unit tests live in tests/unit; tests/e2e is driven by Playwright
    // (npm run test:e2e), so vitest must not pick those specs up. The
    // extension list (not `*`) also keeps snapshot files — whose names embed
    // `*.test.ts.snap` — out of the suite collection.
    include: ['tests/unit/**/*.test.{ts,js}'],
  },
});

// Picks the platform implementation from the build-time __PLATFORM__ define
// (vite.config.ts). Unknown/future platforms fall back to the local mock so a
// build never ends up without a platform (PLAN.md §1.2).

import type { Platform } from './types';
import { createMockPlatform } from './mock';
import { createYtPlatform } from './yt';

export function createPlatform(): Platform {
  switch (__PLATFORM__) {
    case 'yt':
      return createYtPlatform();
    // TODO: 'fb' → createFbPlatform(), 'portal' → createPortalPlatform().
    case 'fb':
    case 'portal':
    case 'local':
    default:
      return createMockPlatform();
  }
}

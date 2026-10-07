// Picks the platform implementation from the build-time __PLATFORM__ define
// (vite.config.ts). Unknown/future platforms fall back to the local mock so a
// build never ends up without a platform (PLAN.md §1.2).

import type { Platform } from './types';
import { createMockPlatform } from './mock';
import { createPortalPlatform } from './portal';
import { createYtPlatform } from './yt';

export function createPlatform(): Platform {
  switch (__PLATFORM__) {
    case 'yt':
      return createYtPlatform();
    case 'portal':
      return createPortalPlatform();
    // TODO(PLAN Part 2): 'fb' → createFbPlatform() once fb.ts lands.
    case 'fb':
    case 'local':
    default:
      return createMockPlatform();
  }
}

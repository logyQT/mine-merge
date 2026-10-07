/// <reference types="vite/client" />

// Build-time platform, injected by vite.config.ts (`define`).
declare const __PLATFORM__: 'yt' | 'fb' | 'portal' | 'local';

interface ImportMetaEnv {
  readonly PLATFORM: 'yt' | 'fb' | 'portal' | 'local';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

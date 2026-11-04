/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "on" shows the unfinished robot mascot. Releases leave it unset. */
  readonly VITE_MASCOT_ROBOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

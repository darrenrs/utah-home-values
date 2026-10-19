/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FASTAPI_BASE_PATH?: string;
  readonly VITE_BASE_PATH?: string;
}

// Full hash of the commit the site was built from, or "" when unknown.
declare const __BUILD_COMMIT__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

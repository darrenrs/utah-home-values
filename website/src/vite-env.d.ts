/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FASTAPI_BASE_PATH?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

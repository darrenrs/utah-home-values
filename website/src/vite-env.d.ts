/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FASTAPI_SERVER_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Development builds fall back to a local API. Production builds without
// VITE_FASTAPI_BASE_PATH have no custom-area API, so visitors' browsers never
// probe localhost.
const FASTAPI_SERVER_BASE =
  import.meta.env.VITE_FASTAPI_BASE_PATH ||
  (import.meta.env.DEV ? "http://127.0.0.1:8000/api" : "");

export const isApiConfigured = FASTAPI_SERVER_BASE !== "";

export function withApiBaseUrl(path: string): string {
  const baseUrl = FASTAPI_SERVER_BASE.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return `${baseUrl}/${normalizedPath}`;
}

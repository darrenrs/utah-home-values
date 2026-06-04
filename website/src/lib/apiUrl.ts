const FASTAPI_SERVER_BASE =
  import.meta.env.VITE_FASTAPI_BASE_PATH || "http://127.0.0.1:8000/api";

export function withApiBaseUrl(path: string): string {
  const baseUrl = FASTAPI_SERVER_BASE.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return `${baseUrl}/${normalizedPath}`;
}

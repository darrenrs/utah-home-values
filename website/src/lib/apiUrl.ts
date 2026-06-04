const FASTAPI_SERVER_BASE =
  import.meta.env.VITE_FASTAPI_BASE_PATH || "http://127.0.0.1:8000";
const API_PATH_PREFIX = "/api";

export function withApiBaseUrl(path: string): string {
  const baseUrl = FASTAPI_SERVER_BASE.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiPath =
    baseUrl.endsWith(API_PATH_PREFIX) &&
    (normalizedPath === API_PATH_PREFIX || normalizedPath.startsWith(`${API_PATH_PREFIX}/`))
      ? normalizedPath.slice(API_PATH_PREFIX.length) || "/"
      : normalizedPath;

  return `${baseUrl}${apiPath}`;
}

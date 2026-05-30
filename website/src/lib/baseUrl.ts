export function withBaseUrl(path: string): string {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${baseUrl}${normalizedPath}` || normalizedPath;
}

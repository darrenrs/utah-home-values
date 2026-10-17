function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

// The byte order mark tells Excel the file is UTF-8; without it Excel reads
// characters such as "≥" as Windows-1252.
export function downloadCsv(
  filename: string,
  rows: Array<Array<string | number>>,
) {
  const csv =
    BYTE_ORDER_MARK + rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function fileSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

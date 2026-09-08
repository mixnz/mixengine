/** Turning bytes and text into what the response pane shows. All pure, all tested. */

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A size someone can read at a glance. One decimal, and not even that when it would be a zero. */
export function formatBytes(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  const shown = unit === 0 ? String(size) : size.toFixed(1).replace(/\.0$/, "");
  return `${shown} ${UNITS[unit]}`;
}

/** Sixteen bytes to a line: the offset, the bytes in hex, and the printable characters. `47` is
 *  what sixteen two-digit numbers and the spaces between them come to, so short last lines still
 *  line their text column up with the ones above. */
export function hexDump(bytes: Uint8Array, maxBytes: number): string {
  const shown = bytes.subarray(0, maxBytes);
  const lines: string[] = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const slice = shown.subarray(offset, offset + 16);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47, " ");
    const text = Array.from(slice, (byte) =>
      byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
    ).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  ${text}`);
  }
  return lines.join("\n");
}

/** JSON laid out, or the text exactly as it arrived. A body the server called JSON and got wrong
 *  is still the thing being debugged — reformatting is not worth hiding it for. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A URL short enough for a sidebar row: no scheme, no query, no trailing slash. Only `http` and
 *  `https` lose their scheme — anything else is unusual enough that hiding it would mislead. */
export function shortUrl(url: string): string {
  const withoutScheme = url.replace(/^https?:\/\//i, "");
  const withoutQuery = withoutScheme.split(/[?#]/)[0];
  return withoutQuery.replace(/\/$/, "");
}

/** The last segment of a path, in either slash. What a row shows for a chosen file: no column is
 *  ever wide enough for the whole path, which is the row's hover text instead. */
export function fileName(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

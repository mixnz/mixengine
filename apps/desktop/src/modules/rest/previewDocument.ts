/**
 * The document the Preview frame loads, which is the response plus at most one `<base>`.
 *
 * Relative URLs in a response resolve against wherever the document is, and the Preview is served
 * from a scheme of its own — so without a `<base>` every relative `src` in the page would point at
 * the preview scheme rather than at the server that sent it. That is only worth fixing when
 * external resources are allowed to load at all; with the switch off, nothing is fetched and a
 * `<base>` would only be a hint about where the response came from.
 */
export function previewDocument(html: string, finalUrl: string, external: boolean): string {
  if (!external || finalUrl === "") return html;

  const base = `<base href="${finalUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;

  // A `<base>` counts wherever the parser puts it in `<head>`, and the parser moves it there from
  // any of these. Responses without a `<head>` — a bare `<html><body>`, a fragment, a page that
  // opens straight into markup — are common enough that only handling the first would leave the
  // switch quietly doing nothing.
  const head = html.match(/<head([^>]*)>/i);
  if (head !== null) return html.replace(head[0], `${head[0]}${base}`);

  const htmlTag = html.match(/<html([^>]*)>/i);
  if (htmlTag !== null) return html.replace(htmlTag[0], `${htmlTag[0]}${base}`);

  return `${base}${html}`;
}

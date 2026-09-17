import { describe, expect, it } from "vitest";

/**
 * Colour belongs to `shell/App.css` (design D8). Until every screen has moved onto its tokens this
 * is a ratchet rather than a ban: each file's count of colour literals is pinned below, a file
 * above its pin or missing from it fails, and a file *below* its pin fails too until the pin is
 * lowered — so the numbers only ever go down. The migration is done when both maps are empty.
 */

const sheets = import.meta.glob("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sources = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CSS_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*\d/gi;
const TS_HEX = /["'`]#[0-9a-f]{3,8}["'`]/gi;

function withoutBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function withoutComments(text: string): string {
  return withoutBlockComments(text).replace(/^\s*\/\/.*$/gm, "");
}

function counts(
  files: Record<string, string>,
  pattern: RegExp,
  strip: (text: string) => string,
  skip: (path: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, text] of Object.entries(files)) {
    // The glob names files beside this test `./x` and everything else `../dir/x`; key both from `src/`.
    const key = path.replace(/^\.\.\//, "").replace(/^\.\//, "shell/");
    if (skip(key)) continue;
    const n = (strip(text).match(pattern) ?? []).length;
    if (n > 0) out[key] = n;
  }
  return out;
}

const CSS_BASELINE: Record<string, number> = {
  "modules/db/components/ColumnDialog/ColumnDialog.module.css": 1,
  "modules/db/components/DatabaseStats/DatabaseStats.module.css": 2,
  "modules/db/components/Document/Document.module.css": 11,
  "modules/db/components/DocumentNode/DocumentNode.module.css": 7,
  "modules/db/components/IndexDialog/IndexDialog.module.css": 2,
  "modules/db/components/InsertRowsDialog/InsertRowsDialog.module.css": 1,
  "modules/db/components/OrderByDialog/OrderByDialog.module.css": 3,
  "modules/db/components/QueryEditor/QueryEditor.module.css": 3,
  "modules/db/components/RedisGroupKeys/RedisGroupKeys.module.css": 2,
  "modules/db/components/RedisKeyList/RedisKeyList.module.css": 1,
  "modules/db/components/RedisTypeBadge/RedisTypeBadge.module.css": 16,
  "modules/db/components/RedisValue/RedisValue.module.css": 3,
  "modules/db/components/SqlTable/SqlTable.module.css": 4,
  "modules/db/components/TableStructure/TableStructure.module.css": 4,
  "modules/db/components/ToolsSection/ToolsSection.module.css": 3,
  "modules/db/components/TransferOverlay/TransferOverlay.module.css": 2,
  "modules/db/components/TunnelBanner/TunnelBanner.module.css": 5,
  "modules/db/db.css": 20,
  "modules/mixengine/components/AfterApply/AfterApply.module.css": 1,
  "modules/mixengine/components/ElevationDialog/ElevationDialog.module.css": 1,
  "modules/mixengine/components/StaleBadge/StaleBadge.module.css": 1,
  "modules/mixengine/screens/Blueprints/ApplyDialog.module.css": 6,
  "modules/mixengine/screens/Blueprints/Blueprints.module.css": 2,
  "modules/mixengine/screens/Blueprints/CaptureDialog.module.css": 1,
  "modules/mixengine/screens/Blueprints/ImportDialog.module.css": 1,
  "modules/mixengine/screens/Domains/CaBlock.module.css": 1,
  "modules/mixengine/screens/Domains/CertTable.module.css": 1,
  "modules/mixengine/screens/Extensions/Extensions.module.css": 1,
  "modules/mixengine/screens/Extensions/PlanDialog.module.css": 2,
  "modules/mixengine/screens/Logs/Logs.module.css": 2,
  "modules/mixengine/screens/Metrics/Chart.module.css": 1,
  "modules/rest/components/BodyEditor/BodyEditor.module.css": 1,
  "modules/rest/components/HistoryDialog/HistoryDialog.module.css": 9,
  "modules/rest/components/HtmlPreview/HtmlPreview.module.css": 1,
  "modules/rest/components/KeyValueTable/KeyValueTable.module.css": 1,
  "modules/rest/components/MultipartTable/MultipartTable.module.css": 1,
  "modules/rest/components/RequestList/RequestList.module.css": 2,
  "modules/rest/components/ResponseStatusBar/ResponseStatusBar.module.css": 4,
  "modules/rest/components/UrlPreview/UrlPreview.module.css": 2,
  "modules/rest/rest.css": 7,
  "modules/terminal/components/TerminalView/TerminalView.module.css": 1,
  "modules/tools/tools/connection/Panel.module.css": 1,
  "modules/tools/tools/convert/Panel.module.css": 1,
  "modules/tools/tools/diff/Panel.module.css": 1,
  "modules/tools/tools/env/Panel.module.css": 1,
  "modules/tools/tools/format/Panel.module.css": 1,
  "modules/tools/tools/mask/Panel.module.css": 1,
  "modules/tools/tools/ports/Panel.module.css": 1,
  "modules/tools/tools/regex/Panel.module.css": 1,
  "modules/tools/tools/schema/Panel.module.css": 1,
};

const TS_BASELINE: Record<string, number> = {
  "modules/terminal/components/TerminalView/TerminalView.tsx": 4,
  "modules/tools/tools/qrcode/Panel.tsx": 2,
};

describe("colour literals", () => {
  it("reads real files", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(40);
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("stylesheets outside App.css match their pins", () => {
    expect(counts(sheets, CSS_LITERAL, withoutBlockComments, (p) => p === "shell/App.css")).toEqual(CSS_BASELINE);
  });

  it("sources match their pins", () => {
    expect(counts(sources, TS_HEX, withoutComments, () => false)).toEqual(TS_BASELINE);
  });
});

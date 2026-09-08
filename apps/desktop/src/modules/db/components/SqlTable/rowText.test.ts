import { describe, expect, it } from "vitest";
import {
  csvText,
  insertStatements,
  jsonText,
  quoteIdentifier,
  spreadsheetText,
  sqlLiteral,
} from "./rowText";

describe("quoteIdentifier", () => {
  it("wraps a name in backticks", () => {
    expect(quoteIdentifier("orders")).toBe("`orders`");
  });

  it("doubles a backtick inside the name", () => {
    expect(quoteIdentifier("we`ird")).toBe("`we``ird`");
  });
});

describe("sqlLiteral", () => {
  it("writes nothing as NULL", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
  });

  it("leaves numbers bare", () => {
    expect(sqlLiteral(42)).toBe("42");
    expect(sqlLiteral(-1.5)).toBe("-1.5");
  });

  it("has no literal for a number SQL cannot write", () => {
    expect(sqlLiteral(NaN)).toBe("NULL");
    expect(sqlLiteral(Infinity)).toBe("NULL");
  });

  it("writes booleans as MySQL stores them", () => {
    expect(sqlLiteral(true)).toBe("1");
    expect(sqlLiteral(false)).toBe("0");
  });

  it("quotes text", () => {
    expect(sqlLiteral("hello")).toBe("'hello'");
    expect(sqlLiteral("")).toBe("''");
  });

  it("escapes what would end the string early or be read as an escape", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O\\'Brien'");
    expect(sqlLiteral("C:\\tmp")).toBe("'C:\\\\tmp'");
  });

  it("escapes the characters that would break a line or a piped script", () => {
    expect(sqlLiteral("a\nb")).toBe("'a\\nb'");
    expect(sqlLiteral("a\r\nb")).toBe("'a\\r\\nb'");
    expect(sqlLiteral("a\0b")).toBe("'a\\0b'");
    expect(sqlLiteral("a\x1ab")).toBe("'a\\Zb'");
  });

  it("writes a JSON column back as its JSON text", () => {
    expect(sqlLiteral({ a: 1 })).toBe(`'{"a":1}'`);
    expect(sqlLiteral([1, 2])).toBe("'[1,2]'");
  });
});

describe("insertStatements", () => {
  const columns = ["id", "name", "note"];
  const rows = [
    { id: 1, name: "Ann", note: null },
    { id: 2, name: "Bob", note: "it's fine" },
  ];

  it("puts every row into one statement, a row to a line", () => {
    expect(insertStatements("users", columns, rows)).toBe(
      "INSERT INTO `users` (`id`, `name`, `note`) VALUES\n" +
        "  (1, 'Ann', NULL),\n" +
        "  (2, 'Bob', 'it\\'s fine');",
    );
  });

  it("leaves out the column the server assigns", () => {
    expect(insertStatements("users", columns, [rows[0]], "id")).toBe(
      "INSERT INTO `users` (`name`, `note`) VALUES\n  ('Ann', NULL);",
    );
  });

  it("writes NULL for a column the row does not carry", () => {
    expect(insertStatements("users", columns, [{ id: 3 }])).toBe(
      "INSERT INTO `users` (`id`, `name`, `note`) VALUES\n  (3, NULL, NULL);",
    );
  });

  it("has nothing to say about no rows", () => {
    expect(insertStatements("users", columns, [])).toBe("");
  });

  it("opens another statement once the batch is long enough", () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: i, name: "x", note: null }));
    const sql = insertStatements("users", columns, many);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(3);
    // Every row is there, and each statement is closed before the next one opens.
    expect(sql.match(/^ {2}\(/gm)).toHaveLength(250);
    expect(sql.match(/;$/gm)).toHaveLength(3);
  });

  it("opens another statement on a batch of few but very large rows", () => {
    const heavy = Array.from({ length: 6 }, (_, i) => ({ id: i, name: "x".repeat(200_000), note: null }));
    const sql = insertStatements("users", columns, heavy);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(3);
  });

  it("decodes a binary column rather than inserting its base64", () => {
    const binary = ["id", "key"];
    const rows = [{ id: 1, key: "q83vASNFZ4mrze8BI0Vn" }];
    expect(insertStatements("things", binary, rows, null, new Set(["key"]))).toBe(
      "INSERT INTO `things` (`id`, `key`) VALUES\n  (1, FROM_BASE64('q83vASNFZ4mrze8BI0Vn'));",
    );
  });

  it("leaves an empty binary column NULL rather than decoding nothing", () => {
    const binary = ["id", "key"];
    expect(insertStatements("things", binary, [{ id: 1, key: null }], null, new Set(["key"]))).toBe(
      "INSERT INTO `things` (`id`, `key`) VALUES\n  (1, NULL);",
    );
  });

  it("keeps a single row too large for the cap rather than losing it", () => {
    const huge = [{ id: 1, name: "x".repeat(600_000), note: null }];
    const sql = insertStatements("users", columns, huge);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
    expect(sql).toContain("x".repeat(600_000));
  });
});

describe("spreadsheetText", () => {
  const columns = ["id", "name"];

  it("puts the column names along the top", () => {
    expect(spreadsheetText(columns, [{ id: 1, name: "Ann" }])).toBe("id\tname\r\n1\tAnn");
  });

  it("leaves a NULL cell empty", () => {
    expect(spreadsheetText(columns, [{ id: 1, name: null }])).toBe("id\tname\r\n1\t");
  });

  it("quotes a value that would break itself into more cells or rows", () => {
    expect(spreadsheetText(columns, [{ id: 1, name: "a\tb" }])).toBe('id\tname\r\n1\t"a\tb"');
    expect(spreadsheetText(columns, [{ id: 1, name: "a\nb" }])).toBe('id\tname\r\n1\t"a\nb"');
    expect(spreadsheetText(columns, [{ id: 1, name: 'say "hi"' }])).toBe('id\tname\r\n1\t"say ""hi"""');
  });

  it("writes a JSON column as its JSON text", () => {
    expect(spreadsheetText(["doc"], [{ doc: { a: 1 } }])).toBe('doc\r\n"{""a"":1}"');
  });

  it("is the header alone when nothing is selected", () => {
    expect(spreadsheetText(columns, [])).toBe("id\tname");
  });

  it("leaves a comma alone — a tab is what separates cells here", () => {
    expect(spreadsheetText(columns, [{ id: 1, name: "Ann, Bob" }])).toBe("id\tname\r\n1\tAnn, Bob");
  });
});

describe("csvText", () => {
  const columns = ["id", "name"];

  it("separates cells with commas and rows with CRLF", () => {
    expect(csvText(columns, [{ id: 1, name: "Ann" }, { id: 2, name: "Bob" }])).toBe(
      "id,name\r\n1,Ann\r\n2,Bob",
    );
  });

  it("leaves a NULL cell empty", () => {
    expect(csvText(columns, [{ id: 1, name: null }])).toBe("id,name\r\n1,");
  });

  it("quotes a value that would break itself into more cells or rows", () => {
    expect(csvText(columns, [{ id: 1, name: "Ann, Bob" }])).toBe('id,name\r\n1,"Ann, Bob"');
    expect(csvText(columns, [{ id: 1, name: "a\nb" }])).toBe('id,name\r\n1,"a\nb"');
    expect(csvText(columns, [{ id: 1, name: 'say "hi"' }])).toBe('id,name\r\n1,"say ""hi"""');
  });

  it("leaves a tab alone — a comma is what separates cells here", () => {
    expect(csvText(columns, [{ id: 1, name: "a\tb" }])).toBe("id,name\r\n1,a\tb");
  });

  it("writes a JSON column as its quoted JSON text", () => {
    expect(csvText(["doc"], [{ doc: { a: 1, b: 2 } }])).toBe('doc\r\n"{""a"":1,""b"":2}"');
  });

  it("is the header alone when nothing is selected", () => {
    expect(csvText(columns, [])).toBe("id,name");
  });
});

describe("jsonText", () => {
  const columns = ["id", "name"];

  it("writes an object per row, keyed by column name", () => {
    expect(jsonText(columns, [{ id: 1, name: "Ann" }])).toBe(
      '[\n  {\n    "id": 1,\n    "name": "Ann"\n  }\n]',
    );
  });

  it("keeps a NULL cell as a key with no value rather than dropping it", () => {
    expect(jsonText(columns, [{ id: 1, name: null }])).toBe(
      '[\n  {\n    "id": 1,\n    "name": null\n  }\n]',
    );
  });

  it("writes a JSON column as JSON rather than as its text", () => {
    expect(jsonText(["doc"], [{ doc: { a: 1 } }])).toBe('[\n  {\n    "doc": {\n      "a": 1\n    }\n  }\n]');
  });

  it("is an empty array when nothing is selected", () => {
    expect(jsonText(columns, [])).toBe("[]");
  });

  // Only the columns on screen, in the order they are on screen — the same rule the two delimited
  // formats follow, and the reason the rows are mapped down positionally first.
  it("takes only the named columns", () => {
    expect(jsonText(["name"], [{ id: 1, name: "Ann" }])).toBe('[\n  {\n    "name": "Ann"\n  }\n]');
  });
});

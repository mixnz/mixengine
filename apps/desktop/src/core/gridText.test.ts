import { describe, expect, it } from "vitest";
import { csvText, jsonText, tsvText, uniqueNames } from "./gridText";

const COLUMNS = ["id", "name"];

describe("tsvText", () => {
  it("puts the column names on the first line", () => {
    expect(tsvText(COLUMNS, [[1, "a"]])).toBe("id\tname\r\n1\ta");
  });

  it("writes nothing for a NULL cell", () => {
    expect(tsvText(COLUMNS, [[null, undefined]])).toBe("id\tname\r\n\t");
  });

  it("serialises an object cell, and quotes it for the quotes JSON leaves in it", () => {
    expect(tsvText(["j"], [[{ a: 1 }]])).toBe('j\r\n"{""a"":1}"');
  });

  it("quotes a cell holding a tab, and doubles the quotes inside it", () => {
    expect(tsvText(["t"], [['a\tb"c']])).toBe('t\r\n"a\tb""c"');
  });

  it("quotes a cell holding a line break", () => {
    expect(tsvText(["t"], [["a\nb"]])).toBe('t\r\n"a\nb"');
  });

  it("separates rows with CRLF", () => {
    expect(tsvText(["t"], [["a"], ["b"]])).toBe("t\r\na\r\nb");
  });
});

describe("csvText", () => {
  it("separates with commas", () => {
    expect(csvText(COLUMNS, [[1, "a"]])).toBe("id,name\r\n1,a");
  });

  it("quotes a cell holding a comma but leaves a tab alone", () => {
    expect(csvText(["t"], [["a,b"]])).toBe('t\r\n"a,b"');
    expect(csvText(["t"], [["a\tb"]])).toBe("t\r\na\tb");
  });
});

describe("uniqueNames", () => {
  it("leaves distinct names alone", () => {
    expect(uniqueNames(["id", "name"])).toEqual(["id", "name"]);
  });

  it("numbers the repeats from two", () => {
    expect(uniqueNames(["id", "id", "id"])).toEqual(["id", "id_2", "id_3"]);
  });

  it("keeps going when the suffix it would use is taken", () => {
    expect(uniqueNames(["id", "id_2", "id"])).toEqual(["id", "id_2", "id_3"]);
  });
});

describe("jsonText", () => {
  it("writes an array of objects, keyed by column name", () => {
    expect(jsonText(COLUMNS, [[1, "a"]])).toBe(
      '[\n  {\n    "id": 1,\n    "name": "a"\n  }\n]'
    );
  });

  it("writes an empty array for no rows", () => {
    expect(jsonText(COLUMNS, [])).toBe("[]");
  });

  it("keeps a missing cell as null rather than dropping the key", () => {
    expect(jsonText(["a", "b"], [[1]])).toBe('[\n  {\n    "a": 1,\n    "b": null\n  }\n]');
  });

  it("gives the second column of the same name its own key", () => {
    expect(jsonText(["id", "id"], [[1, 2]])).toBe(
      '[\n  {\n    "id": 1,\n    "id_2": 2\n  }\n]'
    );
  });
});

import { describe, expect, it } from "vitest";
import { CATEGORICAL_HUES, monogramHue, monogramLetters } from "./monogram";

describe("monogramLetters", () => {
  it("takes the first letter up and the second down", () => {
    expect(monogramLetters("mariadb")).toBe("Ma");
    expect(monogramLetters("PHP")).toBe("Ph");
  });

  it("skips what is not a letter or a digit", () => {
    expect(monogramLetters("php-fpm")).toBe("Ph");
    expect(monogramLetters("@main")).toBe("Ma");
    expect(monogramLetters("  .x-9")).toBe("X9");
  });

  it("keeps a one-character name as one character", () => {
    expect(monogramLetters("a")).toBe("A");
  });

  it("marks a name with nothing to draw", () => {
    expect(monogramLetters("")).toBe("··");
    expect(monogramLetters("--")).toBe("··");
  });
});

describe("monogramHue", () => {
  it("gives the same name the same hue every time", () => {
    expect(monogramHue("redis")).toBe(monogramHue("redis"));
  });

  it("has no hue for a name with nothing to draw", () => {
    expect(monogramHue("")).toBeNull();
  });

  it("reaches every hue across ordinary names", () => {
    const names = ["caddy", "nginx", "mariadb", "mysql", "postgres", "redis", "memcached", "mongodb",
      "php", "node", "python", "ruby", "composer", "laravel", "wordpress", "django", "rails", "vite",
      "strapi", "symfony", "drupal", "static", "next", "clickhouse", "sqlite", "mssql"];
    const seen = new Set(names.map(monogramHue));
    for (const hue of CATEGORICAL_HUES) expect(seen).toContain(hue);
  });
});

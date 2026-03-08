import { describe, expect, it } from "vitest";
import { normalizeEmail, parseCsv, slugify } from "./csv";

describe("parseCsv", () => {
  it("parses quoted values and line breaks", () => {
    const rows = parseCsv(
      'name,email,company\n"Alex Park",alex@example.com,"Northline, Studio"\nJonas,jonas@example.com,Fieldnotes',
    );

    expect(rows).toEqual([
      ["name", "email", "company"],
      ["Alex Park", "alex@example.com", "Northline, Studio"],
      ["Jonas", "jonas@example.com", "Fieldnotes"],
    ]);
  });

  it("strips a UTF-8 BOM from the first header cell", () => {
    const rows = parseCsv("\uFEFFname,email\nAlex,alex@example.com");

    expect(rows[0]).toEqual(["name", "email"]);
  });
});

describe("slugify", () => {
  it("normalizes values into URL-safe slugs", () => {
    expect(slugify("Alexandra Park")).toBe("alexandra-park");
    expect(slugify("  !!!  ")).toBe("contact");
  });
});

describe("normalizeEmail", () => {
  it("normalizes email casing and trims whitespace", () => {
    expect(normalizeEmail("  Alex@Example.com ")).toBe("alex@example.com");
    expect(normalizeEmail("")).toBeNull();
  });
});

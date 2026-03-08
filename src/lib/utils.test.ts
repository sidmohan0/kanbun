import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2 py-2", "px-4", "font-medium")).toBe(
      "py-2 px-4 font-medium",
    );
  });
});

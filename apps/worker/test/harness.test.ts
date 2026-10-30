import { access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { createTestHarness, type TestHarness, type TestHarnessOptions } from "wrangler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeHarness, localWorkerConfig } from "./harness";

vi.mock("wrangler", () => ({ createTestHarness: vi.fn() }));
const create = vi.mocked(createTestHarness);
const options = () => create.mock.calls.at(-1)![0] as TestHarnessOptions;
beforeEach(() => create.mockReset());

describe("native temporary Worker harness projects", () => {
  it("preserves shipped Worker configuration and resolves source paths while isolating generated files", async () => {
    const close = vi.fn(async () => {});
    create.mockReturnValue({ close } as unknown as TestHarness);
    const config = await localWorkerConfig();
    const source = structuredClone(config);
    const harness = await createRuntimeHarness([
      {
        ...config,
        d1_databases: [
          { binding: "ACCOUNTS", database_name: "fixture", migrations_dir: "../../packages/model/migrations/accounts" },
        ],
      },
    ]);
    const input = options();
    const root = input.root!;
    try {
      const nativeTmp = await realpath(tmpdir());
      const child = relative(nativeTmp, await realpath(root));
      expect(child.startsWith("..")).toBe(false);
      expect(isAbsolute(child)).toBe(false);
      expect(child).toMatch(/^kanbun-worker-runtime-/);
      const { config: actual } = input.workers[0] as { config: typeof config };
      expect(actual.main).toMatch(/\/apps\/worker\/src\/index\.ts$/);
      expect(actual.tsconfig).toMatch(/\/apps\/worker\/tsconfig\.json$/);
      expect(actual.d1_databases?.[0]?.migrations_dir).toMatch(/\/packages\/model\/migrations\/accounts$/);
      expect(actual).toMatchObject({
        vars: source.vars,
        durable_objects: source.durable_objects,
        migrations: source.migrations,
        rules: source.rules,
        compatibility_date: source.compatibility_date,
      });
      expect(config).toEqual(source);
    } finally {
      await harness.close();
    }
    expect(close).toHaveBeenCalledOnce();
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the temporary project even when harness construction or teardown fails", async () => {
    create.mockImplementationOnce(() => {
      throw new Error("fixture construction failed");
    });
    await expect(createRuntimeHarness([{ name: "fixture", main: "src/index.ts" }])).rejects.toThrow(
      "construction failed",
    );
    await expect(access(options().root!)).rejects.toMatchObject({ code: "ENOENT" });
    create.mockReturnValueOnce({
      close: async () => {
        throw new Error("fixture teardown failed");
      },
    } as unknown as TestHarness);
    const harness = await createRuntimeHarness([{ name: "fixture", main: resolve("src/index.ts") }]);
    const root = options().root!;
    await expect(harness.close()).rejects.toThrow("teardown failed");
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

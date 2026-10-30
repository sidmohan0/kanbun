import { uuidv7 } from "@kanbun/model";
import type { PushResponse } from "@kanbun/sync";
import { performance } from "node:perf_hooks";
import { test, expect } from "./app.fixture";

// The specification fixes this working-set size and target; setup is measured separately.
const workingSet = 5000;
test("records actual 5000-issue HTTP bootstrap and first React view against the specification target", async ({
  browser,
  app,
}, testInfo) => {
  const seedStarted = performance.now();
  // /sync/push accepts at most 500 mutations, as defined in the public request schema.
  for (let start = 1; start < workingSet; start += 500) {
    const mutations = Array.from({ length: Math.min(500, workingSet - start) }, (_, offset) => ({
      id: offset + 1,
      name: "issueCreate",
      ts: new Date().toISOString(),
      args: {
        id: uuidv7(),
        teamId: app.teamId,
        title: `Acceptance issue ${String(start + offset + 1).padStart(4, "0")}`,
        subscriptionId: uuidv7(),
      },
    }));
    const response = await app.runtime.fetch("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: `scale-fixture-${start}`, mutations }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
  }
  const seedMs = performance.now() - seedStarted;
  const warmContext = await browser.newContext();
  try {
    const warm = await warmContext.newPage();
    await warm.goto(app.origin);
    await expect(warm.locator(".list-heading h2 > span")).toHaveText(String(workingSet));
    await expect(warm.locator(".sync-indicator")).toContainText("Saved");
  } finally {
    await warmContext.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.addInitScript((expectedCount) => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/sync/bootstrap" && performance.getEntriesByName("kanbun-bootstrap-start").length === 0)
          performance.mark("kanbun-bootstrap-start");
        return original(input, init);
      };
      let done = false;
      const observer = new MutationObserver(() => {
        if (done || !performance.getEntriesByName("kanbun-bootstrap-start").length) return;
        const count = document.querySelector(".list-heading h2 > span")?.textContent?.trim();
        if (count !== String(expectedCount) || !document.querySelector(".issue-list tbody tr")) return;
        done = true;
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            performance.mark("kanbun-bootstrap-painted");
            performance.measure("kanbun-bootstrap-render", "kanbun-bootstrap-start", "kanbun-bootstrap-painted");
          }),
        );
      });
      observer.observe(document, { childList: true, subtree: true });
    }, workingSet);
    await page.goto(app.origin);
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName("kanbun-bootstrap-render").length))
      .toBe(1);
    const timing = await page.evaluate(() => {
      const measure = performance.getEntriesByName("kanbun-bootstrap-render")[0]!;
      const bootstrap = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).find(
        (entry) => new URL(entry.name).pathname === "/sync/bootstrap",
      );
      return {
        bootstrapToPaintMs: measure.duration,
        bootstrapHttpMs: bootstrap?.duration ?? null,
        encodedBodyBytes: bootstrap?.encodedBodySize ?? null,
        renderedRows: document.querySelectorAll(".issue-list tbody tr").length,
      };
    });
    const receipt = {
      workingSet,
      seedMethod: "actual HTTP issueCreate batches, maximum 500 mutations per request",
      seedMs,
      runtime: "local workerd + real React application",
      state: "warm Worker and transformed Vite modules; new browser context with empty IndexedDB",
      starts: "first /sync/bootstrap fetch invocation",
      ends: "two animation frames after React commits the 5000-issue working-set count and issue rows",
      excludes: ["fixture seeding", "cold Vite compilation", "initial account/context request and module loading"],
      specificationTargetMs: 1000,
      ...timing,
      meetsSpecificationTarget: timing.bootstrapToPaintMs < 1000,
    };
    await testInfo.attach("5000-issue-bootstrap-render", {
      body: JSON.stringify(receipt, null, 2),
      contentType: "application/json",
    });
    // Keep the measurement inspectable before deciding whether rendering changes are necessary.
    expect(timing.encodedBodyBytes).toBeGreaterThan(0);
    expect(timing.renderedRows).toBe(workingSet);
  } finally {
    await context.close();
  }
});

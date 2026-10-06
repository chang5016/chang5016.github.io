import assert from "node:assert/strict";
import test from "node:test";

test("renders the fictional Taiwanese capybara taxi driving game metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<title>Capy Cab｜卡皮巴拉計程車<\/title>/);
  assert.match(html, /親自駕駛水豚復古機車計程車/);
  assert.match(html, /CommercialTaxiGame/);
  assert.match(html, /rel="preload"[^>]*capybara-premium-original\.glb\?v=original-285179-front-fixed/);
  assert.doesNotMatch(html, /rel="preconnect"[^>]*tiles\.openfreemap\.org/);
  assert.doesNotMatch(html, /wmts\.nlsc\.gov\.tw/);
  assert.doesNotMatch(html, /海港城市/);
});

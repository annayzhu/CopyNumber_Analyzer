import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientRoot = new URL("../dist/client/", import.meta.url);

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

async function fetchBuiltAsset(request) {
  const pathname = new URL(request.url).pathname;
  try {
    const body = await readFile(new URL(`.${pathname}`, clientRoot));
    return new Response(body, {
      status: 200,
      headers: { "content-type": contentType(pathname) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    { ASSETS: { fetch: fetchBuiltAsset } },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("serves the CNV analyzer at the site root", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>CNV分析工具 v 1\.3<\/title>/i);
  assert.match(html, /property="og:image"[^>]+og\.png/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.match(html, /id="file-input"/i);
  assert.match(html, /id="record-section"/i);
  assert.match(html, /id="record-assays"/i);
  assert.match(html, /id="save-registration"/i);
  assert.match(html, /id="record-save-status"/i);
  assert.match(html, /导出完整实验记录 XLSX/i);
  assert.match(html, /vendor\/xlsx\.full\.min\.js/i);
  assert.match(html, /core\.js/i);
  assert.match(html, /app\.js/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("packages every browser-side dependency", async () => {
  for (const pathname of [
    "/styles.css",
    "/core.js",
    "/app.js",
    "/vendor/xlsx.full.min.js",
    "/og.png",
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should be available`);
    assert.ok((await response.arrayBuffer()).byteLength > 100, `${pathname} should not be empty`);
  }
});

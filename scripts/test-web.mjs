import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const directory = await mkdtemp(join(tmpdir(), "rn-read-web-"));
try {
  const runtime = await readFile("assets/runtime.webbundle", "utf8");
  const result = await build({
    entryPoints: ["src/web/templates.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const { readerDocument } = await import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].contents).toString("base64")
  );
  await mkdir(join(directory, "runtime"));
  await mkdir(join(directory, "readers", "doc"), { recursive: true });
  await mkdir(join(directory, "offline", "saved", "assets"), {
    recursive: true,
  });
  await writeFile(join(directory, "runtime", "runtime.js"), runtime);
  await writeFile(
    join(directory, "offline", "saved", "assets", "pixel.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>',
  );
  const html =
    '<h1 id="intro">Intro</h1><img id="local-image" src="../../offline/saved/assets/pixel.svg"><div class="mermaid">flowchart TD\n A --> B</div><div class="mermaid">invalid diagram xx</div><p id="end" style="margin-top:1800px">End</p><p style="height:1600px">Tail</p><img src="https://never.test/x" onerror="window.attacked=true"><script>window.attacked=true</script>';
  const file = join(directory, "readers", "doc", "index.html");
  await writeFile(
    file,
    readerDocument(
      { html, position: { anchor: "end", offset: 0, progress: 0.9 } },
      "../../runtime/runtime.js",
    ),
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  await context.addInitScript(() => {
    window.messages = [];
    window.ReactNativeWebView = {
      postMessage: (s) => window.messages.push(JSON.parse(s)),
    };
  });
  const requests = [];
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(
    () => window.messages.some((m) => m.type === "READY"),
    { timeout: 30000 },
  );
  assert.equal(await page.locator(".mermaid svg").count(), 1);
  assert.equal(await page.evaluate(() => Boolean(window.attacked)), false);
  assert.ok((await page.evaluate(() => window.scrollY)) > 1000);
  assert.equal(
    await page.locator("#local-image").evaluate((img) => img.naturalWidth),
    24,
  );
  assert.deepEqual(requests, []);
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
  );
  await page.evaluate(() => window.RNRead.flush());
  assert.ok(
    await page.evaluate(() =>
      window.messages.some(
        (m) => m.type === "POSITION" && m.position.anchor === "end",
      ),
    ),
  );
  await page.locator(".mermaid svg").first().click();
  const svg = await page.evaluate(
    () => window.messages.find((m) => m.type === "DIAGRAM")?.svg,
  );
  assert.ok(svg);
  const cache = await page.evaluate(
    () => window.messages.find((m) => m.type === "SVG_CACHE")?.cache,
  );
  await writeFile(
    file,
    readerDocument({ html, svgCache: cache }, "../../runtime/runtime.js"),
  );
  await page.reload();
  await page.waitForFunction(
    () => window.messages.some((m) => m.type === "READY"),
    { timeout: 30000 },
  );
  assert.equal(await page.locator(".mermaid svg").count(), 1);
  await writeFile(
    file,
    readerDocument({ diagram: svg }, "../../runtime/runtime.js"),
  );
  await page.reload();
  await page.waitForFunction(
    () => window.messages.some((m) => m.type === "READY"),
    { timeout: 30000 },
  );
  await page.locator("#plus").click();
  assert.match(
    await page.locator("#reader svg").getAttribute("style"),
    /scale\(1\.3\)/,
  );
  await page.locator("#reset").click();
  assert.match(
    await page.locator("#reader svg").getAttribute("style"),
    /scale\(1\)/,
  );
  const client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 110, y: 250, id: 1 },
      { x: 210, y: 250, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 70, y: 250, id: 1 },
      { x: 250, y: 250, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.match(
    await page.locator("#reader svg").getAttribute("style"),
    /scale\(1\.8\)/,
  );
  await page.locator("#reset").click();
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 130, y: 250, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 160, y: 270, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.match(
    await page.locator("#reader svg").getAttribute("style"),
    /translate\(30px, 20px\)/,
  );
  assert.deepEqual(requests, []);
  const markdownBundle = await build({
    entryPoints: ["src/core/markdown.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const { createMarkdown } = await import(
    "data:text/javascript;base64," +
      Buffer.from(markdownBundle.outputFiles[0].contents).toString("base64")
  );
  const markdown =
    "# Contents\n\n[English](#hello-world) · [Duplicate](#hello-world-1) · [中文](#中文-标题) · [Other file](next.md#中文-标题)\n\n" +
    "Paragraph text. ".repeat(350) +
    "\n\n# Hello World\n\n" +
    "Middle text. ".repeat(150) +
    "\n\n# Hello World\n\n" +
    "More text. ".repeat(150) +
    "\n\n# 中文 标题\n\n" +
    "Tail text. ".repeat(350);
  const markdownHtml = createMarkdown().render(markdown);
  await writeFile(
    file,
    readerDocument(
      {
        html: markdownHtml,
        initialAnchor: "中文-标题",
        position: { progress: 0 },
      },
      "../../runtime/runtime.js",
    ),
  );
  await page.reload();
  await page.waitForFunction(() =>
    window.messages.some((m) => m.type === "READY"),
  );
  assert.ok(
    await page
      .locator('[id="中文-标题"]')
      .evaluate((el) => Math.abs(el.getBoundingClientRect().top) < 5),
    "explicit cross-file anchor overrides saved progress after layout",
  );
  assert.equal(
    await page.evaluate(() =>
      window.messages.some((m) => m.type === "POSITION"),
    ),
    false,
    "restoration must not overwrite progress",
  );
  for (const [label, id] of [
    ["English", "hello-world"],
    ["Duplicate", "hello-world-1"],
    ["中文", "中文-标题"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    assert.ok(
      await page
        .locator('[id="' + id + '"]')
        .evaluate((el) => Math.abs(el.getBoundingClientRect().top) < 5),
      "Markdown link reaches " + id,
    );
  }
  await page.getByRole("link", { name: "Other file" }).click();
  assert.ok(
    await page.evaluate(() =>
      window.messages.some(
        (m) =>
          m.type === "OPEN_LINK" &&
          decodeURIComponent(m.url) === "next.md#中文-标题",
      ),
    ),
  );
  await writeFile(
    file,
    readerDocument(
      {
        html: markdownHtml.replace(/ id="[^"]*"/g, ""),
        initialAnchor: "hello-world-1",
      },
      "../../runtime/runtime.js",
    ),
  );
  await page.reload();
  await page.waitForFunction(() =>
    window.messages.some((m) => m.type === "READY"),
  );
  assert.ok(
    await page
      .locator("#hello-world-1")
      .evaluate((el) => Math.abs(el.getBoundingClientRect().top) < 5),
    "older imported Markdown without IDs gets matching runtime headings",
  );
  // Capture a real loaded page, then consume its HTML in the local template.
  const captureContext = await browser.newContext();
  const capturePage = await captureContext.newPage();
  await capturePage.route("https://source.test/article", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<html><head><title>Article</title></head><body><article><h1>Article</h1><a href="#details">Contents</a><a href="https://source.test/article#details">Absolute contents</a><p>' +
        "Readable article text. ".repeat(150) +
        '</p><h2 id="details">Details</h2><p>' +
        "More readable text. ".repeat(150) +
        "</p></article></body></html>",
    }),
  );
  await capturePage.goto("https://source.test/article");
  await capturePage.evaluate(() => {
    window.messages = [];
    window.ReactNativeWebView = {
      postMessage: (s) => window.messages.push(JSON.parse(s)),
    };
  });
  await capturePage.addScriptTag({
    content: await readFile("assets/capture.webbundle", "utf8"),
  });
  for (const mode of ["snapshot", "reader"]) {
    const captured = await capturePage.evaluate(async (mode) => {
      window.messages = [];
      await window.RNReadCapture("capture", mode);
      return window.messages
        .filter((m) => m.type === "CAPTURE_CHUNK")
        .map((m) => m.data)
        .join("");
    }, mode);
    assert.match(
      captured,
      /href="#details"/,
      "same-page links remain local in " + mode,
    );
    assert.doesNotMatch(
      captured,
      /href="https:\/\/source.test\/article#details"/,
    );
    await writeFile(
      file,
      readerDocument({ html: captured }, "../../runtime/runtime.js"),
    );
    await page.reload();
    await page.waitForFunction(() =>
      window.messages.some((m) => m.type === "READY"),
    );
    await page.locator("a").first().click();
    assert.ok(
      await page
        .locator("#details")
        .evaluate((el) => Math.abs(el.getBoundingClientRect().top) < 5),
    );
    assert.equal(
      await page.evaluate(() =>
        window.messages.some((m) => m.type === "OPEN_LINK"),
      ),
      false,
    );
  }
  await captureContext.close();
  console.log(
    "PASS: real file:// template + CSP, local runtime/image, no network, Mermaid/error isolation, SVG cache, sanitized events, anchor/position restore, diagram open/pinch/drag/reset.",
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}

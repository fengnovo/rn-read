import { chromium } from "@playwright/test";
import { readFile, access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  resolveRelativePath,
  normalizeBrowserUrl,
  sourceKey,
} from "../src/core/paths";
import { CaptureReceiver } from "../src/core/capture";
import { restorePosition, isReadableStatus } from "../src/core/progress";
import { rewritePage } from "../src/core/offline";

describe("authorized paths", () => {
  it("resolves siblings and encoded Chinese names inside the granted root", () => {
    expect(
      resolveRelativePath("docs/readme.md", "../images/%E5%9B%BE%20a.png"),
    ).toBe("images/图 a.png");
    expect(() => resolveRelativePath("readme.md", "../secret.pdf")).toThrow();
    expect(() =>
      resolveRelativePath("readme.md", "file:///secret.pdf"),
    ).toThrow();
  });
  it("normalizes browser input and rejects executable schemes", () => {
    expect(normalizeBrowserUrl("example.com/文档")).toBe(
      "https://example.com/%E6%96%87%E6%A1%A3",
    );
    expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow();
  });
  it("deduplicates SAF tree and standalone document URIs", () => {
    expect(sourceKey("content://p/tree/root/document/abc%3A123")).toBe(
      "p:abc:123",
    );
    expect(sourceKey("content://p/document/abc%3A123")).toBe("p:abc:123");
  });
});
describe("capture transport", () => {
  it("preserves an independently validated HTTP(S) base URI in capture metadata", () => {
    const receiver = new CaptureReceiver("base");
    receiver.accept({
      type: "CAPTURE_START",
      id: "base",
      length: 3,
      title: "Base",
      url: "https://origin.test/article",
      baseURI: "https://cdn.test/assets/",
      mode: "snapshot",
    });
    receiver.accept({
      type: "CAPTURE_CHUNK",
      id: "base",
      index: 0,
      data: "abc",
    });
    expect(receiver.accept({ type: "CAPTURE_END", id: "base" })).toMatchObject({
      url: "https://origin.test/article",
      baseURI: "https://cdn.test/assets/",
    });
  });
  it("rejects non-HTTP and relative base URI metadata", () => {
    for (const baseURI of [
      "file:///private/",
      "javascript:bad()",
      "/assets/",
      17,
    ])
      expect(() =>
        new CaptureReceiver("base").accept({
          type: "CAPTURE_START",
          id: "base",
          length: 3,
          title: "Base",
          url: "https://origin.test/article",
          baseURI,
          mode: "snapshot",
        }),
      ).toThrow();
  });

  it("ignores stale sessions and rejects out-of-order chunks", () => {
    const receiver = new CaptureReceiver("current", 100);
    expect(
      receiver.accept({ type: "CAPTURE_START", id: "old", length: 3 }),
    ).toBeNull();
    receiver.accept({
      type: "CAPTURE_START",
      id: "current",
      length: 3,
      title: "A",
      url: "https://x.test",
      mode: "snapshot",
    });
    expect(() =>
      receiver.accept({
        type: "CAPTURE_CHUNK",
        id: "current",
        index: 1,
        data: "abc",
      }),
    ).toThrow();
  });
  it("requires the full declared payload and bounds size", () => {
    const receiver = new CaptureReceiver("a", 4);
    expect(() =>
      receiver.accept({ type: "CAPTURE_START", id: "a", length: 5 }),
    ).toThrow();
    receiver.accept({
      type: "CAPTURE_START",
      id: "a",
      length: 3,
      title: "A",
      url: "https://x.test",
      mode: "reader",
    });
    receiver.accept({ type: "CAPTURE_CHUNK", id: "a", index: 0, data: "abc" });
    expect(receiver.accept({ type: "CAPTURE_END", id: "a" })).toMatchObject({
      html: "abc",
      mode: "reader",
    });
  });
});
describe("reading state", () => {
  it("preserves successful saves with missing assets", () =>
    expect(isReadableStatus("ready_with_warnings")).toBe(true));
  it("falls back to percentage after layout change and clamps bounds", () => {
    expect(restorePosition({ progress: 0.5, scrollY: 900 }, 2000, 500)).toBe(
      750,
    );
    expect(restorePosition({ progress: 2 }, 2000, 500)).toBe(1500);
  });
});
describe("offline resources", () => {
  it("resolves nested CSS against each redirected stylesheet and removes remote fallback", async () => {
    const responses: Record<
      string,
      { text: string; finalUrl: string; mime: string }
    > = {
      "https://x.test/site.css": {
        text: '@import "theme.css"; .a { background:url(../img/a.png) }',
        finalUrl: "https://cdn.test/css/site.css",
        mime: "text/css",
      },
      "https://cdn.test/css/theme.css": {
        text: ".b {background:url(./b.png)}",
        finalUrl: "https://cdn.test/css/theme.css",
        mime: "text/css",
      },
      "https://cdn.test/img/a.png": {
        text: "",
        finalUrl: "https://cdn.test/img/a.png",
        mime: "image/png",
      },
      "https://cdn.test/css/b.png": {
        text: "",
        finalUrl: "https://cdn.test/css/b.png",
        mime: "image/png",
      },
    };
    const saved: Record<string, string> = {};
    let sequence = 0;
    const result = await rewritePage(
      '<html><head><base href="https://evil.test"><link rel="stylesheet" href="https://x.test/site.css"></head><body><script>alert(1)</script><img src="https://x.test/missing.png" onerror="alert(1)"><iframe src="https://evil.test"></iframe></body></html>',
      "https://x.test/",
      async (url) => {
        const r = responses[url];
        if (!r) throw Error("missing");
        return {
          ...r,
          localPath:
            "assets/" + sequence++ + (r.mime === "text/css" ? ".css" : ".png"),
        };
      },
      async (path, text) => {
        saved[path] = text;
      },
    );
    expect(result.html).not.toContain("https://evil.test");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onerror");
    expect(result.html).not.toContain("https://x.test/missing.png");
    expect(result.warnings.length).toBe(1);
    expect(Object.values(saved).join("")).not.toContain("https://cdn.test");
    expect(Object.values(saved).join("")).toContain("url(");
  });
});

describe("browser capture metadata", () => {
  it("captures document.baseURI before removing base elements from the clone", async () => {
    const executablePath =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    let launchOptions = { headless: true };
    try {
      await access(executablePath);
      launchOptions = {
        ...launchOptions,
        executablePath,
      } as typeof launchOptions;
    } catch {}
    const browser = await chromium.launch(launchOptions);
    try {
      const page = await browser.newPage();
      await page.route("**/*", (route) =>
        route.request().isNavigationRequest()
          ? route.fulfill({
              contentType: "text/html",
              body: '<html><head><base href="https://cdn.test/assets/"><title>Base</title><style>.x{background:url(picture.png)}</style></head><body><p>Saved</p><a href="#section">Base-target link</a><svg><image href="picture.png"/></svg></body></html>',
            })
          : route.abort(),
      );
      await page.goto("https://origin.test/article");
      await page.evaluate(() => {
        window.captureMessages = [];
        window.ReactNativeWebView = {
          postMessage: (message) =>
            window.captureMessages.push(JSON.parse(message)),
        };
      });
      await page.addScriptTag({
        content: await readFile("assets/capture.webbundle", "utf8"),
      });
      await page.evaluate(() => window.RNReadCapture("base", "snapshot"));
      const messages = await page.evaluate(() => window.captureMessages);
      expect(messages[0]).toMatchObject({
        type: "CAPTURE_START",
        url: "https://origin.test/article",
        baseURI: "https://cdn.test/assets/",
      });
      expect(
        messages
          .filter((m) => m.type === "CAPTURE_CHUNK")
          .map((m) => m.data)
          .join(""),
      ).not.toContain("<base");
      expect(
        messages
          .filter((m) => m.type === "CAPTURE_CHUNK")
          .map((m) => m.data)
          .join(""),
      ).toContain('href="https://cdn.test/assets/#section"');
    } finally {
      await browser.close();
    }
  });
});

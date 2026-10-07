import { it, expect } from "vitest";
import { relocateContent } from "../src/core/relocate";
it("relocates custom-property and image-set candidate URLs and preserves MIME metadata", () => {
  const { head } = relocateContent(
    "",
    `<style>.x{--bg:url(assets/bg.png);background:var(--bg);background-image:image-set("assets/a.png" 1x type("image/png"))}</style>`,
    "../../offline/job/",
  );
  expect(head).toContain("../../offline/job/assets/bg.png");
  expect(head).toContain("../../offline/job/assets/a.png");
  expect(head).toContain('type("image/png")');
});
it("relocates inline CSS and local attributes without changing prose or external links", () => {
  const result = relocateContent(
    '<p>assets/not-a-url</p><img src="assets/a.png"><a href="https://x.test">link</a><div style="background:url(assets/bg.png)"></div>',
    '<link rel="stylesheet" href="assets/a.css"><style>.a{background:url(assets/c.png)}</style>',
    "../../offline/job/",
  );
  expect(result.html).toContain('src="../../offline/job/assets/a.png"');
  expect(result.html).toContain("../../offline/job/assets/bg.png");
  expect(result.html).toContain("assets/not-a-url");
  expect(result.html).toContain('href="https://x.test"');
  expect(result.head).toContain("../../offline/job/assets/c.png");
});

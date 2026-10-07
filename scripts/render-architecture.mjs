/**
 * 将架构文档的 Mermaid 图导出为 SVG 和可离线打开的 HTML。
 * Markdown 是唯一编辑源；导出时使用项目已安装的 Mermaid 和 Playwright。
 * 在项目根目录执行：node scripts/render-architecture.mjs
 */
import { chromium } from "@playwright/test";
import MarkdownIt from "markdown-it";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDirectory = join(projectDirectory, "docs");
const markdown = await readFile(
  join(docsDirectory, "项目架构与流程.md"),
  "utf8",
);
const diagrams = [
  ...markdown.matchAll(
    /<!-- diagram: ([a-z0-9-]+) -->\s*```mermaid\r?\n([\s\S]*?)^```/gm,
  ),
].map((match) => ({ name: match[1], source: match[2].trim() }));

// 每张图都必须具备稳定文件名，避免漏导出新增的 Mermaid 代码块。
const diagramCount = [...markdown.matchAll(/^```mermaid\s*$/gm)].length;
if (!diagrams.length || diagrams.length !== diagramCount) {
  throw Error("每个 Mermaid 代码块前都需要 <!-- diagram: 文件名 --> 标记");
}
if (new Set(diagrams.map((diagram) => diagram.name)).size !== diagrams.length) {
  throw Error("图表文件名不能重复");
}

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.setContent(
    '<!doctype html><html lang="zh-CN"><body></body></html>',
  );
  await page.addScriptTag({
    path: join(projectDirectory, "node_modules/mermaid/dist/mermaid.min.js"),
  });
  await page.evaluate(() => {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      themeVariables: {
        primaryColor: "#eef5fc",
        primaryTextColor: "#20313f",
        primaryBorderColor: "#52769a",
        lineColor: "#52769a",
        secondaryColor: "#f2f8f1",
        tertiaryColor: "#fff7e8",
        clusterBkg: "#fafbfd",
        clusterBorder: "#cbd8e4",
        fontSize: "16px",
      },
      flowchart: {
        useMaxWidth: false,
        htmlLabels: false,
        curve: "linear",
        padding: 16,
        nodeSpacing: 30,
        rankSpacing: 45,
      },
      sequence: { useMaxWidth: false, wrap: true, actorMargin: 35 },
    });
  });

  await mkdir(join(docsDirectory, "diagrams"), { recursive: true });
  for (const diagram of diagrams) {
    // 真正执行布局和 SVG 生成，同时验证图表语法，而不只是检查代码块存在。
    diagram.svg = await page.evaluate(async ({ name, source }) => {
      await window.mermaid.parse(source);
      const { svg } = await window.mermaid.render("rn-read-" + name, source);
      return svg;
    }, diagram);
    diagram.width = Number(
      diagram.svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/)[2],
    );
    await writeFile(
      join(docsDirectory, "diagrams", diagram.name + ".svg"),
      diagram.svg,
    );
    console.log("已绘制：" + diagram.name + ".svg");
  }
} finally {
  await browser.close();
}

const renderer = new MarkdownIt({ html: false, linkify: true });
const defaultFence = renderer.renderer.rules.fence;
let diagramIndex = 0;
renderer.renderer.rules.fence = (tokens, index, options, env, self) => {
  if (tokens[index].info.trim() !== "mermaid") {
    return defaultFence(tokens, index, options, env, self);
  }
  const diagram = diagrams[diagramIndex++];
  return `<figure class="diagram">
    <figcaption>
      <button type="button" data-zoom="out" aria-label="缩小图表">−</button>
      <button type="button" data-zoom="in" aria-label="放大图表">＋</button>
      <button type="button" data-zoom="reset">适配宽度</button>
      <a href="diagrams/${diagram.name}.svg" target="_blank" rel="noopener">打开 SVG</a>
    </figcaption>
    <div class="diagram-scroll"><div class="diagram-canvas" data-native-width="${diagram.width}" style="max-width:${diagram.width}px">${diagram.svg}</div></div>
  </figure>`;
};

// 标记仅供导出脚本识别，不把源码注释显示在阅读页面。
const body = renderer.render(
  markdown.replace(/<!-- diagram: [a-z0-9-]+ -->\s*/g, ""),
);
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RN Read：项目架构与流程</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; color: #20313f; font: 17px/1.85 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
    main { max-width: 1200px; margin: 0 auto; padding: 40px 24px 80px; }
    h1 { font-size: 32px; line-height: 1.4; }
    h2 { margin-top: 54px; font-size: 25px; line-height: 1.5; }
    a { color: #235b82; text-underline-offset: 3px; }
    pre { overflow: auto; padding: 20px; border-radius: 12px; background: #eaf0f5; font-size: 14px; line-height: 1.65; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; }
    :not(pre) > code { padding: 2px 5px; border-radius: 4px; background: #eaf0f5; }
    table { width: 100%; border-collapse: collapse; font-size: 15px; }
    th, td { padding: 10px 12px; border: 1px solid #d9e0e4; text-align: left; }
    th { background: #eaf0f5; }
    .diagram { margin: 24px 0; border: 1px solid #d9e0e4; border-radius: 12px; background: white; overflow: hidden; }
    figcaption { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px; border-bottom: 1px solid #eaf0f5; }
    button { min-height: 42px; padding: 6px 14px; border: 1px solid #cbd8e4; border-radius: 8px; color: #235b82; background: white; cursor: pointer; font: inherit; }
    button:hover { background: #eef5fc; }
    .diagram-scroll { overflow: auto; padding: 20px; }
    .diagram-canvas { width: 100%; margin: 0 auto; }
    .diagram-canvas > svg { display: block; width: 100%; height: auto; max-width: none !important; }
    .export-note { font-size: 14px; color: #566878; }
    @media (max-width: 600px) { main { padding: 20px 14px 50px; } h1 { font-size: 26px; } h2 { font-size: 22px; } table { font-size: 13px; } th, td { padding: 6px; } }
    @media print { body { background: white; } figcaption { display: none; } .diagram-scroll { overflow: visible; } }
  </style>
</head>
<body>
  <main>
    <p class="export-note">此页面从《项目架构与流程.md》生成，图表已绘制，无需联网。使用图表上方按钮放大，拖动滚动条查看；也可以打开单张 SVG。</p>
    ${body}
  </main>
  <script>
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-zoom]");
      if (!button) return;
      const canvas = button.closest("figure").querySelector(".diagram-canvas");
      const scale = Number(canvas.dataset.scale || 1);
      const next = button.dataset.zoom === "reset" ? 1 :
        Math.max(0.5, Math.min(4, scale + (button.dataset.zoom === "in" ? 0.25 : -0.25)));
      canvas.dataset.scale = String(next);
      if (button.dataset.zoom === "reset") {
        canvas.style.width = "100%";
        canvas.style.maxWidth = canvas.dataset.nativeWidth + "px";
      } else {
        const baseWidth = Math.min(Number(canvas.dataset.nativeWidth), canvas.parentElement.clientWidth - 40);
        canvas.style.maxWidth = "none";
        canvas.style.width = (baseWidth * next) + "px";
      }
    });
  </script>
</body>
</html>
`;
await writeFile(join(docsDirectory, "架构与流程图.html"), html);
console.log("已生成：docs/架构与流程图.html；共 " + diagrams.length + " 张图");

import MarkdownIt from "markdown-it";
import { headingId } from "./headings";

/** 创建共用的 Markdown 解析器，并为标题补上可跳转的 id。 */
export function createMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: true });
  md.core.ruler.push("heading_ids", (state) => {
    const used = new Set<string>();
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]!;
      if (token.type !== "heading_open") continue;
      const inline = state.tokens[i + 1];
      const text = (inline?.children ?? [])
        .filter((t) => ["text", "code_inline", "image"].includes(t.type))
        .map((t) => t.content)
        .join("");
      token.attrSet("id", headingId(text, used));
    }
  });
  return md;
}

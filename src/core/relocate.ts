import { parseDocument } from "htmlparser2";
import { findAll, getText } from "domutils";
import serialize from "dom-serializer";
import { Text } from "domhandler";
import * as css from "css-tree";
export function relocateContent(html: string, head: string, prefix: string) {
  const relocate = (value: string) =>
    value.startsWith("assets/") ? prefix + value : value;
  const style = (text: string, context: "stylesheet" | "declarationList") => {
    try {
      const ast = css.parse(text, { context, parseCustomProperty: true });
      css.walk(ast, (node) => {
        if (node.type === "Url") node.value = relocate(node.value);
        else if (
          node.type === "Function" &&
          /^(?:-webkit-)?image-set$/i.test(node.name)
        ) {
          node.children.forEach((child) => {
            if (child.type === "String") child.value = relocate(child.value);
          });
        }
      });
      return css.generate(ast);
    } catch {
      return "";
    }
  };
  const markup = (value: string) => {
    const doc = parseDocument(value);
    for (const el of findAll(() => true, doc.children)) {
      for (const attr of ["src", "href", "poster", "xlink:href"])
        if (el.attribs[attr]) el.attribs[attr] = relocate(el.attribs[attr]!);
      if (el.attribs.style)
        el.attribs.style = style(el.attribs.style, "declarationList");
      if (el.name === "style") {
        const node = new Text(style(getText(el), "stylesheet"));
        el.children = [node];
        node.parent = el;
      }
    }
    return serialize(doc);
  };
  return { html: markup(html), head: markup(head) };
}

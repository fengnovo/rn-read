/** 为标题生成稳定且不重复的 HTML 锚点，供目录跳转和阅读位置恢复使用。 */
export function headingId(text: string, used: Set<string>) {
  const base =
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  let id = base,
    duplicate = 1;
  while (used.has(id)) id = base + "-" + duplicate++;
  used.add(id);
  return id;
}

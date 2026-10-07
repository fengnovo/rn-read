export function resolveRelativePath(document: string, target: string): string {
  const value=decodeURIComponent(target.split(/[?#]/)[0] ?? '');
  if (!value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('/') || /[\\\0]/.test(value)) throw Error('链接超出授权目录');
  const parts=document.split('/').slice(0,-1);
  for (const part of value.split('/')) {
    if (!part || part==='.') continue;
    if (part==='..') { if (!parts.length) throw Error('链接超出授权目录'); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
export function normalizeBrowserUrl(value: string): string {
  const input=value.trim();
  const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(input)?input:'https://'+input);
  if (!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('请输入有效的 http/https 网页地址');
  return url.href;
}
export function sourceKey(uri: string): string {
  const url=new URL(uri);
  if(url.protocol==='content:') return url.host+':'+decodeURIComponent(url.pathname.split('/document/')[1] ?? url.pathname.split('/tree/')[1] ?? url.pathname);
  return url.href;
}

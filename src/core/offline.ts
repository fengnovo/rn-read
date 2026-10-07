import { parseDocument } from 'htmlparser2';
import { isTag, Text, type AnyNode, type Element } from 'domhandler';
import { getInnerHTML, removeElement } from 'domutils';
import render from 'dom-serializer';
import * as css from 'css-tree';

export interface DownloadedAsset { text:string; finalUrl:string; mime:string; localPath:string; }
type Download=(url:string)=>Promise<DownloadedAsset>;
const forbidden=new Set(['script','noscript','iframe','object','embed','form','input','button','textarea','select','base','meta','audio','video','source','track','applet','foreignobject','animate','animatemotion','animatetransform','set']);
function resolve(value:string,base:string):string|null {
  try {const url=new URL(value.trim(),base);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}
}
function relative(from:string,to:string) {
  const parts=from.split('/');parts.pop();const target=to.split('/');while(parts.length && parts[0]===target[0]){parts.shift();target.shift();}return [...parts.map(()=>'..'),...target].join('/');
}
const safeData=(value:string)=>/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value);

/** Return inert body markup and local-only stylesheet markup for the reader. */
export async function rewritePage(html:string,url:string,download:Download,write:(path:string,text:string)=>Promise<void>):Promise<{html:string;head:string;warnings:string[]}> {
  const warnings:string[]=[];const warningKeys=new Set<string>();
  const warn=(key:string,message:string)=>{if(!warningKeys.has(key)){warningKeys.add(key);warnings.push(message);}};
  const files=new Map<string,Promise<DownloadedAsset|null>>();const sheets=new Map<string,Promise<DownloadedAsset|null>>();
  async function file(address:string):Promise<DownloadedAsset|null> {
    const prior=files.get(address);if(prior)return prior;
    if(files.size>=500){warn('limit','资源数超过 500，部分资源未保存');return null;}
    const pending=(async()=>{try{return await download(address);}catch(error){if(error instanceof Error && (error.name==='AbortError'||error.name==='SaveLimitError'))throw error;warn(address,'资源未保存：'+address);return null;}})();files.set(address,pending);return pending;
  }
  async function asset(value:string,base:string,owner:string):Promise<string|null> {
    if(value.startsWith('#')||safeData(value))return value;
    const address=resolve(value,base);if(!address){warn(value,'不支持的资源：'+value);return null;}
    const parsed=new URL(address);const hash=parsed.hash;parsed.hash='';const result=await file(parsed.href);return result?relative(owner,result.localPath)+hash:null;
  }
  async function stylesheet(address:string,depth:number,ancestors:Set<string>):Promise<DownloadedAsset|null> {
    if(depth>8||ancestors.has(address)){warn('css:'+address,'样式导入循环或超过 8 层：'+address);return null;}
    const prior=sheets.get(address);if(prior)return prior;
    const pending=(async()=>{const downloaded=await file(address);if(!downloaded)return null;
      if(!/^text\/css(?:;|$)/i.test(downloaded.mime)){warn(address,'样式类型错误：'+address);return null;}
      const chain=new Set(ancestors);chain.add(address);chain.add(downloaded.finalUrl);
      const rewritten=await rewriteCSS(downloaded.text,downloaded.finalUrl,downloaded.localPath,'stylesheet',depth,chain);
      await write(downloaded.localPath,rewritten);return downloaded;
    })();sheets.set(address,pending);return pending;
  }
  async function rewriteCSS(text:string,base:string,owner:string,context:'stylesheet'|'declarationList',depth=0,ancestors=new Set<string>()):Promise<string> {
    let tree:css.CssNode;try{tree=css.parse(text,{context,parseCustomProperty:true});}catch{warn('css-parse:'+text,'无法解析部分样式');return '';}
    const edits:Array<()=>Promise<void>>=[];
    const visitor:css.EnterOrLeaveFn = function(node,item,list){
      if(node.type==='Atrule' && ['import','charset','namespace'].includes(node.name.toLowerCase())) {
        if(node.name.toLowerCase()!=='import'){if(item&&list)list.remove(item);return css.walk.skip;}
        const prelude=node.prelude;let source:css.StringNode|css.Url|null=null;
        if(prelude)css.walk(prelude,part=>{if(!source&&(part.type==='String'||part.type==='Url'))source=part;});
        const target=source as css.StringNode|css.Url|null;
        edits.push(async()=>{const address=target?resolve(target.value,base):null;const saved=address?await stylesheet(address,depth+1,ancestors):null;
          if(saved&&target)target.value=relative(owner,saved.localPath);else if(item&&list)list.remove(item);
        });return css.walk.skip;
      }
      if(node.type==='Declaration'&&node.value.type==='Raw') {
        if(item&&list)list.remove(item);warn('css-raw:'+node.property,'无法解析部分样式：'+node.property);return css.walk.skip;
      }
      if(node.type==='Raw') {if(item&&list)list.remove(item);return;}
      if(node.type==='Declaration' && (/^(?:behavior|-moz-binding)$/i.test(node.property)||css.generate(node.value).toLowerCase().includes('expression('))){if(item&&list)list.remove(item);return css.walk.skip;}
      if(node.type==='Url')edits.push(async()=>{node.value=(await asset(node.value,base,owner))??'data:,';});
      if(node.type==='Function' && /^(?:-webkit-)?image-set$/i.test(node.name)) {
        let candidate=true;
        node.children.forEach(part=>{
          if(part.type==='Operator'&&part.value===','){candidate=true;return;}
          if(part.type==='WhiteSpace')return;
          if(candidate&&part.type==='String')edits.push(async()=>{part.value=(await asset(part.value,base,owner))??'data:,';});
          candidate=false;
        });
      }
    };
    css.walk(tree,visitor);
    // Serial imports avoid await cycles between two concurrently discovered root sheets.
    for(const edit of edits)await edit();return css.generate(tree).replace(/<\/style/gi,'<\\/style');
  }
  const document=parseDocument(html);let body:Element|undefined;const head:string[]=[];const pendingAssets:Promise<void>[]=[];let assetError:unknown;
  const queueAsset=(task:Promise<void>)=>pendingAssets.push(task.catch(error=>{assetError??=error;}));
  async function visit(node:AnyNode):Promise<void> {
    if(!isTag(node))return;const name=node.name.toLowerCase();
    if(forbidden.has(name)){removeElement(node);return;}
    if(name==='body')body=node;
    if(name==='link') {
      if((node.attribs.rel??'').toLowerCase().split(/\s+/).includes('stylesheet')) {
        const address=resolve(node.attribs.href??'',url);const sheet=address?await stylesheet(address,0,new Set()):null;
        if(sheet){const media=node.attribs.media;const disabled='disabled' in node.attribs;node.attribs={rel:'stylesheet',href:sheet.localPath,...(media?{media}:{}),...(disabled?{disabled:''}:{})};head.push(render(node));}
      }
      removeElement(node);return;
    }
    if(name==='style') {const content=await rewriteCSS(getInnerHTML(node),url,'index.html','stylesheet');node.attribs=node.attribs.media?{media:node.attribs.media}:{};const text=new Text(content);text.parent=node;node.children=[text];head.push(render(node));removeElement(node);return;}
    for(const attribute of Object.keys(node.attribs)) {
      const lower=attribute.toLowerCase();const value=node.attribs[attribute]??'';
      if(lower.startsWith('on')||['srcset','imagesrcset','ping','srcdoc','action','formaction','autofocus','nonce','integrity','crossorigin'].includes(lower)){delete node.attribs[attribute];continue;}
      if(lower==='style'){node.attribs[attribute]=await rewriteCSS(value,url,'index.html','declarationList');continue;}
      if(lower==='href'||lower==='xlink:href') {
        if(name==='a'){const address=value.startsWith('#')?value:resolve(value,url);if(address)node.attribs[attribute]=address;else delete node.attribs[attribute];}
        else if(['image','use','feimage'].includes(name)){queueAsset(asset(value,url,'index.html').then(saved=>{if(saved)node.attribs[attribute]=saved;else delete node.attribs[attribute];}));}
        else delete node.attribs[attribute];continue;
      }
      if(['src','poster','background'].includes(lower)){queueAsset(asset(value,url,'index.html').then(saved=>{if(saved)node.attribs[attribute]=saved;else delete node.attribs[attribute];}));continue;}
      if(['fill','stroke','filter','clip-path','mask','cursor','marker-start','marker-mid','marker-end'].includes(lower)&&/url\s*\(/i.test(value)) {
        const rewritten=await rewriteCSS(`${lower}:${value}`,url,'index.html','declarationList');node.attribs[attribute]=rewritten.slice(rewritten.indexOf(':')+1);
      }
      if(/^(?:javascript|vbscript|file|blob):/i.test(value.trim()))delete node.attribs[attribute];
    }
    for(const child of [...node.children])await visit(child);
    if(name==='head')removeElement(node);
  }
  for(const child of [...document.children])await visit(child);
  await Promise.all(pendingAssets);if(assetError)throw assetError;
  // Documents captured without a body (Readability fragments) remain readable.
  let markup=body?getInnerHTML(body):getInnerHTML(document);
  if(!body) {const wrapper=document.children.find(node=>isTag(node)&&node.name==='html');if(wrapper&&isTag(wrapper))markup=getInnerHTML(wrapper);}
  return {html:markup,head:head.join(''),warnings};
}

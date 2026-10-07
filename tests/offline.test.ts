import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rewritePage } from '../src/core/offline';

function fixture(values:Record<string,{text?:string;mime?:string;finalUrl?:string}>) {
  const saved:Record<string,string>={}; const requested:string[]=[];
  return {saved,requested, download:async(url:string)=>{requested.push(url);const value=values[url];if(!value)throw Error('missing');return {text:value.text??'',mime:value.mime??'image/png',finalUrl:value.finalUrl??url,localPath:'assets/'+requested.length+(value.mime==='text/css'?'.css':'.png')};},write:async(path:string,text:string)=>{saved[path]=text;}};
}
describe('offline rewriting',()=>{
  it('serializes rewritten style text as CSS raw text without HTML entities',async()=>{
    const f=fixture({});const result=await rewritePage('<style>.quote::before{content:"A&B"}</style>','https://x.test/',f.download,f.write);
    expect(result.head).toContain('content:"A&B"');expect(result.head).not.toMatch(/&quot;|&amp;/);
  });
  it('localizes custom-property URL values in stylesheets and inline declarations',async()=>{
    const f=fixture({'https://x.test/remote.png':{}});
    const result=await rewritePage('<style>.x{--picture:url(https://x.test/remote.png);background:var(--picture)}</style><div style="--picture:url(remote.png);background:var(--picture)">Text</div>','https://x.test/',f.download,f.write);
    expect(f.requested).toEqual(['https://x.test/remote.png']);expect(result.head).toContain('--picture:url(assets/1.png)');expect(result.html).toContain('--picture:url(assets/1.png)');expect(result.head).not.toContain('https://');expect(result.warnings).toEqual([]);
  });
  it('removes unparseable custom-property values instead of retaining raw remote URLs',async()=>{
    const f=fixture({});const result=await rewritePage('<style>.x{--opaque:{background:url(https://remote.test/image.png)};color:red}</style><p>Readable</p>','https://x.test/',f.download,f.write);
    expect(result.head).not.toContain('https://remote.test');expect(result.head).not.toContain('--opaque');expect(result.head).toContain('color:red');expect(result.html).toContain('Readable');expect(result.warnings).toHaveLength(1);
  });
  it('rewrites only image-set image candidates and preserves MIME metadata strings',async()=>{
    const f=fixture({'https://x.test/one.png':{},'https://x.test/two.png':{}});
    const result=await rewritePage('<style>.x{background:image-set("one.png" type("image/png") 1x,url(two.png) type("image/png") 2x)}</style>','https://x.test/',f.download,f.write);
    expect(f.requested).toEqual(['https://x.test/one.png','https://x.test/two.png']);expect(result.head).toMatch(/image-set\("assets\/1\.png"\s*type\("image\/png"\) 1x,url\(assets\/2\.png\)\s*type\("image\/png"\) 2x\)/);expect(result.warnings).toEqual([]);
  });

  it('preserves stylesheet media conditions so print rules do not alter screen snapshots',async()=>{
    const f=fixture({'https://x.test/print.css':{mime:'text/css',text:'p{display:none}'}});
    const result=await rewritePage('<link rel="stylesheet" media="print" href="print.css"><style media="print">body{color:red}</style><p>Screen text</p>','https://x.test/',f.download,f.write);
    expect(result.head.match(/media="print"/g)).toHaveLength(2);expect(result.html).toContain('Screen text');
  });

  it('terminates CSS import cycles and rewrites imports relative to the saved CSS',async()=>{
    const f=fixture({'https://x.test/a.css':{mime:'text/css',text:'@import "b.css"; .a{color:red}'},'https://x.test/b.css':{mime:'text/css',text:'@import "a.css"; .b{color:blue}'}});
    const result=await rewritePage('<link rel="stylesheet" href="a.css"><p>hello</p>','https://x.test/',f.download,f.write);
    expect(result.head).toContain('assets/1.css');expect(result.html).toContain('hello');expect(f.requested).toHaveLength(2);
    expect(Object.values(f.saved).join('')).not.toContain('https://');expect(Object.values(f.saved).join('')).toContain('2.css');expect(result.warnings).toHaveLength(1);
  });
  it('rewrites inline CSS, SVG images and backgrounds while removing active attributes and responsive fallbacks',async()=>{
    const f=fixture({'https://x.test/image.png':{}});
    const result=await rewritePage('<html><head><style>.x{background:url(image.png)}</style></head><body><div style="background:url(image.png)" onclick="bad()"><svg><image href="image.png"/></svg><picture><source srcset="remote.png"><img src="image.png" srcset="remote.png 2x"></picture><a href="javascript:bad()">bad</a></div></body></html>','https://x.test/',f.download,f.write);
    expect(result.head).toContain('assets/1.png');expect(result.html).toContain('assets/1.png');expect(result.html).not.toMatch(/onclick|srcset|<source|javascript:/);expect(f.requested).toHaveLength(1);
  });
  it('removes failed remote CSS values and imports without affecting readable content',async()=>{
    const f=fixture({});const result=await rewritePage('<style>@import "missing.css";.x{background:url(blob:bad);color:red}</style><img src="missing.png"><a href="/next">Next</a><p>Readable</p>','https://x.test/',f.download,f.write);
    expect(result.head).not.toMatch(/missing|blob:/);expect(result.head).toContain('color:red');expect(result.html).not.toContain('missing.png');expect(result.html).toContain('https://x.test/next');expect(result.html).toContain('Readable');expect(result.warnings).toHaveLength(3);
  });
});

// Native boundaries are mocked; parsing, rewriting, save orchestration and manifests are real.
const native=vi.hoisted(()=>({files:new Map<string,{text:string;size:number}>(),responses:new Map<string,{text?:string;mime?:string;status?:number;bytes?:number;finalUrl?:string}>(),inFlight:0,maximum:0,cancelled:0,sequence:0}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},randomUUID:()=>String(++native.sequence),digestStringAsync:async(_algorithm:string,value:string)=>Array.from(value).map(c=>c.charCodeAt(0).toString(16)).join('')}));
vi.mock('../src/storage/files',()=>({
  uri:(path:string)=>'file:///memory/'+path,mkdir:async()=>{},
  write:async(path:string,text:string)=>{native.files.set(path,{text,size:text.length});},
  read:async(path:string)=>native.files.get(path)?.text??'',exists:async(path:string)=>native.files.has(path),
  size:async(path:string)=>[...native.files].filter(([name])=>name===path||name.startsWith(path+'/')).reduce((sum,[,file])=>sum+file.size,0),
  remove:async(path:string)=>{for(const name of native.files.keys())if(name===path||name.startsWith(path+'/'))native.files.delete(name);},
  move:async(from:string,to:string)=>{for(const [name,file] of [...native.files])if(name===from||name.startsWith(from+'/')){native.files.delete(name);native.files.set(to+name.slice(from.length),file);}},
}));
vi.mock('react-native-blob-util',()=>({default:{config:({path}:{path:string})=>({fetch:(_method:string,url:string)=>{
  native.inFlight++;native.maximum=Math.max(native.maximum,native.inFlight);let listener:(received:number,total:number)=>void=()=>{};
  let rejectRequest:(error:Error)=>void=()=>{};let settled=false;
  const finish=()=>{if(!settled){settled=true;native.inFlight--;}};
  const promise=new Promise((resolve,reject)=>{rejectRequest=reject;setTimeout(()=>{
    if(settled)return;const value=native.responses.get(url);if(!value){finish();reject(Error('missing'));return;}
    const bytes=value.bytes??(value.text??'image').length;listener(bytes,bytes);if(settled)return;
    native.files.set(path.replace('/memory/',''),{text:value.text??'',size:bytes});finish();resolve({respInfo:{status:value.status??200,headers:{'Content-Type':value.mime??'image/png'},redirects:[url,value.finalUrl??url],timeout:false}});
  },5);}) as Promise<unknown>&{cancel:()=>void;progress:(_options:unknown,callback:(received:number,total:number)=>void)=>unknown};
  promise.cancel=()=>{if(!settled){native.cancelled++;finish();rejectRequest(Error('cancelled'));}};
  promise.progress=(_options,callback)=>{listener=callback;return promise;};return promise;
}})}}));
import { OfflinePages } from '../src/services/offline';
import type { Library } from '../src/database/library';
import type { Resource } from '../src/core/types';
function fakeLibrary(old?:Resource,fail=false) {
  const jobs=new Set<string>();let stored=old;
  return {jobs,stored:()=>stored,library:{bySource:async()=>old,startJob:async(id:string)=>{jobs.add(id);},finishJob:async(id:string)=>{jobs.delete(id);},upsert:async(value:Resource)=>{if(fail)throw Error('database unavailable');stored=value;return value;}} as unknown as Library};
}
beforeEach(()=>{native.files.clear();native.responses.clear();native.inFlight=0;native.maximum=0;native.cancelled=0;native.sequence=0;});
describe('offline persistence',()=>{
  it('uses captured document base for relative styles and SVG while retaining source URL identity',async()=>{
    native.responses.set('https://cdn.test/assets/picture.png',{});
    const db=fakeLibrary();const resource=await new OfflinePages(db.library).save({html:'<style>.x{background:url(picture.png)}</style><div style="background:url(picture.png)" background="picture.png"><svg><image href="picture.png"/></svg></div>',url:'https://origin.test/article',baseURI:'https://cdn.test/assets/',title:'Base',mode:'snapshot'});
    expect(resource).toMatchObject({sourceKey:'web:snapshot:https://origin.test/article',sourceUri:'https://origin.test/article',status:'ready',warnings:[]});
    const content=JSON.parse(native.files.get(resource.localPath.replace('index.html','content.json'))!.text);expect(content.head).toContain('assets/');expect(content.html).toContain('assets/');expect(content.html).not.toContain('picture.png');
  });
  it('rejects unsafe or relative capture base metadata before creating a save job',async()=>{
    const db=fakeLibrary();for(const baseURI of ['file:///private/','javascript:bad()','/assets/'])await expect(new OfflinePages(db.library).save({html:'Text',url:'https://origin.test/article',baseURI,title:'Base',mode:'snapshot'})).rejects.toThrow();
    expect(db.jobs.size).toBe(0);expect(native.files.size).toBe(0);
  });

  it('keeps stable resource identity and progress while replacing only after commit',async()=>{
    const old:Resource={id:'stable',sourceKey:'web:snapshot:https://x.test/',type:'web',title:'Old',sourceUri:'https://x.test/',localPath:'offline/old/index.html',size:3,status:'ready',lastOpenedAt:1,position:{progress:.6},warnings:[],mode:'snapshot'};
    native.files.set(old.localPath,{text:'old',size:3});native.files.set('readers/stable/index.html',{text:'cached',size:6});
    const db=fakeLibrary(old);const result=await new OfflinePages(db.library).save({html:'<p>New</p>',url:'https://x.test/',title:'New',mode:'snapshot'});
    expect(result).toMatchObject({id:'stable',position:{progress:.6},status:'ready',title:'New'});expect(db.jobs.size).toBe(0);expect(native.files.has(old.localPath)).toBe(false);expect(native.files.has('readers/stable/index.html')).toBe(false);
    const directory=result.localPath.split('/').slice(0,-1).join('/');expect(JSON.parse(native.files.get(directory+'/content.json')!.text)).toEqual({html:'<p>New</p>',head:''});expect(native.files.get(result.localPath)!.text).toContain('../../runtime/runtime.js');
  });
  it('retains a completed manifest and save job for recovery when database commit fails',async()=>{
    const db=fakeLibrary(undefined,true);await expect(new OfflinePages(db.library).save({html:'<p>Saved</p>',url:'https://x.test/',title:'Test',mode:'reader'})).rejects.toThrow('database unavailable');
    expect(db.jobs.size).toBe(1);expect([...native.files.keys()].some(path=>path.startsWith('offline/')&&path.endsWith('/manifest.json'))).toBe(true);expect([...native.files.keys()].some(path=>path.startsWith('staging/'))).toBe(false);
  });
  it('downloads four resources concurrently and rejects oversize streamed responses',async()=>{
    for(let i=0;i<8;i++)native.responses.set('https://x.test/'+i+'.png',{});
    const db=fakeLibrary();const html=Array.from({length:8},(_,i)=>`<img src="${i}.png">`).join('');
    await new OfflinePages(db.library).save({html,url:'https://x.test/',title:'Test',mode:'reader'});expect(native.maximum).toBe(4);expect(native.inFlight).toBe(0);
    native.files.clear();native.responses.set('https://x.test/large.png',{bytes:101*1024*1024});
    await expect(new OfflinePages(db.library).save({html:'<img src="large.png">',url:'https://x.test/',title:'Big',mode:'reader'})).rejects.toMatchObject({name:'SaveLimitError'});expect(native.files.size).toBe(0);expect(db.jobs.size).toBe(0);
  });
  it('cancels active downloads and cleans staging after requests have settled',async()=>{
    for(let i=0;i<8;i++)native.responses.set('https://x.test/'+i+'.png',{});
    const db=fakeLibrary();const controller=new AbortController();
    const pending=new OfflinePages(db.library).save({html:Array.from({length:8},(_,i)=>`<img src="${i}.png">`).join(''),url:'https://x.test/',title:'Test',mode:'reader'},undefined,controller.signal);
    await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(native.inFlight).toBe(0);expect(native.cancelled).toBeGreaterThan(0);expect(db.jobs.size).toBe(0);expect(native.files.size).toBe(0);
  });
});

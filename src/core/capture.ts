import type { Capture } from './types';
export class CaptureReceiver {
  private meta:Omit<Capture,'html'>|null=null;
  private chunks:string[]=[]; private length=0; private expected=0;
  constructor(private id:string, private max=20*1024*1024) {}
  accept(message:unknown):Capture|null {
    if(!message || typeof message!=='object') return null;
    const m=message as Record<string,unknown>;
    if(m.id!==this.id) return null;
    if(m.type==='CAPTURE_ERROR') throw Error(typeof m.error==='string'?m.error:'网页捕获失败');
    if(m.type==='CAPTURE_START') {
      if(this.meta || !Number.isSafeInteger(m.length) || Number(m.length)<0 || Number(m.length)>this.max) throw Error('网页内容过大或捕获协议错误');
      if(typeof m.url!=='string' || typeof m.title!=='string' || !['snapshot','reader'].includes(String(m.mode))) throw Error('捕获元数据错误');
      const url=new URL(m.url); if(!['https:','http:'].includes(url.protocol)) throw Error('只支持公开网页');
      let baseURI:string|undefined;
      if(m.baseURI!==undefined) {
        if(typeof m.baseURI!=='string')throw Error('网页基础地址错误');
        const base=new URL(m.baseURI);if(!['https:','http:'].includes(base.protocol))throw Error('网页基础地址只支持 HTTP(S)');
        baseURI=base.href;
      }
      this.expected=Number(m.length); this.meta={title:m.title.slice(0,1000),url:m.url,...(baseURI?{baseURI}:{}),mode:m.mode as Capture['mode']};
    } else if(m.type==='CAPTURE_CHUNK') {
      if(!this.meta || m.index!==this.chunks.length || typeof m.data!=='string' || m.data.length>128*1024) throw Error('网页分块顺序错误');
      this.length+=m.data.length; if(this.length>this.expected || this.length>this.max) throw Error('网页捕获超出限额');
      this.chunks.push(m.data);
    } else if(m.type==='CAPTURE_END') {
      if(!this.meta || this.expected!==this.length) throw Error('网页捕获不完整');
      const result={...this.meta,html:this.chunks.join('')}; this.meta=null; this.chunks=[]; return result;
    }
    return null;
  }
}

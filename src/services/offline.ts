import * as Crypto from 'expo-crypto';
import BlobUtil, { type FetchBlobResponse, type StatefulPromise } from 'react-native-blob-util';
import { Library } from '../database/library';
import type { Capture, Resource } from '../core/types';
import { rewritePage, type DownloadedAsset } from '../core/offline';
import * as files from '../storage/files';
import { readerDocument } from '../web/templates';

const BUDGET=100*1024*1024;
const extensions:Record<string,string>={'text/css':'css','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/svg+xml':'svg','image/avif':'avif','image/bmp':'bmp','image/x-icon':'ico','font/woff':'woff','font/woff2':'woff2','font/ttf':'ttf','font/otf':'otf','application/font-woff':'woff','application/vnd.ms-fontobject':'eot','application/octet-stream':'bin'};
function failure(name:string,message:string){const error=new Error(message);error.name=name;return error;}
const abort=()=>failure('AbortError','保存已取消');
const overBudget=()=>failure('SaveLimitError','页面超过 100 MiB，保存已停止');

export class OfflinePages {
  private saving=false;
  constructor(private library:Library) {}
  async save(capture:Capture,onProgress?:(label:string)=>void,signal?:AbortSignal):Promise<Resource> {
    if(this.saving)throw Error('已有网页正在保存');
    if(signal?.aborted)throw abort();
    if(capture.html.length>20*1024*1024)throw Error('网页内容超过 20 MiB');
    const parsed=new URL(capture.url);if(!/^https?:$/.test(parsed.protocol))throw Error('仅支持保存 HTTP(S) 网页');
    const baseURI=capture.baseURI??capture.url;
    if(typeof baseURI!=='string'||!/^https?:$/.test(new URL(baseURI).protocol))throw Error('网页基础地址只支持 HTTP(S)');
    this.saving=true;
    const active=new Set<StatefulPromise<FetchBlobResponse>>();const queued:Array<()=>void>=[];
    let slots=0,completedBytes=0,fatal:Error|undefined,jobRecorded=false;
    const progress=new Map<string,number>();const downloads=new Set<Promise<DownloadedAsset>>();
    const stop=(error:Error)=>{fatal??=error;for(const request of active)request.cancel();for(const resume of queued.splice(0))resume();};
    const onAbort=()=>stop(abort());signal?.addEventListener('abort',onAbort);
    const check=()=>{if(signal?.aborted)throw abort();if(fatal)throw fatal;};
    const acquire=async()=>{check();if(slots>=4)await new Promise<void>(resume=>queued.push(resume));check();slots++;};
    const release=()=>{slots--;queued.shift()?.();};
    const job=Crypto.randomUUID(),staging='staging/'+job,final='offline/'+job;
    try {
      const key='web:'+capture.mode+':'+capture.url;const old=await this.library.bySource(key);const id=old?.id??Crypto.randomUUID();
      check();await this.library.startJob(job,id,staging,final);jobRecorded=true;await files.mkdir(staging+'/assets');check();
      const performDownload=async(address:string):Promise<DownloadedAsset>=>{
        await acquire();let request:StatefulPromise<FetchBlobResponse>|undefined;let path:string|undefined;
        try {
          check();const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,address);check();
          // Native writes response bytes directly to a file; binary assets never cross the JS bridge.
          path=staging+'/assets/'+digest+'.download';
          request=BlobUtil.config({path:decodeURIComponent(files.uri(path).replace(/^file:\/\//,'')),timeout:20_000,followRedirect:true}).fetch('GET',address,{'Accept':'text/css,image/*,font/*,application/font-woff,*/*;q=0.5'});
          active.add(request);const pending=request;
          request.progress({interval:100},(received,total)=>{
            progress.set(address,Number(received));const underway=[...progress.values()].reduce((sum,n)=>sum+n,0);
            if(Number(total)>BUDGET||completedBytes+underway>BUDGET)stop(overBudget());
            onProgress?.('下载资源 '+Math.round((completedBytes+underway)/1024)+' KiB');
          });
          const response=await pending;check();const info=response.respInfo;
          if(info.timeout||info.status<200||info.status>=300)throw Error('资源 HTTP '+info.status);
          const headers=Object.fromEntries(Object.entries(info.headers??{}).map(([name,value])=>[name.toLowerCase(),String(value)]));
          const mime=(headers['content-type']??'').split(';')[0]!.trim().toLowerCase();
          if(!extensions[mime])throw Error('不支持的资源类型：'+mime);
          const bytes=await files.size(path);progress.delete(address);completedBytes+=bytes;
          if(bytes>BUDGET||completedBytes+[...progress.values()].reduce((sum,n)=>sum+n,0)>BUDGET){stop(overBudget());throw fatal;}
          const localPath='assets/'+digest+'.'+extensions[mime];await files.move(path,staging+'/'+localPath);path=staging+'/'+localPath;
          const finalUrl=info.redirects?.[info.redirects.length-1]??address;
          if(!/^https?:$/.test(new URL(finalUrl).protocol))throw Error('不支持的重定向');
          // CSS alone enters JS for syntax-tree rewriting. Avoid reading unbounded text.
          if(mime==='text/css'&&bytes>20*1024*1024)throw Error('样式文件超过 20 MiB');
          const text=mime==='text/css'?await files.read(path):'';path=undefined;return {localPath,finalUrl,mime,text};
        }catch(error){if(fatal)throw fatal;throw error;}
        finally {if(request)active.delete(request);progress.delete(address);if(path)await files.remove(path).catch(()=>{});release();}
      };
      const download=async(address:string)=>{const task=performDownload(address);downloads.add(task);try{return await task;}finally{downloads.delete(task);}};
      onProgress?.('整理网页资源');const rewritten=await rewritePage(capture.html,baseURI,download,(path,text)=>files.write(staging+'/'+path,text));check();
      await files.write(staging+'/content.json',JSON.stringify({html:rewritten.html,head:rewritten.head}));
      await files.write(staging+'/index.html',readerDocument({html:rewritten.html,head:rewritten.head,position:old?.position},'../../runtime/runtime.js'));
      const measured=await files.size(staging);if(measured>BUDGET)throw overBudget();
      const value:Resource={id,sourceKey:key,type:'web',title:capture.title||capture.url,sourceUri:capture.url,localPath:final+'/index.html',size:measured,status:rewritten.warnings.length?'ready_with_warnings':'ready',lastOpenedAt:Date.now(),position:old?.position??{},warnings:rewritten.warnings,mode:capture.mode};
      await files.write(staging+'/manifest.json',JSON.stringify(value));
      value.size=await files.size(staging);if(value.size>BUDGET)throw overBudget();
      await files.write(staging+'/manifest.json',JSON.stringify(value));check();
      onProgress?.('保存离线副本');await files.move(staging,final);
      // From here, leave the complete manifest for recovery if the SQLite commit fails.
      const result=await this.library.upsert(value);await this.library.finishJob(job);jobRecorded=false;
      await files.remove('readers/'+id).catch(()=>{});
      if(old&&old.localPath!==result.localPath)await files.remove(old.localPath.split('/').slice(0,-1).join('/')).catch(()=>{});
      onProgress?.('保存完成');return result;
    }catch(error) {
      stop(error instanceof Error?error:Error('保存失败'));
      await Promise.allSettled([...downloads]);
      if(!(await files.exists(final+'/manifest.json'))) {await files.remove(staging);if(jobRecorded)await this.library.finishJob(job);}
      throw error;
    }finally {signal?.removeEventListener('abort',onAbort);this.saving=false;}
  }
}

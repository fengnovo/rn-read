export type ResourceType = 'markdown' | 'pdf' | 'web';
export type ResourceStatus = 'saving' | 'ready' | 'ready_with_warnings' | 'failed' | 'deleting';
export interface Position { version?:number; anchor?:string; offset?:number; progress?:number; scrollY?:number; page?:number; scale?:number; }
export interface Resource {
  id:string; sourceKey:string; type:ResourceType; title:string; sourceUri?:string; folderId?:string;
  relativePath?:string; localPath:string; size:number; status:ResourceStatus; lastOpenedAt:number;
  position:Position; warnings:string[]; mode?:'snapshot'|'reader';
}
export interface Folder { id:string; name:string; uri:string; bookmark?:string; lastPath:string; lastOpenedAt:number; }
export interface Capture { html:string; url:string; baseURI?:string; title:string; mode:'snapshot'|'reader'; }

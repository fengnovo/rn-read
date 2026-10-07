export function isReadableStatus(status:string):boolean { return status==='ready' || status==='ready_with_warnings'; }
export function restorePosition(position:{progress?:number;scrollY?:number},height:number,viewport:number):number {
  const max=Math.max(0,height-viewport);
  const y=typeof position.progress==='number' && Number.isFinite(position.progress)?position.progress*max:position.scrollY??0;
  return Math.min(max,Math.max(0,Number.isFinite(y)?y:0));
}

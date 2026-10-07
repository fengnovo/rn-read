export {};
declare global {
  interface Window {
    ReactNativeWebView?: {postMessage(message:string):void};
    RNReadCapture?: (id:string,mode:'reader'|'snapshot')=>Promise<void>;
    __RN_READ__?: any;
    RNRead?: {flush:()=>void;setTheme:(dark:boolean)=>void};
  }
}

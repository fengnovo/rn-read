export type RootStack = {
  Home: undefined;
  Reader: { id: string; initialAnchor?: string };
  Directory: { id: string; path?: string };
  Diagram: { svg: string };
  BrowserPage: { url: string };
  Settings: undefined;
};
export type Tabs = {
  Recent: undefined;
  Files: undefined;
  Offline: undefined;
  Browser: undefined;
};

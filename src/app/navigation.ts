/** 页面之间传递的路由参数；文档链接可附带 initialAnchor 定位到标题。 */
export type RootStack = {
  Home: undefined;
  Reader: { id: string; initialAnchor?: string };
  Directory: { id: string; path?: string };
  Diagram: { svg: string };
  BrowserPage: { url: string };
  Settings: undefined;
};

/** 应用底部四个主入口，各 tab 页面自行维护导航栈。 */
export type Tabs = {
  Recent: undefined;
  Files: undefined;
  Offline: undefined;
  Favorites: undefined;
  Browser: undefined;
};

# 应用最终修复记录

日期：2026-10-07。范围：广泛审查的六项具体问题（同页网页锚点与 Markdown/跨文件锚点分开计数），以及 Markdown 读取前的大小检查。未修改原生目录模块、iOS 或 Android 源码；工作区无 Git，未创建提交。

## 修复

1. **补全 Markdown 图片后重新加载正文**：每次成功准备关联文档建立新的阅读会话，并以会话版本作为 WebView 的 key。即使稳定 resource ID 和 `readers/<id>/index.html` URI 不变也会重新挂载；准备失败清除 busy。异步结果按原会话和存活状态检查，避免覆盖已经离开的阅读器。
2. **网页目录保持离线**：捕获 snapshot 与 Readability 内容时保留 `#fragment`，并把明确指向当前页面的绝对 URL 转回片段；其他页面继续保留在线 URL。
3. **Markdown 与跨文件定位**：生成 Unicode、重复标题可用的稳定 heading ID；现有已导入、没有 ID 的正文在 runtime 中使用相同规则补 ID。`.md#fragment` 经原生导航的 `initialAnchor` 传入目标模板，在图片、字体、Mermaid 和布局完成后定位；显式目标优先于旧阅读进度。runtime 禁用浏览器自动滚动恢复，避免 reload 的历史位置覆盖目标。
4. **文件/离线完整分页**：数据库先筛选类型和可读状态，再按时间与 ID 排序分页，每页 60 项。Files 包含 Markdown/PDF，Offline 包含网页，并均包含从最近移除的保存项。FlatList 到达末尾加载后续页、去重并在最后一页停止；Recent 继续保留原来的 200 项上限。
5. **后台恢复后刷新资料库**：先查询索引展示初始列表，后台 ready 完成后刷新当前列表。卸载/失焦后不触发恢复刷新，旧请求不覆盖新的结果。
6. **保存阅读尾部位置与退出 flush**：600 ms 窗口使用尾随定时器保存最新位置，串行执行数据库写入。blur、beforeRemove、AppState 后台和 cleanup 请求 runtime flush 并保存已收到的尾部位置；关闭或挂起会话收到的最后 POSITION 立即保存，并仍绑定原资源。HTML READY 前忽略 POSITION，未阅读的会话清理不会写回初始进度。
7. **Markdown 大小**：读取文本前检查本地文件字节大小是否超过 20 MiB；保留原来的读取后长度检查。

## 回归证据

新增 `tests/screens.test.ts` 使用真实 React ReaderScreen/LibraryScreen、真实 SQLite Library 与真实 prepareReader/template；只替换原生组件、文件平台和导航平台边界。覆盖同 URI 重挂载/READY、准备错误清 busy、尾随位置、READY 前保护、后台恢复、卸载保护、215 PDF + 205 网页混合分页、离线 215 项/忘记最近/加载结束、跨文件中文片段、cleanup 后最终 POSITION、blur/beforeRemove 和后台消息立即保存。

`tests/documents.test.ts` 通过真实 Documents.importFile 验证 Markdown 首标题、重复标题及中文标题 ID。`scripts/test-web.mjs` 从真实 Markdown 渲染器生成正文，经真实模板和本地 file:// runtime 验证英文/重复/Unicode 链接、跨文件目标的初始定位、没有 ID 的旧正文、恢复前不发 POSITION；捕获一个真实加载的受控网页，分别验证 snapshot/Readability 同页目录离线滚动。既有 CSP、无网络、本地图片、Mermaid 错误隔离、缓存、图表缩放/拖动检查保留。

修复前实际失败的行为包括：WebView 只挂载 1 次、准备失败 Busy 残留、300 ms 内第二次 POSITION 仍停留在 200 而非 400、READY 前进度被置零、恢复项未出现在列表、215 PDF 无法完整访问、跨文件路线缺少 initialAnchor、Markdown 无 heading ID、捕获同页链接被绝对化。后台 POSITION 回归还验证了挂起后收到 runtime 回包仍需立即保存。

## 最终检查

以下检查均在最终源文件格式化后执行，退出码均为 0：

- `npm test`：7 个测试文件、46 个测试通过。
- `npm run typecheck`：应用与 Web runtime TypeScript 检查通过。
- `npm run build:web-runtime`：本地 runtime/capture 两个 `.webbundle` 重建成功。
- `npm run test:web`：Chrome headless 实际 file:// 模板、Markdown、捕获、CSP/资源和图表验证通过。
- `npx prettier --write`：本次改变的 src/tests/scripts/package 文件格式化。

为 React 屏幕回归新增开发依赖 `react-test-renderer@19.2.3` 和其类型，package-lock 已更新。React renderer 的弃用提示来自测试工具；未改变应用运行依赖。

## 验证边界

本轮屏幕测试验证的是 React 生命周期与原生组件边界，浏览器测试运行在桌面 Chrome。本轮未执行更新后的原生 Release 构建、设备上 WebView 关联图片操作、真实 PDF 手势或 OS 杀进程位置验收；这些检查由主任务单独记录。退出时已收到的进度会 flush，晚到的 POSITION 在回调仍送达时也会保存；操作系统立即终止进程或原生 WebView 不再发送事件的情况仍需设备验收，不能凭这些测试保证消息必达。

## 主集成补充

复审六项均通过后，补测含外部 `<base href>` 的片段链接：先观察捕获错误地保留 `#section`，然后修正为仅当解析后的目的页等于当前页时保留片段，其余链接保持绝对地址。重建 bundles 后 46 项全测试、浏览器测试、类型与 Expo 兼容检查通过，复审确认无未解决问题。最终两端 Release 构建、重新安装启动、iOS 实际 manifest/删除恢复证据见验证记录.md。

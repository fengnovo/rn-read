# 网页离线保存实现验证

2026-10-07。

## 实现

`src/core/offline.ts` 是不依赖 React Native 或 Node 内置模块的 HTML/CSS 改写器。HTML 使用 htmlparser2/domutils/dom-serializer，CSS 使用 css-tree 的 AST。正文和安全样式头分开返回，原网页 script、事件、可执行链接、表单、frame/embed、meta/base、预连接/预加载和响应式 source/srcset 被移除。HTTP(S) 正文链接保留供 Reader 的受控导航处理。

捕获协议保存可选 `baseURI` 元数据，接收与保存入口仅接受绝对 HTTP(S) 地址。资源 URL 按捕获时的 document.baseURI（旧协议无此字段则使用页面 URL）或 CSS 最终响应 URL 解析；来源身份及重新访问地址始终使用 capture.url。内联 CSS、SVG image/use 引用、背景和 image-set 均改写为本地文件。CSS parser 启用 custom-property 语法解析；无法解析的 Raw declaration 连同潜在远程回退丢弃并警告。image-set 仅改写顶层图片候选，不修改 type() 中的 MIME 字符串。style 文本节点保留 parent 以按 CSS raw-text 序列化，不产生 &quot; 或 &amp; 实体。样式的 media 条件保留，CSS 内本地引用相对其自身文件目录生成。@import 最多 8 层、去重并检测循环。失败、blob 或不支持的资源形成警告并移除远程回退。最多下载 500 个不同 URL。

`src/services/offline.ts` 使用 react-native-blob-util 原生直接写文件，二进制不会变成 JS 的 arrayBuffer/Base64；仅 CSS 读取为文本。配置 4 个并发槽、20 秒请求超时，校验状态码和 MIME，从 native response 的 redirects 获取最终 URL。下载进度和落盘大小共同检查 100 MiB 总预算，CSS 单文本上限 20 MiB。取消停止活动请求、唤醒等待槽并等待下载结束后清理。

保存先写 save_job，再建立 staging；生成 content.json、index.html 和 Resource manifest 后在同一持久根移动至 offline/<job>，随后提交 Library 并结束任务。同来源 key 为 `web:<mode>:<url>`，重存保留 ID/阅读位置，提交成功后清 Reader 缓存并移除旧离线目录。若最终目录已经有完整 manifest 而数据库提交失败，保留最终目录和任务以供现有后台恢复对账。

## 验证证据

- 最先新增 CSS 循环、内联 CSS/SVG/响应式回退和失败资源测试；原 stub 3 个用例均失败。
- 新增 stylesheet media 回归用例，观察到失败后修复并通过。
- 初次审查回归添加后：raw style、custom-property、image-set 和 baseURI 共 8 个用例观察到失败；额外 Raw custom-property 的远程 URL 回归也先失败后修复。
- `npm test`：6 个文件，33 个用例全部通过；其中 core/offline 25 个用例。捕获 baseURI 用例运行真实 Chrome 和重新构建的 capture bundle。
- 独立 Chrome CSS 验证：computed ::before content 为 "A&B"，custom-property URL 和 image-set 使用本地路径且 type("image/png") 保留。
- `npm run test:web`：通过真实 file:// 模板、CSP、本地 runtime/image、无网络、Mermaid 隔离与缓存、事件净化、锚点/进度恢复及图表打开/双指/拖动/重置。
- `npm run build:web-runtime`：runtime 和 capture 的本地 bundle 已重建。
- 保存用例覆盖稳定身份/进度、旧副本提交后替换、数据库失败后的 manifest/任务保留、4 并发、超限取消和中止清理。原生边界使用内存文件系统及下载 mock；改写器与保存编排运行真实实现。
- `npm run typecheck`：主应用与 Web 两个 TypeScript 配置均通过。

## 尚需设备验收

这些测试不等同于 iOS/Android 真机结果。原生编译、真实 HTTP 重定向/超时/取消、跨平台文件 WebView、断网资源渲染和磁盘满恢复仍需两端设备验证。当前 DOM 没有的虚拟正文、未加载图片、canvas/WebGL、视频和复杂 iframe 不保证保存；主任务 UI 应显示这项边界。

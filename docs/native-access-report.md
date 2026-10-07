# 原生文档访问实施与检查

日期：2026-10-07。范围：`modules/document-access/**`；未修改应用入口、导航、存储服务或根配置。

## 已实现

- 本地 Expo Module `DocumentAccess`，Apple/Android autolinking 配置、podspec、Gradle 和 TypeScript 类型化接口。
- `identity`、`listDirectory`、`resolveRelative`、`copyToLocal`；bookmark 参数 JS 默认 null，两端 native 参数 nullable。
- Android SAF 以 authority + documentId 作为来源身份；ContentResolver 查询/流式读取，通过 DocumentsContract 的 tree/document/child API 定位目录和子文件。没有 content URI 字符串拼接。目录查询区分空结果、Provider 错误、Provider loading、权限异常。
- iOS 每次解析 bookmark，开启解析后授权根的 security scope，读完关闭；子文件操作同样开启目录根的 scope。使用 NSFileCoordinator 读/枚举，stale bookmark 刷新后由 identity/list/resolve 返回，同时返回单独的授权根 rootUri，应用需一起保存；原生读取副本前完成流式复制。
- iOS 优先 fileResourceIdentifier + volumeIdentifier 的归档哈希作为身份；没有 resource identifier 的 Provider 回退为规范化来源 URL。应用首次注册的 resourceId 仍需持久保存。
- 相对路径采用已解码的文件名分段，支持授权根内部 `../`，拒绝越根、绝对路径、scheme、反斜杠、NUL。百分号不在 native 层二次解码。路径包含检查会解析已存在和尚未创建目标的父级符号链接，包括 dangling symlink。
- 两端允许应用内 file URL 目录；复制目标限制为应用持久 Documents 根下文件。128 KiB 有界流、同目录临时文件、sync 后移动、错误清理，不采用大文件 Base64。已有目标拒绝覆盖，原文件不删除。

## 已执行检查

| 检查 | 实际结果 |
| --- | --- |
| `node modules/document-access/tests/run.mjs` | 28 个原生 helper 断言通过（包括目录移动后更新 rootUri/bookmark 并连续重新打开两次）；涵盖 Unicode/空格/百分号、dot segment、越根、scheme、符号链接与 dangling symlink、重复身份读取、不同文件身份、文件重命名后身份稳定 |
| `swiftc -parse` Swift 原生源码 | 通过 |
| iPhoneOS SDK / arm64 iOS 16.4 `swiftc -typecheck` | Foundation/CryptoKit API 和 Swift 类型检查通过；Expo DSL 使用临时 shim，因此不等同真实 Expo 编译或链接 |
| TypeScript wrapper 单文件类型检查 | `npx tsc --ignoreConfig --noEmit --target es2022 --moduleResolution bundler --module preserve --skipLibCheck modules/document-access/index.ts` 通过 |
| `ruby -c .../DocumentAccess.podspec` | Syntax OK |
| `expo-modules-autolinking resolve --platform apple` | 发现 DocumentAccess pod 与 DocumentAccessModule |
| `expo-modules-autolinking resolve --platform android` | 发现 document-access Gradle project 与 Kotlin module class |
| 实际 Android 全应用 `:app:assembleDebug` | 主集成修正 Gradle 代理后 BUILD SUCCESSFUL，包含 DocumentAccess Kotlin 编译 |
| 实际 iOS Expo module target 编译/链接 | `xcodebuild -project ios/Pods/Pods.xcodeproj -target DocumentAccess -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build` 退出 0，BUILD SUCCEEDED；arm64/x86_64 simulator 原生 target 编译通过，非整个应用验收 |
| 模拟器/真机 Provider 操作与性能 | 未执行 |

iOS 最新模块构建日志：`/tmp/rn-read-document-access-ios-moved-root.log`；原始日志：`/tmp/rn-read-document-access-ios.log`。构建有 CocoaPods/React 依赖的 umbrella header、架构和 build script 警告，未报告本模块 Swift 编译错误。Android 初次构建遇到 Google Maven TLS 错误；主集成临时指定系统代理后完整 Debug/Release 构建成功，日志 `/tmp/rn-read-android-build.log` 与 `/tmp/rn-read-android-release.log`。

## 自审与明确边界

接口与技术方案的权限层需求逐项对应；大文件只通过 native 流复制，Reader 应读取复制完成的应用内文件。权限生命周期在每次操作内部闭合，目录 bookmark 对子文件操作不会错误地只 scope 子 URI。

Android 持久 grant 的取得/释放由系统 picker 的长期授权选项负责，模块只使用已有 grant；重新安装、Provider 删除文件或用户撤权仍会失败。非 SAF content URI 与 Google Docs 虚拟文件导出不是此 API 的支持范围。

iOS 的 `.withSecurityScope` 创建/解析选项在 iOS SDK 明确不可用，采用 Apple 目录访问文档要求的 `.minimalBookmark` 并显式 start/stop。移动目录恢复依赖 bookmark 中记录的原始 `.pathKey`；旧 Provider bookmark 若省略原始路径，可能需要重新授权。`copyToLocal` 的既定 Promise<void> 接口无法返回续期 bookmark，应先调用 identity/resolve 并存储返回的 bookmark。

完成的文件通过同目录移动提交；进程被强杀可能留下 `.document-access-*.partial`，应用启动恢复需清理。设备权限、云 Provider 下载、重启后 bookmark/grant 恢复、磁盘不足、PDF 大文件时延与 P95 性能均没有以 helper 测试替代，需要后续模拟器/真机验收。

参考：[Expo Module API](https://docs.expo.dev/modules/module-api/)、[Expo 本地模块](https://docs.expo.dev/modules/get-started/)、[Apple 目录访问](https://developer.apple.com/documentation/uikit/providing-access-to-directories)、[Android DocumentsContract](https://developer.android.com/reference/android/provider/DocumentsContract)。模块配置参照已安装 Expo SDK 57 的 expo-file-system Gradle/podspec。

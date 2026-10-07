# RN Read

React Native 本地优先阅读器：浏览当前网页并保存阅读模式副本，离线阅读 Markdown（含 Mermaid 和相对图片）与 PDF，记录最近文件、授权目录、网页收藏和阅读位置。中文界面，跟随系统明暗主题。

初次了解项目，可以先看 [项目架构与流程（含通俗解释）](docs/项目架构与流程.md)，或用浏览器打开 [已绘制的架构与流程图](docs/架构与流程图.html)。

## 启动

需要 Node、Xcode/CocoaPods（iOS），或 Android SDK/JDK（Android）。项目使用 Expo Development Build，原生 PDF、目录权限模块需要编译；Expo Go 不适用。

```sh
npm install
npm run ios
# 或
npm run android
```

在已安装的 Android/iOS 模拟器上重新构建 Release 包、安装并启动：

```sh
npm run ios:release
npm run android:release
# 按顺序构建并启动两端
npm run simulators:release
```

脚本会优先选择当前已启动的模拟器；没有运行中的模拟器时，会自动启动一个可用的 iPhone Simulator 或 Android AVD。指定设备可分别设置 `IOS_SIMULATOR_ID` 或 `ANDROID_SERIAL`。Android SDK 可通过 `ANDROID_HOME`/`ANDROID_SDK_ROOT` 指定，JDK 可通过 `JAVA_HOME` 指定。构建产物位于 `android/app/build/outputs/apk/release/app-release.apk` 和临时目录下的 `rn-read-ios-release`。安装采用覆盖更新，通常会保留应用里的阅读记录和缓存。

macOS 如果命令行未找到 Java，可使用 Android Studio 自带的 JDK：

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npm run android
```

后续开发启动：

```sh
npm start
```

如果全局 npm 的 `allow-scripts` 配置阻止安装脚本，可执行 `npm install --ignore-scripts`，再显式运行 `npm run build:web-runtime`。

Markdown、Mermaid 和 Readability 运行代码已打包到 `assets/*.webbundle`。修改 `src/web` 后执行 `npm run build:web-runtime`；依赖更新时 postinstall 也会重建。发布构建包含这些资源，离线阅读不依赖 Metro 或 CDN。

## 使用

- 最近/文件：用 Markdown、PDF 独立按钮选择相应文件并保存本地副本；添加文件夹后可浏览子目录，下次回到上次路径。
- Markdown 单独选取文件时没有父目录权限；出现缺失图片提示后选择所在目录可重新导入并补全图片。目录内的 Markdown 文档链接可继续打开。
- 离线：直接打开保存的网页。浏览页输入地址，点击下载图标会直接保存阅读模式副本，完成后继续浏览；资源下载支持取消。
- 收藏：只保存网页地址和标题，点击收藏条目在线打开网页。收藏不会下载离线正文。
- 正文适配手机宽度，支持双指缩放。点击 Mermaid 图表进入独立的缩放/拖动查看器。PDF 保存页码和缩放比例。
- 长按条目管理记录和本地副本；存储管理可清理阅读缓存。清理不删除原文件。

保存的是当前已加载内容；虚拟列表中未加载正文、视频、canvas、复杂 iframe 和登录后才能下载的资源不能保证还原。云目录的长期权限不等于离线文件，已导入的副本可以离线打开。

## 检查

```sh
npm run typecheck
npm test
npm run test:web
node modules/document-access/tests/run.mjs
npx expo install --check
```

```
// 下载安卓apk
cd android/app/build/outputs/apk/release
python3 -m http.server 8000
```

浏览器测试默认使用已安装的 Chrome；无 Chrome 时先 `npx playwright install chromium`。原生构建、模拟器与真机验收分别记录，详见 [验证记录](docs/验证记录.md)。

[技术方案](docs/技术方案.md) · [实施清单](docs/实施清单.md) · [目录权限模块](modules/document-access/README.md)

Android [内部测试安装包](android/app/build/outputs/apk/release/app-release.apk)已构建，适用于 arm64 手机。使用开发签名，正式发布需配置独立签名。

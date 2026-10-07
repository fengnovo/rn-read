#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v xcodebuild >/dev/null 2>&1 || ! command -v xcrun >/dev/null 2>&1; then
  echo "需要安装 Xcode，并确保 xcodebuild 和 xcrun 可从命令行调用。" >&2
  exit 1
fi

APP_ID="$(node -e 'process.stdout.write(require("./app.json").expo.ios.bundleIdentifier)')"
SIMULATOR_ID="${IOS_SIMULATOR_ID:-}"

if [[ -z "$SIMULATOR_ID" ]]; then
  SIMULATOR_ID="$(xcrun simctl list devices booted -j | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const devices = Object.values(JSON.parse(input).devices).flat();
      const device = devices.find((item) => item.name.startsWith("iPhone")) || devices[0];
      if (device) process.stdout.write(device.udid);
    });
  ')"

  if [[ -z "$SIMULATOR_ID" ]]; then
    SIMULATOR_ID="$(xcrun simctl list devices available -j | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
        const devices = Object.values(JSON.parse(input).devices).flat();
        const device = devices.find((item) => item.name.startsWith("iPhone"));
        if (device) process.stdout.write(device.udid);
      });
    ')"
    if [[ -z "$SIMULATOR_ID" ]]; then
      echo "没有找到可用的 iPhone 模拟器。请在 Xcode 中安装 iOS Simulator Runtime。" >&2
      exit 1
    fi
    echo "启动 iPhone 模拟器：$SIMULATOR_ID"
    xcrun simctl boot "$SIMULATOR_ID"
  fi
fi

SIMULATOR_STATE="$(xcrun simctl list devices -j | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const devices = Object.values(JSON.parse(input).devices).flat();
    const device = devices.find((item) => item.udid === process.argv[1]);
    if (device) process.stdout.write(device.state);
  });
' "$SIMULATOR_ID")"
if [[ -z "$SIMULATOR_STATE" ]]; then
  echo "找不到指定的 iOS 模拟器：$SIMULATOR_ID" >&2
  exit 1
fi
if [[ "$SIMULATOR_STATE" != "Booted" ]]; then
  echo "启动 iOS 模拟器：$SIMULATOR_ID"
  xcrun simctl boot "$SIMULATOR_ID"
fi

echo "等待 iOS 模拟器启动：$SIMULATOR_ID"
xcrun simctl bootstatus "$SIMULATOR_ID" -b

XCODE_DEVELOPER_DIR="$(xcode-select -p)"
XCODE_APP_PATH="${XCODE_DEVELOPER_DIR%/Contents/Developer}"
DEVICE_HUB_APP="$XCODE_APP_PATH/Contents/Applications/DeviceHub.app"
SIMULATOR_APP="$XCODE_DEVELOPER_DIR/Applications/Simulator.app"
if [[ -d "$DEVICE_HUB_APP" ]]; then
  open -a "$DEVICE_HUB_APP" || true
elif [[ -d "$SIMULATOR_APP" ]]; then
  open -a "$SIMULATOR_APP" || true
fi

SYSTEM_TMP_DIR="${TMPDIR:-/tmp}"
SYSTEM_TMP_DIR="${SYSTEM_TMP_DIR%/}"
DERIVED_DATA_PATH="${RN_READ_IOS_BUILD_DIR:-$SYSTEM_TMP_DIR/rn-read-ios-release}"
BUILD_LOG_PATH="${RN_READ_IOS_BUILD_LOG:-$DERIVED_DATA_PATH/xcodebuild.log}"
mkdir -p "$DERIVED_DATA_PATH"
echo "构建 iOS Release：$DERIVED_DATA_PATH"
if ! NODE_ENV=production xcodebuild \
  -quiet \
  -workspace ios/RNRead.xcworkspace \
  -scheme RNRead \
  -configuration Release \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  build >"$BUILD_LOG_PATH" 2>&1; then
  echo "iOS 构建失败，最后 100 行日志：$BUILD_LOG_PATH" >&2
  tail -n 100 "$BUILD_LOG_PATH" >&2
  exit 1
fi

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphonesimulator/RNRead.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "构建完成后未找到应用：$APP_PATH" >&2
  exit 1
fi

echo "安装并启动 $APP_ID"
xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"
xcrun simctl launch "$SIMULATOR_ID" "$APP_ID"

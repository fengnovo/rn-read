#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ ! -d "$ANDROID_SDK" ]]; then
  echo "找不到 Android SDK：${ANDROID_SDK}。请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT。" >&2
  exit 1
fi
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

if [[ -z "${JAVA_HOME:-}" ]]; then
  ANDROID_STUDIO_JDK="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  if [[ -d "$ANDROID_STUDIO_JDK" ]]; then
    export JAVA_HOME="$ANDROID_STUDIO_JDK"
  elif command -v java >/dev/null 2>&1; then
    DETECTED_JAVA_HOME="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.home =/ { print $2; exit }')"
    if [[ -n "$DETECTED_JAVA_HOME" ]]; then
      export JAVA_HOME="$DETECTED_JAVA_HOME"
    else
      echo "无法从 java 命令确定 JDK 路径，请设置 JAVA_HOME。" >&2
      exit 1
    fi
  else
    echo "找不到 JDK。请设置 JAVA_HOME，或安装 Android Studio。" >&2
    exit 1
  fi
fi

ADB="$ANDROID_SDK/platform-tools/adb"
EMULATOR="$ANDROID_SDK/emulator/emulator"
if [[ ! -x "$ADB" ]]; then
  echo "找不到 adb：${ADB}。请在 Android Studio SDK Manager 安装 Android SDK Platform-Tools。" >&2
  exit 1
fi

DEVICE_SERIAL="${ANDROID_SERIAL:-}"
if [[ -n "$DEVICE_SERIAL" ]]; then
  if [[ "$("$ADB" -s "$DEVICE_SERIAL" get-state 2>/dev/null || true)" != "device" ]]; then
    echo "指定的 Android 设备不可用：$DEVICE_SERIAL" >&2
    exit 1
  fi
else
  DEVICE_SERIAL="$("$ADB" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
fi

if [[ -z "$DEVICE_SERIAL" ]]; then
  if [[ ! -x "$EMULATOR" ]]; then
    echo "没有运行中的 Android 模拟器，且找不到 emulator：$EMULATOR" >&2
    exit 1
  fi
  AVD_NAME="$("$EMULATOR" -list-avds | sed -n '1p')"
  if [[ -z "$AVD_NAME" ]]; then
    echo "没有可用的 Android 虚拟设备。请先在 Android Studio Device Manager 创建 AVD。" >&2
    exit 1
  fi
  echo "启动 Android 模拟器：$AVD_NAME"
  "$EMULATOR" -avd "$AVD_NAME" >/dev/null 2>&1 &

  BOOT_DEADLINE=$((SECONDS + 240))
  while [[ -z "$DEVICE_SERIAL" && $SECONDS -lt $BOOT_DEADLINE ]]; do
    DEVICE_SERIAL="$("$ADB" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
    [[ -n "$DEVICE_SERIAL" ]] || sleep 2
  done
  if [[ -z "$DEVICE_SERIAL" ]]; then
    echo "等待 Android 模拟器连接超时。请在 Android Studio 中检查 AVD 状态。" >&2
    exit 1
  fi
fi

echo "等待 Android 系统启动：$DEVICE_SERIAL"
BOOT_DEADLINE=$((SECONDS + 240))
until [[ "$("$ADB" -s "$DEVICE_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
  if (( SECONDS >= BOOT_DEADLINE )); then
    echo "等待 Android 系统启动超时：$DEVICE_SERIAL" >&2
    exit 1
  fi
  sleep 2
done

export PATH="$JAVA_HOME/bin:$ANDROID_SDK/platform-tools:$ANDROID_SDK/emulator:$PATH"
APP_ID="$(node -e 'process.stdout.write(require("./app.json").expo.android.package)')"
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"

echo "构建 Android Release APK"
(cd android && NODE_ENV=production ./gradlew --console=plain --quiet :app:assembleRelease)
if [[ ! -f "$APK_PATH" ]]; then
  echo "构建完成后未找到 APK：$APK_PATH" >&2
  exit 1
fi

echo "安装并启动 ${APP_ID}：$DEVICE_SERIAL"
"$ADB" -s "$DEVICE_SERIAL" install -r "$APK_PATH"
"$ADB" -s "$DEVICE_SERIAL" shell am start -W -n "$APP_ID/.MainActivity"

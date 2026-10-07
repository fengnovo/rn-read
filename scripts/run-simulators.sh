#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/run-ios-simulator.sh"
bash "$SCRIPT_DIR/run-android-emulator.sh"

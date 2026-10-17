#!/bin/bash
set -euo pipefail
# Simulator-only, synthetic data. Never connects to a study backend.
WP_SIMULATOR=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(x["udid"] for devices in d["devices"].values() for x in devices if x["name"].startswith("iPhone")))')
xcrun simctl boot "$WP_SIMULATOR"
xcrun simctl bootstatus "$WP_SIMULATOR" -b
xcrun simctl install "$WP_SIMULATOR" build/ios/Build/Products/Release-iphonesimulator/WellPingLocal.app
xcrun simctl launch "$WP_SIMULATOR" app.wellping.local
sleep 10
xcrun simctl spawn "$WP_SIMULATOR" launchctl list > simulator-processes.txt
# Launch success alone can miss a startup crash. Confirm the app survives.
grep -F 'app.wellping.local' simulator-processes.txt
xcrun simctl io "$WP_SIMULATOR" screenshot ios-first-launch.png
xcrun simctl terminate "$WP_SIMULATOR" app.wellping.local
xcrun simctl launch "$WP_SIMULATOR" app.wellping.local
sleep 5
xcrun simctl spawn "$WP_SIMULATOR" launchctl list > simulator-processes.txt
grep -F 'app.wellping.local' simulator-processes.txt
xcrun simctl io "$WP_SIMULATOR" screenshot ios-reopen.png
xcrun simctl shutdown "$WP_SIMULATOR"

"""Exercise one saved survey transition in a synthetic Android install."""
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "app.wellping.local"

def adb(*args):
    return subprocess.check_output(["adb", *args], text=True).strip()

def screen(name):
    adb("shell", "uiautomator", "dump", "/sdcard/wellping-ui.xml")
    adb("pull", "/sdcard/wellping-ui.xml", name)
    return ET.parse(name).getroot()

def fingerprint(root):
    return [(n.get("text", ""), n.get("content-desc", "")) for n in root.iter("node")
            if n.get("package") == PACKAGE and (n.get("text") or n.get("content-desc"))]

def launch():
    adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
    time.sleep(8)
    assert adb("shell", "pidof", PACKAGE), "App exited after launch"

adb("install", "-r", "preview/app-release.apk")
launch()
first = screen("android-first-launch.xml")
assert any("synthetic local test" in text for text, _ in fingerprint(first)), "Local questionnaire did not render"
button = next(n for n in first.iter("node") if n.get("content-desc") == "Prefer not to answer the current question")
x1, y1, x2, y2 = map(int, re.findall(r"\d+", button.get("bounds")))
adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))
time.sleep(4)
progress = fingerprint(screen("android-saved-progress.xml"))
assert progress != fingerprint(first), "Survey did not advance"
assert any("Prefer not to answer" in label or "Saved on this test device" in text for text, label in progress), "Expected next question or completion"
adb("shell", "am", "force-stop", PACKAGE)
launch()
reopened = fingerprint(screen("android-reopened.xml"))
# Choice order is randomized on mount; compare the complete text/label multiset.
assert sorted(reopened) == sorted(progress), "Saved survey screen changed after force-close and reopen"
with open("android-reopened.png", "wb") as output:
    subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=output, check=True)
Path("android-result.json").write_text(json.dumps({"launch": "passed", "survey_transition": "passed", "force_close_resume": "passed"}, indent=2))
print("PASS: standalone Android launch, questionnaire transition, force-close and saved-question resume")

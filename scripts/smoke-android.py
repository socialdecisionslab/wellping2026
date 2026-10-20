"""Exercise one durable survey transition in a synthetic Android install."""
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "app.wellping.local"
PNA_LABEL = "Prefer not to answer the current question"


def adb(*args):
    return subprocess.check_output(["adb", *args], text=True).strip()


def screen(name):
    adb("shell", "uiautomator", "dump", "/sdcard/wellping-ui.xml")
    adb("pull", "/sdcard/wellping-ui.xml", name)
    return ET.parse(name).getroot()


def fingerprint(root):
    return [(n.get("text", ""), n.get("content-desc", ""))
            for n in root.iter("node")
            if n.get("package") == PACKAGE and
            (n.get("text") or n.get("content-desc"))]


def answer_button(root):
    return next((n for n in root.iter("node")
                 if n.get("package") == PACKAGE and
                 n.get("content-desc") == PNA_LABEL and
                 n.get("enabled") == "true"), None)


def wait_for_screen(name, predicate, timeout=90):
    """Loading/header visibility is not evidence that a durable survey is ready."""
    deadline = time.monotonic() + timeout
    while True:
        root = screen(name)
        if predicate(root):
            return root
        if time.monotonic() >= deadline:
            raise AssertionError(f"Timed out waiting for the expected {name} screen")
        time.sleep(1)


def launch():
    adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
    assert adb("shell", "pidof", PACKAGE), "App exited after launch"


def main():
    adb("install", "-r", "preview/app-release.apk")
    launch()
    first = wait_for_screen("android-first-launch.xml", lambda root:
                            any("synthetic local test" in text
                                for text, _ in fingerprint(root)) and
                            answer_button(root) is not None)
    button = answer_button(first)
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", button.get("bounds")))
    adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))

    def advanced(root):
        values = fingerprint(root)
        return (sorted(values) != sorted(fingerprint(first)) and
                (answer_button(root) is not None or
                 any("Saved on this test device" in text for text, _ in values)))

    progress = fingerprint(wait_for_screen("android-saved-progress.xml", advanced))
    adb("shell", "am", "force-stop", PACKAGE)
    launch()
    # Choice presentation may be randomized; compare the full text/label multiset.
    wait_for_screen("android-reopened.xml", lambda root:
                    sorted(fingerprint(root)) == sorted(progress))
    with open("android-reopened.png", "wb") as output:
        subprocess.run(["adb", "exec-out", "screencap", "-p"],
                       stdout=output, check=True)
    Path("android-result.json").write_text(json.dumps({
        "launch": "passed", "survey_transition": "passed",
        "force_close_resume": "passed"}, indent=2))
    print("PASS: Android launch, durable questionnaire readiness, transition and saved-question resume")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        Path("android-result.json").write_text(json.dumps({
            "status": "failed", "category": "runtime",
            "errorType": type(error).__name__}, indent=2))
        with open("android-failure.png", "wb") as output:
            subprocess.run(["adb", "exec-out", "screencap", "-p"],
                           stdout=output, check=False)
        raise

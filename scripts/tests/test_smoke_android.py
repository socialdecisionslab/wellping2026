"""Regressions for the loading screen observed in Android CI artifact 12143027430."""
import importlib.util
import pathlib
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

script = pathlib.Path(__file__).resolve().parents[1] / "smoke-android.py"
spec = importlib.util.spec_from_file_location("smoke_android", script)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def ui(body):
    return ET.fromstring('<hierarchy>' + body + '</hierarchy>')


class SurveyReadiness(unittest.TestCase):
    def test_header_and_loading_are_not_a_ready_survey(self):
        loading = ui('<node package="app.wellping.local" text="Well Ping — synthetic local test"/>')
        ready = ui('<node package="app.wellping.local" content-desc="Prefer not to answer the current question" enabled="true"/>')
        with patch.object(smoke, "screen", side_effect=[loading, ready]) as read, \
             patch.object(smoke.time, "sleep"):
            self.assertIs(smoke.wait_for_screen("screen.xml", lambda r: smoke.answer_button(r) is not None), ready)
            self.assertEqual(read.call_count, 2)

    def test_disabled_control_does_not_pass_readiness(self):
        disabled = ui('<node package="app.wellping.local" content-desc="Prefer not to answer the current question" enabled="false"/>')
        self.assertIsNone(smoke.answer_button(disabled))

    def test_another_app_cannot_satisfy_the_control_check(self):
        other = ui('<node package="other.app" content-desc="Prefer not to answer the current question" enabled="true"/>')
        self.assertIsNone(smoke.answer_button(other))

    def test_stuck_loading_fails_instead_of_certifying_a_launch(self):
        with patch.object(smoke, "screen", return_value=ui("")), \
             patch.object(smoke.time, "monotonic", side_effect=[0, 1, 91]), \
             patch.object(smoke.time, "sleep"):
            with self.assertRaisesRegex(AssertionError, "Timed out"):
                smoke.wait_for_screen("screen.xml", lambda _: False)


if __name__ == "__main__":
    unittest.main()

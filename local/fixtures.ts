import existing from "../local/debug/DEBUG_STUDY.json";
import quick from "./synthetic-study.json";

export type Questionnaire = "existing" | "quick";

export function getLocalFixture(questionnaire: Questionnaire) {
  if (questionnaire === "quick") return quick;
  // Keep question wording, branching and response codes unchanged. Replace only
  // the study envelope; this fixture is never an enrollment configuration.
  const fixture = JSON.parse(JSON.stringify(existing));
  fixture.studyInfo.id = "local_existing_questionnaire";
  fixture.studyInfo.server = {};
  fixture.studyInfo.studyFileURL = "https://example.invalid/local-study.json";
  fixture.studyInfo.consentFormUrl = "https://example.invalid/consent";
  delete fixture.studyInfo.dashboardURL;
  delete fixture.studyInfo.contactEmail;
  return fixture;
}

export function getLocalStream(questionnaire: Questionnaire) {
  return questionnaire === "existing" ? "myStream" : "synthetic";
}

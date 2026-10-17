"use strict";
(() => {
  const byId = (id) => document.getElementById(id);
  const emptyHistory = () => ({
    format: "wellping-study-history",
    schemaVersion: 1,
    revisions: [],
  });
  let history = emptyHistory();
  let responseData = null;
  let responseGeneration = 0;
  let operationInFlight = false;
  function updateControls() {
    for (const control of document.querySelectorAll(
      "button,input,textarea,select",
    ))
      control.disabled = operationInFlight;
    byId("clear-responses").disabled = false;
    for (const id of ["download-responses", "download-summary", "project"])
      byId(id).disabled = operationInFlight || !responseData;
  }
  const status = (text, error = false) => {
    byId("status").textContent = text;
    byId("status").className = error ? "error" : "";
  };
  async function api(body) {
    const response = await fetch("/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wellping-Console": "1",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Local validation failed.");
    return data.result;
  }
  const readEditor = () => JSON.parse(byId("editor").value);
  const showStudy = (study) => {
    byId("editor").value = JSON.stringify(study, null, 2);
  };
  function download(name, data, type = "application/json") {
    const url = URL.createObjectURL(
      new Blob(
        [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
        { type },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const run = (fn) => async () => {
    if (operationInFlight) {
      status(
        "Please wait for the current operation to finish, then retry.",
        true,
      );
      return;
    }
    operationInFlight = true;
    updateControls();
    try {
      await fn();
    } catch (_) {
      status(
        "Operation could not be completed. Check the input, schema, unique version/session IDs and study selection. Original files were not changed.",
        true,
      );
    } finally {
      operationInFlight = false;
      updateControls();
    }
  };
  function renderHistory() {
    const select = byId("revisions");
    select.replaceChildren();
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = "Choose a saved revision to inspect";
    select.append(prompt);
    history.revisions.forEach((r, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${r.study.studyInfo.version} · ${r.createdAt}`;
      select.append(option);
    });
    byId(
      "history-summary",
    ).textContent = `${history.revisions.length} immutable revisions in this tab. Download history to retain them. Questionnaire-content checksums detect content changes, not author identity or metadata/order changes.`;
  }
  function renderResponses() {
    const tbody = byId("sessions");
    tbody.replaceChildren();
    const has = !!responseData;
    for (const id of ["download-responses", "download-summary", "project"])
      byId(id).disabled = !has;
    if (!has) {
      byId("totals").textContent = "No response exports loaded.";
      byId("times-output").textContent = "No imported timestamps.";
      return;
    }
    const t = responseData.totals;
    byId(
      "totals",
    ).textContent = `Study ${responseData.studyId}: ${t.sessions} sessions · ${t.completed} completed · ${t.incomplete} incomplete · ${t.answers} answers. Counts describe only imported files.`;
    responseData.sessions.forEach((s) => {
      const tr = document.createElement("tr");
      [
        s.participant,
        s.sessionId,
        s.completed,
        s.incomplete,
        s.answers,
        "Unknown: no backend/delivery receipt",
      ].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.append(td);
      });
      tbody.append(tr);
    });
  }
  byId("create").onclick = run(async () => {
    const study = await api({
      action: "create",
      input: {
        id: byId("study-id").value,
        version: byId("version").value,
        contactEmail: byId("email").value,
        consentFormUrl: byId("consent").value,
      },
    });
    showStudy(study);
    status(
      "Draft template created. Replace example content before study use; nothing was published.",
    );
  });
  byId("study-file").onchange = run(async () => {
    const file = byId("study-file").files[0];
    if (!file) return;
    const study = await api({
      action: "validate",
      study: JSON.parse(await file.text()),
    });
    showStudy(study);
    status("Study imported and validated. Source file unchanged.");
  });
  byId("validate").onclick = run(async () => {
    await api({ action: "validate", study: readEditor() });
    status(
      "Draft matches the app schema and checked graph references. Protocol/device review is still required.",
    );
  });
  byId("revision").onclick = run(async () => {
    history = await api({ action: "revision", history, study: readEditor() });
    renderHistory();
    status(
      "New immutable revision saved in this tab. Download history before closing.",
    );
  });
  byId("revisions").onchange = () => {
    const index = byId("revisions").value;
    if (index !== "") showStudy(history.revisions[Number(index)].study);
  };
  byId("download-study").onclick = run(async () => {
    const study = await api({ action: "validate", study: readEditor() });
    download("wellping-study.json", study);
    status(
      "Validated study download prepared. No backend publishing occurred.",
    );
  });
  byId("download-history").onclick = run(async () => {
    download(
      "wellping-study-history.json",
      await api({ action: "history", history }),
    );
    status(
      "Revision history download prepared. Store it in approved institutional storage.",
    );
  });
  byId("history-file").onchange = run(async () => {
    const file = byId("history-file").files[0];
    if (!file) return;
    if (history.revisions.length) {
      status(
        "Download your current history first, then restore the other archive in a new tab. Existing revisions were preserved.",
        true,
      );
      return;
    }
    const candidate = await api({
      action: "history",
      history: JSON.parse(await file.text()),
    });
    history = candidate;
    renderHistory();
    if (history.revisions.length) showStudy(history.revisions.at(-1).study);
    status(
      "Questionnaire-content checksums verified and history restored in this tab. Timestamps/order are not authenticated. Source file unchanged.",
    );
  });
  byId("schedule").onclick = run(async () => {
    byId("schedule-output").textContent = JSON.stringify(
      await api({
        action: "schedule",
        study: readEditor(),
        timeZone: byId("zone").value,
      }),
      null,
      2,
    );
    status(
      "Schedule review ready. Viewing zone does not change mobile scheduling.",
    );
  });
  byId("response-files").onchange = run(async () => {
    const generation = ++responseGeneration;
    const files = Array.from(byId("response-files").files);
    if (!files.length) return;
    const study = await api({ action: "validate", study: readEditor() });
    const contents = await Promise.all(files.map((file) => file.text()));
    const candidate = await api({
      action: "exports",
      exports: contents,
      studyId: study.studyInfo.id,
    });
    if (generation !== responseGeneration) return;
    responseData = candidate;
    byId("times-output").textContent = "No imported timestamps.";
    renderResponses();
    status(
      "Session exports validated locally. No delivery or backend success is inferred.",
    );
  });
  byId("clear-responses").onclick = () => {
    responseGeneration++;
    responseData = null;
    byId("response-files").value = "";
    renderResponses();
    status(
      "Imported responses cleared from this tab. Original files were not changed.",
    );
  };
  byId("download-responses").onclick = run(async () => {
    if (!responseData) return;
    download("wellping-response-bundle.json", {
      format: "wellping-response-bundle",
      schemaVersion: 1,
      exports: responseData.exports,
    });
    status(
      "Validated response bundle download prepared. Original coding and incomplete records retained.",
    );
  });
  byId("download-summary").onclick = run(async () => {
    if (!responseData) return;
    const cell = (value) => {
      let text = String(value);
      const first = [...text].find(
        (char) =>
          char.charCodeAt(0) > 32 &&
          char.charCodeAt(0) !== 127 &&
          !/\s/.test(char),
      );
      if (first && "=+@-".includes(first)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [
      [
        "participant",
        "session",
        "completed",
        "incomplete",
        "answers",
        "delivery_evidence",
      ],
      ...responseData.sessions.map((s) => [
        s.participant,
        s.sessionId,
        s.completed,
        s.incomplete,
        s.answers,
        "unknown",
      ]),
    ];
    download(
      "wellping-completion-summary.csv",
      rows.map((row) => row.map(cell).join(",")).join("\r\n"),
      "text/csv",
    );
    status(
      "Completion CSV prepared. It contains identifiers/counts, not answer content or verified delivery status.",
    );
  });
  byId("project").onclick = run(async () => {
    if (!responseData) return;
    const generation = responseGeneration;
    const projections = [];
    for (const file of responseData.exports)
      projections.push({
        sessionId: file.participant.sessionId,
        pings: await api({
          action: "project",
          export: file,
          timeZone: byId("zone").value,
        }),
      });
    if (generation !== responseGeneration) return;
    byId("times-output").textContent = JSON.stringify(projections, null, 2);
    status(
      "Absolute timestamps projected; original timezone offsets and source exports unchanged.",
    );
  });
})();

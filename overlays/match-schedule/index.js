(function () {
  "use strict";

  const DATA_URL = "../../data/schedule.json";
  const STORAGE_KEY = "vct.match-schedule.data";
  const MAX_LIST_ITEMS = 5;

  const fallbackData = {
    timezone: "Asia/Kuala_Lumpur",
    matches: []
  };

  const dom = {
    body: document.body,
    recentList: document.getElementById("recentList"),
    upcomingList: document.getElementById("upcomingList"),
    nextMatch: document.getElementById("nextMatch"),
    connectionChip: document.getElementById("connectionChip"),
    diagnosticsPanel: document.getElementById("diagnosticsPanel"),
    controlStatus: document.getElementById("controlStatus"),
    reloadDataButton: document.getElementById("reloadDataButton"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    clearStorageButton: document.getElementById("clearStorageButton")
  };

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get("debug") === "1";
  const freshData = params.get("fresh") === "1";
  const layer = normaliseLayer(params.get("layer"));
  const diagnostics = {
    json: "loading",
    recent: 0,
    upcoming: 0,
    next: "-"
  };

  let scheduleData = structuredClone(fallbackData);
  let previousSignature = "";

  dom.body.dataset.layer = layer;
  if (debugMode) dom.body.classList.add("debug");

  start();

  async function start() {
    wireControls();
    scheduleData = await loadScheduleData();
    render();
  }

  function wireControls() {
    dom.reloadDataButton.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEY);
      scheduleData = await loadScheduleData();
      render();
    });

    dom.jsonFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const json = JSON.parse(await file.text());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        scheduleData = normaliseSchedule(json);
        render();
        setControlStatus(`Loaded ${file.name}. This schedule is saved in this browser until cleared.`);
      } catch (error) {
        setControlStatus(`Could not load ${file.name}: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    dom.clearStorageButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      setControlStatus("Saved browser schedule cleared. Use Reload JSON to read the repo data again.");
    });
  }

  async function loadScheduleData() {
    const saved = freshData ? null : localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setControlStatus("Loaded saved browser schedule. Clear it to use the repo data file again.");
        setDiagnostics({ json: "loaded browser storage" });
        return normaliseSchedule(JSON.parse(saved));
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setDiagnostics({ json: `loaded ${DATA_URL}` });
      setControlStatus(`Loaded ${DATA_URL}.`);
      return normaliseSchedule(await response.json());
    } catch (error) {
      setDiagnostics({ json: `fallback: ${error.message}` });
      setControlStatus(`Using empty schedule. Could not read ${DATA_URL}: ${error.message}`);
      return normaliseSchedule(fallbackData);
    }
  }

  function render() {
    const schedule = buildSchedule(scheduleData.matches);
    const signature = JSON.stringify(schedule);
    if (signature === previousSignature) return;
    previousSignature = signature;

    renderList(dom.recentList, schedule.recent, "No recent matches");
    renderList(dom.upcomingList, schedule.upcoming, "No upcoming matches");
    renderNext(schedule.next);

    setDiagnostics({
      recent: schedule.recent.length,
      upcoming: schedule.upcoming.length,
      next: schedule.next ? formatPlayers(schedule.next) : "-"
    });
  }

  function buildSchedule(matches) {
    const completed = matches
      .filter((match) => match.status === "completed")
      .sort((a, b) => b.sortTime - a.sortTime);
    const pending = matches
      .filter((match) => match.status !== "completed")
      .sort((a, b) => a.sortTime - b.sortTime);
    const explicitNext = pending.find((match) => match.status === "next");
    const next = explicitNext || pending[0] || null;
    const upcoming = pending.filter((match) => match !== next);

    return {
      recent: completed.slice(0, MAX_LIST_ITEMS),
      upcoming: upcoming.slice(0, MAX_LIST_ITEMS),
      next
    };
  }

  function renderList(container, matches, emptyText) {
    container.innerHTML = "";
    if (!matches.length) {
      container.appendChild(createEmptyCard(emptyText));
      return;
    }

    matches.forEach((match) => container.appendChild(createMatchCard(match, false)));
  }

  function renderNext(match) {
    dom.nextMatch.innerHTML = "";
    dom.nextMatch.appendChild(match ? createNextCard(match) : createEmptyCard("No match queued"));
  }

  function createMatchCard(match, isNext) {
    const card = document.createElement("article");
    card.className = isNext ? "schedule-card is-next" : "schedule-card";

    const copy = document.createElement("div");
    copy.className = "match-copy";

    const round = document.createElement("div");
    round.className = "match-round";
    round.textContent = match.round || "Match";

    const players = document.createElement("div");
    players.className = "match-players";
    players.textContent = formatPlayers(match);

    const meta = document.createElement("div");
    meta.className = "match-meta";
    meta.textContent = formatMeta(match);

    const result = document.createElement("div");
    result.className = "match-result";
    result.appendChild(createResultText(match));
    if (!isNext && match.status === "completed") {
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = "final";
      result.appendChild(label);
    }

    copy.append(round, players, meta);
    card.append(copy, result);
    return card;
  }

  function createNextCard(match) {
    const card = document.createElement("article");
    card.className = "next-strip";

    const detail = document.createElement("div");
    detail.className = "next-detail";

    const round = document.createElement("div");
    round.className = "next-round";
    round.textContent = match.round || "Match";

    const time = document.createElement("div");
    time.className = "next-time";
    time.textContent = formatTime(match) || "TBD";

    const players = document.createElement("div");
    players.className = "next-players";
    players.textContent = formatPlayers(match);

    const status = document.createElement("div");
    status.className = "next-status";
    status.textContent = formatNextStatus(match);

    detail.append(round, time);
    card.append(detail, players, status);
    return card;
  }

  function createEmptyCard(text) {
    const card = document.createElement("div");
    card.className = "schedule-card is-empty";
    card.textContent = text;
    return card;
  }

  function createResultText(match) {
    const value = document.createElement("span");
    if (match.status === "completed") {
      value.textContent = `${match.score.left} - ${match.score.right}`;
    } else if (match.status === "live") {
      value.textContent = "LIVE";
    } else if (match.status === "next") {
      value.textContent = "NEXT";
    } else {
      value.textContent = formatTime(match) || "TBD";
    }
    return value;
  }

  function formatPlayers(match) {
    return `${match.players.left} vs ${match.players.right}`;
  }

  function formatNextStatus(match) {
    if (match.status === "live") return "LIVE NOW";
    if (match.status === "next") return "NEXT";
    return formatTime(match) || "TBD";
  }

  function formatMeta(match) {
    const showTimeInMeta = match.status !== "scheduled";
    return [
      showTimeInMeta ? formatTime(match) : "",
      match.bestOf ? `BO${match.bestOf}` : "",
      match.note
    ].filter(Boolean).join(" / ");
  }

  function formatTime(match) {
    if (!match.date) return cleanText(match.timeLabel || match.timeText || "");

    try {
      return new Intl.DateTimeFormat("en-MY", {
        timeZone: scheduleData.timezone,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(match.date);
    } catch (error) {
      return cleanText(match.timeLabel || match.timeText || "");
    }
  }

  function normaliseSchedule(source) {
    const timezone = cleanText(source?.timezone) || fallbackData.timezone;
    const values = Array.isArray(source) ? source : source?.matches || source?.schedule || [];
    return {
      timezone,
      matches: values.map((match, index) => normaliseMatch(match, index)).filter(Boolean)
    };
  }

  function normaliseMatch(match, index) {
    if (!match || typeof match !== "object") return null;

    const players = match.players || {};
    const score = match.score || {};
    const leftScore = numberOrNull(score.left ?? match.leftScore ?? match.scoreLeft);
    const rightScore = numberOrNull(score.right ?? match.rightScore ?? match.scoreRight);
    const status = normaliseStatus(match.status || match.state, leftScore, rightScore);
    const date = parseDate(match.time || match.startTime || match.startsAt || match.date);

    return {
      id: cleanText(match.id || `match-${index + 1}`),
      round: cleanText(match.round || match.stage || match.title),
      timeLabel: cleanText(match.timeLabel || match.timeText),
      date,
      sortTime: date ? date.getTime() : Number.MAX_SAFE_INTEGER - index,
      players: {
        left: cleanText(players.left || players.player1 || match.leftPlayer || match.player1 || match.team1) || "TBD",
        right: cleanText(players.right || players.player2 || match.rightPlayer || match.player2 || match.team2) || "TBD"
      },
      score: {
        left: leftScore ?? 0,
        right: rightScore ?? 0
      },
      winner: normaliseSide(match.winner),
      status,
      bestOf: numberOrNull(match.bestOf || match.best_of || match.bo),
      note: cleanText(match.note || match.detail || "")
    };
  }

  function normaliseStatus(value, leftScore, rightScore) {
    const status = cleanText(value).toLowerCase();
    if (["completed", "complete", "finished", "done", "final"].includes(status)) return "completed";
    if (["next", "coming-up-next", "coming up next"].includes(status)) return "next";
    if (["live", "playing", "in-progress", "in progress"].includes(status)) return "live";
    if (leftScore !== null || rightScore !== null) return "completed";
    return "scheduled";
  }

  function setDiagnostics(next) {
    Object.assign(diagnostics, next);
    dom.connectionChip.textContent = diagnostics.json;
    if (!debugMode) return;

    dom.diagnosticsPanel.textContent = [
      "VCT match schedule diagnostics",
      `JSON: ${diagnostics.json}`,
      `Recent: ${diagnostics.recent}`,
      `Upcoming: ${diagnostics.upcoming}`,
      `Next: ${diagnostics.next}`
    ].join("\n");
  }

  function setControlStatus(message) {
    dom.controlStatus.textContent = message || "";
  }

  function parseDate(value) {
    const text = cleanText(value);
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normaliseSide(value) {
    const text = cleanText(value).toLowerCase();
    if (["1", "left", "player1", "team1"].includes(text)) return "left";
    if (["2", "right", "player2", "team2"].includes(text)) return "right";
    return "";
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cleanText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function normaliseLayer(value) {
    return ["background", "hud", "full"].includes(value) ? value : "full";
  }
})();

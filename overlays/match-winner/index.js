(function () {
  "use strict";

  const DATA_URL = "../../data/match.json";
  const STORAGE_KEY = "vct.match.data";
  const SCORE_OVERRIDE_KEY = "vct.match.score-override";
  const MATCH_STATE_KEY = "vct.match-mappool.state";
  const DEFAULT_TOSU_HOST = "127.0.0.1:24050";
  const STAGES = [
    { acronym: "RO32", label: "Round of 32" },
    { acronym: "RO16", label: "Round of 16" },
    { acronym: "QF", label: "Quarterfinals" },
    { acronym: "SF", label: "Semifinals" },
    { acronym: "F", label: "Finals" },
    { acronym: "GF", label: "Grand Finals" }
  ];

  const fallbackData = {
    stage: "Round of 32",
    players: {
      left: { name: "Player Left" },
      right: { name: "Player Right" }
    },
    winner: "",
    score: { left: 0, right: 0 }
  };

  const dom = {
    body: document.body,
    winnerName: document.getElementById("winnerName"),
    stageName: document.getElementById("stageName"),
    scoreLine: document.getElementById("scoreLine"),
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
  const staticMode = params.get("static") === "1";
  const forcedWinner = normaliseSide(params.get("winner"));
  const stageParam = cleanText(params.get("stage") || params.get("round"));
  const tosuHost = params.get("tosu") || (location.port === "24050" ? location.host : DEFAULT_TOSU_HOST);
  const socketUrl = `ws://${tosuHost}/ws`;
  const diagnostics = {
    json: "loading",
    socket: staticMode ? "static mode" : "starting",
    stage: "-",
    winner: "-"
  };

  let matchData = structuredClone(fallbackData);
  let liveState = createEmptyLiveState();
  let socket = null;
  let reconnectTimer = null;
  let renderQueued = false;

  if (debugMode) dom.body.classList.add("debug");

  start();

  async function start() {
    wireControls();
    matchData = normaliseMatch(await loadMatchData());
    queueRender();
    if (!staticMode) connectTosu();
  }

  function wireControls() {
    dom.reloadDataButton.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEY);
      matchData = normaliseMatch(await loadMatchData());
      queueRender();
    });

    dom.jsonFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const json = JSON.parse(await file.text());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        matchData = normaliseMatch(json);
        queueRender();
        setControlStatus(`Loaded ${file.name}.`);
      } catch (error) {
        setControlStatus(`Could not load ${file.name}: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    dom.clearStorageButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      setControlStatus("Saved browser JSON cleared.");
    });

    window.addEventListener("storage", (event) => {
      if (event.key === SCORE_OVERRIDE_KEY || event.key === MATCH_STATE_KEY) queueRender();
    });
  }

  async function loadMatchData() {
    const saved = freshData ? null : localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setDiagnostics({ json: "loaded browser storage" });
        return JSON.parse(saved);
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setDiagnostics({ json: `loaded ${DATA_URL}` });
      return response.json();
    } catch (error) {
      setDiagnostics({ json: `fallback: ${error.message}` });
      setControlStatus(`Using placeholder data. Could not read ${DATA_URL}.`);
      return structuredClone(fallbackData);
    }
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    const score = resolveScore();
    const side = resolveWinnerSide(score);
    const winner = resolvePlayer(side);

    dom.winnerName.textContent = winner.name;
    dom.stageName.textContent = resolveStage();
    dom.scoreLine.textContent = `${score.left} - ${score.right}`;
    fitWinnerName(winner.name);

    setDiagnostics({
      stage: resolveStage(),
      winner: `${winner.name} (${side || "unresolved"})`
    });
  }

  function resolveStage() {
    if (stageParam) return normaliseStage(stageParam);

    try {
      const state = JSON.parse(localStorage.getItem(MATCH_STATE_KEY) || "{}");
      return normaliseStage(state.stageOverride) || matchData.stage;
    } catch (error) {
      return matchData.stage;
    }
  }

  function resolveWinnerSide(score = resolveScore()) {
    if (forcedWinner) return forcedWinner;
    if (score.left !== score.right) return score.left > score.right ? "left" : "right";
    if (matchData.winner) return matchData.winner;
    return "left";
  }

  function resolvePlayer(side) {
    const liveName = cleanText(liveState.players[side]?.name);
    return {
      name: liveName || matchData.players[side].name
    };
  }

  function resolveScore() {
    const saved = readScoreOverride();
    if (saved.enabled) return { left: saved.left, right: saved.right };
    if (liveState.stars.left || liveState.stars.right) return liveState.stars;
    return matchData.score;
  }

  function readScoreOverride() {
    try {
      const saved = JSON.parse(localStorage.getItem(SCORE_OVERRIDE_KEY) || "{}");
      if (saved.enabled !== true) return { enabled: false, left: 0, right: 0 };

      return {
        enabled: true,
        left: numberOrZero(saved.left),
        right: numberOrZero(saved.right)
      };
    } catch (error) {
      localStorage.removeItem(SCORE_OVERRIDE_KEY);
      return { enabled: false, left: 0, right: 0 };
    }
  }

  function connectTosu() {
    clearTimeout(reconnectTimer);

    socket = new ReconnectingSocket(socketUrl, {
      onOpen() {
        dom.connectionChip.textContent = "tosu connected";
        setDiagnostics({ socket: "connected" });
        setControlStatus("Connected to tosu.");
      },
      onClose() {
        dom.connectionChip.textContent = "tosu offline";
        setDiagnostics({ socket: "closed / blocked" });
      },
      onMessage(event) {
        try {
          liveState = extractLiveState(JSON.parse(event.data));
          queueRender();
        } catch (error) {
          console.warn("Could not parse tosu payload", error);
        }
      }
    });
  }

  function extractLiveState(data) {
    const manager = data?.tourney?.manager || {};
    const teamName = manager.teamName || {};
    const stars = manager.stars || {};

    return {
      players: {
        left: { name: cleanText(teamName.left || manager.team?.left || "") },
        right: { name: cleanText(teamName.right || manager.team?.right || "") }
      },
      stars: {
        left: numberOrZero(stars.left),
        right: numberOrZero(stars.right)
      }
    };
  }

  function normaliseMatch(source) {
    const scene = source?.scenes?.winner || source?.winnerScene || {};
    const players = scene.players || source?.players || source?.teams || {};
    const score = scene.score || source?.score || source?.stars || {};

    return {
      stage: cleanText(scene.stage || source?.stage || source?.round || source?.title) || fallbackData.stage,
      players: {
        left: normalisePlayer(players.left || players.red || source?.leftPlayer || source?.playerLeft || source?.leftTeam || source?.teamLeft, fallbackData.players.left),
        right: normalisePlayer(players.right || players.blue || source?.rightPlayer || source?.playerRight || source?.rightTeam || source?.teamRight, fallbackData.players.right)
      },
      winner: normaliseSide(scene.winner || scene.winningSide || scene.winningPlayer || source?.winner || source?.winningSide || source?.winningPlayer),
      score: {
        left: numberOrZero(score.left),
        right: numberOrZero(score.right)
      }
    };
  }

  function normalisePlayer(value, fallback) {
    if (typeof value === "string") {
      return { name: cleanText(value) || fallback.name };
    }

    return {
      name: cleanText(value?.name || value?.player || value?.team || value?.label) || fallback.name
    };
  }

  function fitWinnerName(value) {
    const length = cleanText(value).length;
    const size = Math.max(38, Math.min(64, 70 - Math.max(0, length - 12) * 1.15));
    dom.winnerName.style.setProperty("--winner-size", `${size}px`);
  }

  function setDiagnostics(next) {
    Object.assign(diagnostics, next);
    if (!debugMode) return;

    dom.diagnosticsPanel.textContent = [
      "VCT winner diagnostics",
      `JSON: ${diagnostics.json}`,
      `Tosu: ${diagnostics.socket}`,
      `WS: ${socketUrl}`,
      `Stage: ${diagnostics.stage}`,
      `Winner: ${diagnostics.winner}`
    ].join("\n");
  }

  function normaliseStage(value) {
    const text = cleanText(value);
    if (!text) return "";
    return stageInfo(text).label;
  }

  function stageInfo(value) {
    const text = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const match = STAGES.find((stage) => {
      const label = stage.label.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const acronym = stage.acronym.toLowerCase();
      return text === label || text === acronym;
    });

    return match || { acronym: cleanText(value).toUpperCase() || "RO32", label: cleanText(value) || fallbackData.stage };
  }

  function setControlStatus(message) {
    dom.controlStatus.textContent = message || "";
  }

  function normaliseSide(value) {
    const text = cleanText(value).toLowerCase();
    if (["1", "left", "blue", "playerone", "player one", "p1"].includes(text)) return "left";
    if (["2", "right", "red", "playertwo", "player two", "p2"].includes(text)) return "right";
    return "";
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function cleanText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function createEmptyLiveState() {
    return {
      players: {
        left: { name: "" },
        right: { name: "" }
      },
      stars: {
        left: 0,
        right: 0
      }
    };
  }

  class ReconnectingSocket {
    constructor(url, handlers) {
      this.url = url;
      this.handlers = handlers;
      this.closedByUser = false;
      this.retryDelay = 1200;
      this.connect();
    }

    connect() {
      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        this.scheduleReconnect();
        return;
      }

      this.ws.addEventListener("open", () => {
        this.retryDelay = 1200;
        this.handlers.onOpen?.();
      });

      this.ws.addEventListener("message", (event) => this.handlers.onMessage?.(event));
      this.ws.addEventListener("close", () => {
        this.handlers.onClose?.();
        this.scheduleReconnect();
      });

      this.ws.addEventListener("error", () => {
        this.ws.close();
      });
    }

    scheduleReconnect() {
      if (this.closedByUser) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        this.retryDelay = Math.min(this.retryDelay * 1.35, 6000);
        this.connect();
      }, this.retryDelay);
    }
  }
})();

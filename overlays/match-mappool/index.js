(function () {
  "use strict";

  const MAPPOOL_URL = "../../data/mappool.cache.json";
  const MATCH_URL = "../../data/match.json";
  const STORAGE_KEY = "vct.match-mappool.data";
  const STATE_STORAGE_KEY = "vct.match-mappool.state";
  const SCORE_OVERRIDE_KEY = "vct.match.score-override";
  const DEFAULT_TOSU_HOST = "127.0.0.1:24050";
  const ASSET_VERSION = "20260730a";
  const EMPTY_POINT = `../../assets/vct/match/point_empty.png?v=${ASSET_VERSION}`;
  const FULL_POINT = `../../assets/vct/match/point_full.png?v=${ASSET_VERSION}`;
  const ROW_ORDER = ["RC", "LN", "HB", "SV", "MD", "NM", "HD", "HR", "DT", "FM", "TB"];
  const GAMEPLAY_STATE = 3;
  const RESULT_STATE = 4;
  const IDLE_STATES = new Set([0, 1, 2]);
  const PICK_TO_GAMEPLAY_MS = 20000;
  const RESULT_HOLD_MS = 30000;
  const STAGES = [
    { acronym: "RO32", label: "Round of 32" },
    { acronym: "RO16", label: "Round of 16" },
    { acronym: "QF", label: "Quarterfinals" },
    { acronym: "SF", label: "Semifinals" },
    { acronym: "F", label: "Finals" },
    { acronym: "GF", label: "Grand Finals" }
  ];

  const fallbackMatch = {
    stage: "Round of 32",
    bestOf: 9,
    players: {
      left: { name: "Player Left", seed: "" },
      right: { name: "Player Right", seed: "" }
    },
    commentators: []
  };

  const fallbackMaps = [
    { pick: "NM1", title: "Waiting for mappool data", artist: "VCT", difficulty: "Mappool", mapper: "VCT Staff" },
    { pick: "NM2", title: "Add maps to data/mappool.cache.json", artist: "VCT", difficulty: "Mappool", mapper: "VCT Staff" }
  ];

  const dom = {
    body: document.body,
    leftSeed: document.getElementById("leftSeed"),
    rightSeed: document.getElementById("rightSeed"),
    leftName: document.getElementById("leftName"),
    rightName: document.getElementById("rightName"),
    leftStars: document.getElementById("leftStars"),
    rightStars: document.getElementById("rightStars"),
    matchScore: document.getElementById("matchScore"),
    stageLabel: document.getElementById("stageLabel"),
    leftPickBadge: document.getElementById("leftPickBadge"),
    rightPickBadge: document.getElementById("rightPickBadge"),
    poolBoard: document.getElementById("poolBoard"),
    chatList: document.getElementById("chatList"),
    commentatorList: document.getElementById("commentatorList"),
    connectionChip: document.getElementById("connectionChip"),
    diagnosticsPanel: document.getElementById("diagnosticsPanel"),
    controlStatus: document.getElementById("controlStatus"),
    stageButton: document.getElementById("stageButton"),
    actionButton: document.getElementById("actionButton"),
    actionSignButton: document.getElementById("actionSignButton"),
    sceneButton: document.getElementById("sceneButton"),
    undoButton: document.getElementById("undoButton"),
    autoPickButton: document.getElementById("autoPickButton"),
    autoSceneButton: document.getElementById("autoSceneButton"),
    reloadDataButton: document.getElementById("reloadDataButton"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    clearStorageButton: document.getElementById("clearStorageButton")
  };

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get("debug") === "1";
  const freshData = params.get("fresh") === "1";
  const staticMode = params.get("static") === "1";
  const layer = normaliseLayer(params.get("layer"));
  const initialActivePick = cleanText(params.get("pick") || params.get("current"));
  const initialPickingSide = normaliseSide(params.get("turn") || params.get("picking"));
  const initialAutoPick = params.get("autoPick") !== "0";
  const initialAutoScene = params.get("autoScene") !== "0";
  const tosuHost = params.get("tosu") || (location.port === "24050" ? location.host : DEFAULT_TOSU_HOST);
  const socketUrl = `ws://${tosuHost}/ws`;
  const diagnostics = {
    match: "loading",
    mappool: "loading",
    socket: staticMode ? "static mode" : "starting",
    players: "-",
    score: "-",
    map: "-"
  };

  let matchData = structuredClone(fallbackMatch);
  let maps = [];
  let liveState = createEmptyLiveState();
  let interactionState = createInteractionState();
  let previousState = null;
  let poolSignature = "";
  let previousIpcState = null;
  let gameplayTimer = null;
  let resultTimer = null;
  let lastAutoPickKey = "";
  let socket = null;
  let reconnectTimer = null;
  let renderQueued = false;

  dom.body.dataset.layer = layer;
  if (debugMode) dom.body.classList.add("debug");

  start();

  async function start() {
    wireControls();
    await loadData();
    interactionState = loadInteractionState();
    setSceneView(interactionState.view, false);
    queueRender(true);
    if (!staticMode && layer !== "background") connectTosu();
  }

  function wireControls() {
    dom.poolBoard.addEventListener("click", handleMapClick);
    dom.poolBoard.addEventListener("contextmenu", handleMapContextMenu);
    dom.leftStars.addEventListener("click", (event) => handlePointClick(event, "left"));
    dom.leftStars.addEventListener("contextmenu", (event) => handlePointContextMenu(event, "left"));
    dom.rightStars.addEventListener("click", (event) => handlePointClick(event, "right"));
    dom.rightStars.addEventListener("contextmenu", (event) => handlePointContextMenu(event, "right"));
    dom.body.addEventListener("dblclick", handleSceneDoubleClick);
    window.addEventListener("keydown", handleShortcut);

    dom.stageButton.addEventListener("click", cycleStage);
    dom.actionButton.addEventListener("click", () => setPickingSide(otherSide(interactionState.currentTurn || "left")));
    dom.actionSignButton.addEventListener("click", toggleActionSigns);
    dom.sceneButton.addEventListener("click", () => {
      clearTimeout(gameplayTimer);
      setSceneView(interactionState.view === "gameplay" ? "mappool" : "gameplay");
    });
    dom.undoButton.addEventListener("click", undoLatestAction);
    dom.autoPickButton.addEventListener("click", () => {
      interactionState.autoPick = !interactionState.autoPick;
      saveInteractionState();
      updateControls();
      setControlStatus(`Auto Pick ${interactionState.autoPick ? "enabled" : "disabled"}.`);
    });
    dom.autoSceneButton.addEventListener("click", () => {
      interactionState.autoScene = !interactionState.autoScene;
      clearTimeout(gameplayTimer);
      clearTimeout(resultTimer);
      saveInteractionState();
      updateControls();
      setControlStatus(`Auto Scene ${interactionState.autoScene ? "enabled" : "disabled"}.`);
    });

    dom.reloadDataButton.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEY);
      await loadData();
      queueRender(true);
    });

    dom.jsonFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const json = JSON.parse(await file.text());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        maps = normaliseMaps(json);
        queueRender(true);
        setControlStatus(`Loaded ${file.name}. This mappool is saved in this browser until cleared.`);
      } catch (error) {
        setControlStatus(`Could not load ${file.name}: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    dom.clearStorageButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      setControlStatus("Saved browser mappool cleared. Use Reload JSON to read the repo data again.");
    });

    window.addEventListener("storage", (event) => {
      if (event.key === SCORE_OVERRIDE_KEY) {
        updateControls();
        queueRender();
      }
    });
  }

  function handleMapClick(event) {
    const card = event.target.closest(".map-card");
    if (!card) return;

    event.preventDefault();
    const pick = card.dataset.pick;
    if (event.ctrlKey) {
      clearMapAction(pick);
      return;
    }
    if (event.altKey) {
      markMapWinner(pick, "left");
      return;
    }

    const side = interactionState.currentTurn || "left";
    applyMapAction(pick, event.shiftKey ? "ban" : currentActionType(), side);
  }

  function handleMapContextMenu(event) {
    const card = event.target.closest(".map-card");
    if (!card) return;

    event.preventDefault();
    const pick = card.dataset.pick;
    if (event.ctrlKey) {
      clearMapAction(pick);
      return;
    }
    if (event.altKey) {
      markMapWinner(pick, "right");
      return;
    }

    applyMapAction(pick, event.shiftKey ? "ban" : currentActionType(), "right");
  }

  function handleSceneDoubleClick(event) {
    if (event.target.closest(".map-card, .control-panel")) return;
    setSceneView(interactionState.view === "gameplay" ? "mappool" : "gameplay");
  }

  function handleShortcut(event) {
    const key = event.key.toLowerCase();
    if (key === "m") {
      setSceneView(interactionState.view === "gameplay" ? "mappool" : "gameplay");
    } else if (key === "t") {
      setPickingSide(otherSide(interactionState.currentTurn || "left"));
    } else if (key === "a") {
      interactionState.autoPick = !interactionState.autoPick;
      saveInteractionState();
      updateControls();
      setControlStatus(`Auto-pick ${interactionState.autoPick ? "enabled" : "disabled"}.`);
    } else if (key === "s") {
      interactionState.autoScene = !interactionState.autoScene;
      clearTimeout(gameplayTimer);
      clearTimeout(resultTimer);
      saveInteractionState();
      updateControls();
      setControlStatus(`Auto Scene ${interactionState.autoScene ? "enabled" : "disabled"}.`);
    } else if (key === "z" && event.ctrlKey) {
      undoLatestAction();
    } else if (key === "backspace" && event.ctrlKey) {
      interactionState.actions = {};
      interactionState.history = [];
      saveInteractionState();
      queueRender(true);
      setControlStatus("Cleared all map pick/ban marks.");
    }
  }

  async function loadData() {
    const saved = freshData ? null : localStorage.getItem(STORAGE_KEY);

    try {
      matchData = normaliseMatch(await fetchJson(MATCH_URL));
      setDiagnostics({ match: `loaded ${MATCH_URL}` });
    } catch (error) {
      matchData = structuredClone(fallbackMatch);
      setDiagnostics({ match: `fallback: ${error.message}` });
    }

    if (saved) {
      try {
        maps = normaliseMaps(JSON.parse(saved));
        setDiagnostics({ mappool: "loaded browser storage" });
        setControlStatus("Loaded saved browser mappool. Clear it to use the repo data file again.");
        return;
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    try {
      maps = normaliseMaps(await fetchJson(MAPPOOL_URL));
      setDiagnostics({ mappool: `loaded ${MAPPOOL_URL}` });
      setControlStatus(`Loaded ${MATCH_URL} and ${MAPPOOL_URL}.`);
    } catch (error) {
      maps = normaliseMaps(fallbackMaps);
      setDiagnostics({ mappool: `fallback: ${error.message}` });
      setControlStatus(`Using placeholder mappool. Could not read ${MAPPOOL_URL}: ${error.message}`);
    }
  }

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function queueRender(rebuildPool) {
    if (rebuildPool) poolSignature = "";
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    const leftPlayer = resolvePlayer("left");
    const rightPlayer = resolvePlayer("right");
    const pointCount = pointsToWin(resolveBestOf());
    const displayStars = resolveDisplayedStars(pointCount);
    const state = {
      leftName: leftPlayer.name,
      rightName: rightPlayer.name,
      leftSeed: leftPlayer.seed,
      rightSeed: rightPlayer.seed,
      leftStars: displayStars.left,
      rightStars: displayStars.right,
      stage: resolveStage(),
      commentators: matchData.commentators.join(" / "),
      activeMap: liveState.activeMap,
      pickingSide: interactionState.currentTurn || liveState.pickingSide
    };
    const previous = previousState || state;

    setAnimatedText(dom.leftSeed, state.leftSeed, previous.leftSeed);
    setAnimatedText(dom.rightSeed, state.rightSeed, previous.rightSeed);
    setAnimatedText(dom.leftName, state.leftName, previous.leftName);
    setAnimatedText(dom.rightName, state.rightName, previous.rightName);
    dom.leftName.closest(".player").classList.toggle("has-seed", Boolean(state.leftSeed));
    dom.rightName.closest(".player").classList.toggle("has-seed", Boolean(state.rightSeed));
    fitPlayerName(dom.leftName, state.leftName);
    fitPlayerName(dom.rightName, state.rightName);

    dom.matchScore.hidden = !(liveState.visibility.stars || displayStars.overridden);
    renderPointTrack(dom.leftStars, state.leftStars, pointCount, previous.leftStars);
    renderPointTrack(dom.rightStars, state.rightStars, pointCount, previous.rightStars);
    setAnimatedText(dom.stageLabel, state.stage, previous.stage);
    renderActionBadges(state.pickingSide);
    renderPool(state.activeMap);
    renderChat();
    setAnimatedText(dom.commentatorList, state.commentators, previous.commentators);
    fitSingleLine(dom.commentatorList, state.commentators, 21, 16, 32);
    updateControls();

    setDiagnostics({
      players: `${state.leftName} vs ${state.rightName}`,
      score: `${state.leftStars}-${state.rightStars} / ${pointCount}${displayStars.overridden ? " manual" : ""}`,
      map: state.activeMap.pick || state.activeMap.id || "-"
    });
    previousState = state;
  }

  function resolvePlayer(side) {
    return {
      name: cleanText(liveState.players[side].name) || matchData.players[side].name,
      seed: matchData.players[side].seed
    };
  }

  function resolveBestOf() {
    return normaliseBestOf(liveState.bestOf || matchData.bestOf);
  }

  function renderPointTrack(container, value, count, previousValue) {
    container.innerHTML = "";
    setPointSizing(container, count);

    for (let index = 0; index < count; index += 1) {
      const point = document.createElement("img");
      point.src = index < value ? FULL_POINT : EMPTY_POINT;
      point.alt = "";
      point.dataset.score = String(index + 1);
      point.draggable = false;
      if (index + 1 === value && value > previousValue) point.classList.add("is-data-fresh");
      container.appendChild(point);
    }
  }

  function setPointSizing(container, count) {
    const maxWidth = 360;
    const defaultWidth = 67;
    const defaultHeight = 37;
    const gap = count > 5 ? 4 : 5;
    const width = Math.min(defaultWidth, Math.floor((maxWidth - gap * (count - 1)) / count));
    const height = Math.round((width / defaultWidth) * defaultHeight);

    container.style.setProperty("--point-gap", `${gap}px`);
    container.style.setProperty("--point-width", `${width}px`);
    container.style.setProperty("--point-height", `${height}px`);
  }

  function renderActionBadges(side) {
    const visible = interactionState.indicatorsVisible !== false;
    const label = currentActionType() === "ban" ? "Ban" : "Pick";

    dom.leftPickBadge.textContent = label;
    dom.rightPickBadge.textContent = label;
    dom.leftPickBadge.classList.toggle("is-visible", visible && side === "left");
    dom.rightPickBadge.classList.toggle("is-visible", visible && side === "right");
  }

  function renderPool(activeMap) {
    const signature = [
      maps.map((map) => `${map.pick}:${map.title}:${map.beatmapId}`).join("|"),
      JSON.stringify(interactionState.actions),
      activeMap.pick,
      activeMap.id,
      interactionState.currentTurn
    ].join("::");

    if (signature === poolSignature) return;
    poolSignature = signature;
    dom.poolBoard.innerHTML = "";
    dom.poolBoard.classList.toggle("is-empty", maps.length === 0);

    for (const row of groupMaps(maps)) {
      const rowElement = document.createElement("div");
      rowElement.className = "pool-row";
      row.maps.forEach((map) => rowElement.appendChild(createCard(map, activeMap)));
      dom.poolBoard.appendChild(rowElement);
    }
  }

  function createCard(map, activeMap) {
    const displayMap = withInteraction(map);
    const card = document.createElement("article");
    const active = isActiveMap(displayMap, activeMap);
    const status = formatStatus(displayMap);
    card.className = [
      "map-card",
      active ? "is-current" : "",
      status ? "has-status" : "",
      isStatus(displayMap, "ban") ? "is-banned" : "",
      isStatus(displayMap, "pick") ? "is-picked" : "",
      isStatus(displayMap, "protect") ? "is-protected" : ""
    ].filter(Boolean).join(" ");
    card.dataset.pick = displayMap.pick;
    card.title = `${displayMap.pick}: left click for current player, Shift+click to ban, Ctrl+click to clear.`;

    const highlight = document.createElement("img");
    highlight.className = "card-highlight";
    highlight.src = "../../assets/vct/match/highlight.png";
    highlight.alt = "";
    card.appendChild(highlight);

    const copy = document.createElement("div");
    copy.className = "map-copy";

    const title = document.createElement("div");
    title.className = "map-title";
    title.textContent = displayMap.title || "Untitled";

    const meta = document.createElement("div");
    meta.className = "map-meta";
    meta.textContent = formatMapMeta(displayMap);

    const pick = document.createElement("div");
    pick.className = displayMap.pick.length > 3 ? "map-pick is-long" : "map-pick";
    pick.textContent = displayMap.pick;

    const label = document.createElement("div");
    label.className = "status-label";
    label.textContent = status;

    copy.append(title, meta);
    card.append(copy, pick, label);
    return card;
  }

  function withInteraction(map) {
    const action = interactionState.actions[map.pick];
    if (!action) return map;

    return {
      ...map,
      status: action.type === "ban" ? "banned" : "picked",
      pickedBy: action.type === "pick" ? action.side : "",
      bannedBy: action.type === "ban" ? action.side : "",
      wonBy: action.winner || "",
      protectedBy: ""
    };
  }

  function applyMapAction(pick, type, side, options = {}) {
    const map = findMapByPick(pick);
    if (!map || !side) return;

    if (type === "ban" && pickPrefix(map.pick) === "TB") {
      setControlStatus("Tiebreaker is not bannable.");
      return;
    }

    if (type === "ban" && !canBan(side, map.pick)) return;

    rememberAction(map.pick);
    interactionState.actions[map.pick] = { type, side, winner: "" };

    if (type === "ban") {
      advanceBanTurn(side);
    } else {
      interactionState.lastPickSide = side;
      interactionState.currentTurn = side;
      scheduleGameplayAfterPick();
    }

    saveInteractionState();
    queueRender(true);

    if (!options.silent) {
      const label = type === "ban" ? "banned" : "picked";
      setControlStatus(`${sideName(side)} ${label} ${map.pick}.`);
    }
  }

  function clearMapAction(pick) {
    const map = findMapByPick(pick);
    if (!map) return;

    rememberAction(map.pick);
    delete interactionState.actions[map.pick];
    saveInteractionState();
    queueRender(true);
    setControlStatus(`Cleared ${map.pick}.`);
  }

  function markMapWinner(pick, side, options = {}) {
    const map = findMapByPick(pick);
    if (!map || !side) return;

    rememberAction(map.pick);
    const previous = interactionState.actions[map.pick];
    interactionState.actions[map.pick] = {
      type: "pick",
      side: previous?.side || interactionState.lastPickSide || interactionState.currentTurn || side,
      winner: side
    };
    saveInteractionState();
    queueRender(true);

    if (!options.silent) {
      setControlStatus(`${sideName(side)} won ${map.pick}.`);
    }
  }

  function handlePointClick(event, side) {
    event.preventDefault();
    event.stopPropagation();

    if (event.ctrlKey) {
      clearManualScore();
      return;
    }

    const value = pointScoreFromEvent(event, 0);
    if (value === null) return;
    setManualScore(side, value);
  }

  function handlePointContextMenu(event, side) {
    event.preventDefault();
    event.stopPropagation();

    if (event.ctrlKey) {
      clearManualScore();
      return;
    }

    const value = pointScoreFromEvent(event, -1);
    if (value === null) return;
    setManualScore(side, value);
  }

  function pointScoreFromEvent(event, offset) {
    const point = event.target.closest(".point-track img");
    if (!point || !event.currentTarget.contains(point)) return null;

    const value = Number(point.dataset.score);
    return Number.isFinite(value) ? value + offset : null;
  }

  function setManualScore(side, value) {
    const pointCount = pointsToWin(resolveBestOf());
    const saved = readScoreOverride(pointCount);
    const base = saved.enabled
      ? saved
      : {
        left: clamp(liveState.stars.left, 0, pointCount),
        right: clamp(liveState.stars.right, 0, pointCount)
      };
    const next = {
      enabled: true,
      left: base.left,
      right: base.right
    };

    next[side] = clamp(value, 0, pointCount);
    localStorage.setItem(SCORE_OVERRIDE_KEY, JSON.stringify(next));
    updateControls();
    queueRender();
    setControlStatus(`Manual score: ${next.left} - ${next.right}. Ctrl+click the point track to use tosu again.`);
  }

  function clearManualScore() {
    localStorage.removeItem(SCORE_OVERRIDE_KEY);
    updateControls();
    queueRender();
    setControlStatus("Using tosu score again.");
  }

  function resolveDisplayedStars(pointCount) {
    const saved = readScoreOverride(pointCount);
    if (saved.enabled) {
      return {
        left: saved.left,
        right: saved.right,
        overridden: true
      };
    }

    return {
      left: clamp(liveState.stars.left, 0, pointCount),
      right: clamp(liveState.stars.right, 0, pointCount),
      overridden: false
    };
  }

  function readScoreOverride(pointCount = 99) {
    try {
      const saved = JSON.parse(localStorage.getItem(SCORE_OVERRIDE_KEY) || "{}");
      if (saved.enabled !== true) return { enabled: false, left: 0, right: 0 };

      return {
        enabled: true,
        left: clamp(saved.left, 0, pointCount),
        right: clamp(saved.right, 0, pointCount)
      };
    } catch (error) {
      localStorage.removeItem(SCORE_OVERRIDE_KEY);
      return { enabled: false, left: 0, right: 0 };
    }
  }

  function rememberAction(pick) {
    interactionState.history.push({
      pick,
      previousAction: interactionState.actions[pick] ? { ...interactionState.actions[pick] } : null,
      previousTurn: interactionState.currentTurn,
      previousLastPickSide: interactionState.lastPickSide,
      previousView: interactionState.view
    });
  }

  function undoLatestAction() {
    const previous = interactionState.history.pop();
    if (!previous) {
      setControlStatus("No action to undo.");
      return;
    }

    if (previous.previousAction) {
      interactionState.actions[previous.pick] = previous.previousAction;
    } else {
      delete interactionState.actions[previous.pick];
    }

    interactionState.currentTurn = previous.previousTurn || "left";
    interactionState.lastPickSide = previous.previousLastPickSide || "";
    interactionState.view = previous.previousView || interactionState.view;
    setSceneView(interactionState.view, false);
    saveInteractionState();
    queueRender(true);
    setControlStatus(`Undid ${previous.pick}.`);
  }

  function currentActionType() {
    return banPhaseComplete() ? "pick" : "ban";
  }

  function canBan(side, pick) {
    const action = interactionState.actions[pick];
    if (action?.type === "ban" && action.side === side) return true;

    const used = maps.filter((map) => {
      if (samePick(map.pick, pick)) return false;
      const displayMap = withInteraction(map);
      return isStatus(displayMap, "ban") && displayMap.bannedBy === side;
    }).length;

    if (used < getBanLimit()) return true;

    setControlStatus(`${sideName(side)} has already used ${getBanLimit()} ban${getBanLimit() === 1 ? "" : "s"}. Ctrl+click a ban to clear it.`);
    return false;
  }

  function advanceBanTurn(side) {
    const totalBans = maps.filter((map) => isStatus(withInteraction(map), "ban")).length;
    const requiredBans = getBanLimit() * 2;
    const banLimit = getBanLimit();

    if (banLimit === 1) {
      interactionState.currentTurn = totalBans >= requiredBans ? side : otherSide(side);
      return;
    }

    if (totalBans === 1) {
      interactionState.currentTurn = otherSide(side);
    } else if (totalBans === 2) {
      interactionState.currentTurn = side;
    } else if (totalBans === 3) {
      interactionState.currentTurn = otherSide(side);
    } else {
      interactionState.currentTurn = otherSide(side);
    }
  }

  function handleAutoPick(activeMap) {
    if (!interactionState.autoPick || !banPhaseComplete()) return;
    const map = findMapByPick(activeMap.pick);
    if (!map) return;

    const key = `${map.pick}:${activeMap.id || activeMap.file || activeMap.title}`;
    if (key === lastAutoPickKey) return;
    lastAutoPickKey = key;

    if (interactionState.actions[map.pick]) return;
    applyMapAction(map.pick, "pick", interactionState.currentTurn || "left", { silent: true });
  }

  function banPhaseComplete() {
    const totalBans = maps.filter((map) => isStatus(withInteraction(map), "ban")).length;
    return totalBans >= getBanLimit() * 2;
  }

  function findMapByPick(pick) {
    return maps.find((map) => samePick(map.pick, pick));
  }

  function groupMaps(items) {
    const groups = new Map();

    items.forEach((map) => {
      const key = map.group || pickPrefix(map.pick);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(map);
    });

    const ordered = [];
    ROW_ORDER.forEach((key) => {
      if (groups.has(key)) {
        ordered.push({ key, maps: groups.get(key) });
        groups.delete(key);
      }
    });

    Array.from(groups.keys()).sort().forEach((key) => {
      ordered.push({ key, maps: groups.get(key) });
    });

    return ordered;
  }

  function renderChat() {
    dom.chatList.innerHTML = "";
    liveState.chat.slice(-5).forEach((line) => {
      const item = document.createElement("div");
      item.className = "chat-line";
      item.innerHTML = `<span class="chat-name"></span><span class="chat-text"></span>`;
      item.querySelector(".chat-name").textContent = line.name ? `${line.name}: ` : "";
      item.querySelector(".chat-text").textContent = line.text;
      dom.chatList.appendChild(item);
    });
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
        setControlStatus("");
      },
      onMessage(event) {
        try {
          liveState = extractLiveState(JSON.parse(event.data));
          if (liveState.ipcState !== previousIpcState) {
            handleIpcState(liveState.ipcState);
            previousIpcState = liveState.ipcState;
          }
          handleAutoPick(liveState.activeMap);
          queueRender(false);
        } catch (error) {
          console.warn("Could not parse tosu payload", error);
        }
      }
    });
  }

  function handleIpcState(ipcState) {
    if (!interactionState.autoScene) return;

    if (ipcState === GAMEPLAY_STATE) {
      clearTimeout(gameplayTimer);
      clearTimeout(resultTimer);
      setSceneView("gameplay");
      return;
    }

    if (ipcState === RESULT_STATE) {
      clearTimeout(gameplayTimer);
      clearTimeout(resultTimer);
      markActiveMapWinner();
      resultTimer = window.setTimeout(() => {
        setSceneView("mappool");
        advancePickTurnAfterResult();
      }, RESULT_HOLD_MS);
      return;
    }

    if (IDLE_STATES.has(ipcState)) {
      clearTimeout(resultTimer);
      if (!gameplayTimer) setSceneView("mappool");
    }
  }

  function scheduleGameplayAfterPick() {
    if (!interactionState.autoScene) return;

    clearTimeout(gameplayTimer);
    gameplayTimer = window.setTimeout(() => {
      gameplayTimer = null;
      setSceneView("gameplay");
    }, PICK_TO_GAMEPLAY_MS);
  }

  function markActiveMapWinner() {
    const pick = liveState.activeMap.pick;
    if (!pick) return;

    const leftScore = liveState.gameplayScore.left;
    const rightScore = liveState.gameplayScore.right;
    if (leftScore === rightScore) return;

    markMapWinner(pick, leftScore > rightScore ? "left" : "right", { silent: true });
  }

  function setSceneView(view, announce = true) {
    const nextView = view === "gameplay" ? "gameplay" : "mappool";
    interactionState.view = nextView;
    dom.body.classList.toggle("is-gameplay", nextView === "gameplay");
    dom.body.classList.toggle("is-mappool", nextView !== "gameplay");
    saveInteractionState();
    updateControls();

    if (announce) {
      setControlStatus(nextView === "gameplay"
        ? "Showing gameplay. Double-click the mappool source to bring the board back."
        : "Showing mappool. Double-click empty space to reveal gameplay.");
    }
  }

  function setPickingSide(side) {
    interactionState.currentTurn = normaliseSide(side) || "left";
    saveInteractionState();
    updateControls();
    queueRender(true);
    setControlStatus(`${sideName(interactionState.currentTurn)} is the current picking side.`);
  }

  function advancePickTurnAfterResult() {
    const side = interactionState.lastPickSide || interactionState.currentTurn;
    interactionState.currentTurn = otherSide(side || "left");
    interactionState.lastPickSide = "";
    saveInteractionState();
    queueRender(true);
  }

  function extractLiveState(data) {
    const manager = data?.tourney?.manager || {};
    const teamName = manager.teamName || {};
    const stars = manager.stars || {};
    const score = manager.gameplay?.score || {};
    const bools = manager.bools || {};
    const activeMap = extractLiveMap(data);

    return {
      players: {
        left: { name: cleanText(teamName.left || manager.team?.left || "") },
        right: { name: cleanText(teamName.right || manager.team?.right || "") }
      },
      bestOf: normaliseBestOf(manager.bestOF || manager.bestOf || manager.best_of || matchData.bestOf),
      stars: {
        left: numberOrZero(stars.left),
        right: numberOrZero(stars.right)
      },
      gameplayScore: {
        left: numberOrZero(score.left),
        right: numberOrZero(score.right)
      },
      visibility: {
        stars: bools.starsVisible !== false
      },
      ipcState: numberOrZero(manager.ipcState),
      pickingSide: normaliseSide(manager.pickingTeam || manager.turn || manager.pickTeam),
      activeMap,
      chat: extractChat(data)
    };
  }

  function extractLiveMap(data) {
    const bm = data?.menu?.bm || {};
    const metadata = bm.metadata || {};
    const path = bm.path || {};
    const id = cleanText(bm.id || bm.beatmapId);
    const file = cleanText(path.file || "");
    const title = cleanText(metadata.title || bm.title);
    const difficulty = cleanText(metadata.difficulty || metadata.version || bm.difficulty);
    const pick = findPickForLiveMap(id, file, title, difficulty);

    return {
      id,
      file,
      pick,
      title,
      difficulty
    };
  }

  function findPickForLiveMap(id, file, title, difficulty) {
    const needle = [id, file, title, difficulty].map(cleanText).filter(Boolean).join(" ").toLowerCase();
    if (!needle) return "";

    const map = maps.find((item) => {
      const aliases = [item.beatmapId, item.pick, item.title, item.difficulty, ...item.aliases]
        .map(cleanText)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return aliases && (needle.includes(aliases) || aliases.includes(needle) || (id && aliases.includes(id)));
    });

    return map?.pick || "";
  }

  function extractChat(data) {
    const values = data?.gameplay?.chat || data?.tourney?.manager?.chat || data?.chat || [];
    if (!Array.isArray(values)) return liveState.chat;

    return values.map((line) => ({
      name: cleanText(line.name || line.user || line.sender || ""),
      text: cleanText(line.text || line.message || line.messageBody || line.content || line)
    })).filter((line) => line.text).slice(-5);
  }

  function normaliseMatch(source) {
    const players = source?.players || source?.teams || {};

    return {
      stage: cleanText(source?.stage || source?.round || source?.title) || fallbackMatch.stage,
      bestOf: normaliseBestOf(source?.bestOf || source?.best_of || source?.bo || fallbackMatch.bestOf),
      bansPerPlayer: numberOrNull(source?.bansPerPlayer || source?.bans_per_player || source?.bans || source?.banCount),
      players: {
        left: normalisePlayer(players.left || players.red || source?.leftPlayer || source?.playerLeft || source?.leftTeam || source?.teamLeft, fallbackMatch.players.left),
        right: normalisePlayer(players.right || players.blue || source?.rightPlayer || source?.playerRight || source?.rightTeam || source?.teamRight, fallbackMatch.players.right)
      },
      commentators: normaliseCommentators(source?.commentators || source?.casters || source?.hosts)
    };
  }

  function normaliseMaps(source) {
    const list = Array.isArray(source)
      ? source
      : source?.maps || source?.mappool || source?.beatmaps || fallbackMaps;

    return list.map((map, index) => {
      const pick = cleanText(map.pick || map.code || map.id || `MAP${index + 1}`).toUpperCase();
      const urlStatus = statusFromUrl(pick);
      return {
        pick,
        group: cleanText(map.group || map.mod || ""),
        beatmapId: cleanText(map.beatmapId || map.beatmap_id || map.id || ""),
        aliases: Array.isArray(map.aliases) ? map.aliases.map(cleanText).filter(Boolean) : [],
        title: cleanText(map.title || map.name || ""),
        artist: cleanText(map.artist || ""),
        difficulty: cleanText(map.difficulty || map.version || ""),
        mapper: cleanText(map.mapper || map.mappers || map.creator || ""),
        sr: numberOrNull(map.sr || map.starRating),
        bpm: cleanText(map.bpm || ""),
        length: cleanText(map.length || map.drainLength || map.totalLength || ""),
        status: cleanText(map.status || map.state || urlStatus.status),
        pickedBy: normaliseSide(map.pickedBy || map.pickBy || urlStatus.pickedBy),
        bannedBy: normaliseSide(map.bannedBy || map.banBy || urlStatus.bannedBy),
        protectedBy: normaliseSide(map.protectedBy || map.protectBy || urlStatus.protectedBy)
      };
    }).filter((map) => map.pick);
  }

  function normalisePlayer(value, fallback) {
    if (typeof value === "string") {
      return { name: cleanText(value) || fallback.name, seed: "" };
    }

    return {
      name: cleanText(value?.name || value?.player || value?.team || value?.label) || fallback.name,
      seed: cleanText(value?.seed || value?.rank || "")
    };
  }

  function normaliseCommentators(value) {
    if (!value) return fallbackMatch.commentators;
    const values = Array.isArray(value) ? value : String(value).split(/[,&/]+/);
    const commentators = values.map((item) => cleanText(item.name || item)).filter(Boolean);
    return commentators.length ? commentators : fallbackMatch.commentators;
  }

  function createEmptyLiveState() {
    return {
      players: {
        left: { name: "" },
        right: { name: "" }
      },
      bestOf: 0,
      stars: {
        left: 0,
        right: 0
      },
      gameplayScore: {
        left: 0,
        right: 0
      },
      visibility: {
        stars: true
      },
      ipcState: 0,
      pickingSide: initialPickingSide,
      activeMap: {
        id: "",
        file: "",
        pick: initialActivePick,
        title: "",
        difficulty: ""
      },
      chat: []
    };
  }

  function createInteractionState() {
    return {
      view: "mappool",
      stageOverride: "",
      currentTurn: initialPickingSide || "left",
      lastPickSide: "",
      indicatorsVisible: true,
      autoPick: initialAutoPick,
      autoScene: initialAutoScene,
      history: [],
      actions: {}
    };
  }

  function loadInteractionState() {
    const state = createInteractionState();

    try {
      const saved = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY) || "{}");
      state.view = saved.view === "gameplay" ? "gameplay" : "mappool";
      state.stageOverride = normaliseStage(saved.stageOverride);
      state.currentTurn = normaliseSide(saved.currentTurn) || state.currentTurn;
      state.lastPickSide = normaliseSide(saved.lastPickSide);
      state.indicatorsVisible = typeof saved.indicatorsVisible === "boolean" ? saved.indicatorsVisible : state.indicatorsVisible;
      state.autoPick = typeof saved.autoPick === "boolean" ? saved.autoPick : state.autoPick;
      state.autoScene = typeof saved.autoScene === "boolean" ? saved.autoScene : state.autoScene;
      state.history = Array.isArray(saved.history) ? saved.history.slice(-80) : [];
      state.actions = normaliseActions(saved.actions);
    } catch (error) {
      localStorage.removeItem(STATE_STORAGE_KEY);
    }

    return state;
  }

  function normaliseActions(actions) {
    if (!actions || typeof actions !== "object") return {};

    return Object.entries(actions).reduce((next, [pick, action]) => {
      const type = action?.type === "ban" ? "ban" : action?.type === "pick" ? "pick" : "";
      const side = normaliseSide(action?.side);
      const map = findMapByPick(pick);
      const winner = normaliseSide(action?.winner);
      if (type && side && map) next[map.pick] = { type, side, winner };
      return next;
    }, {});
  }

  function saveInteractionState() {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(interactionState));
  }

  function updateControls() {
    const stage = stageInfo(resolveStage());
    const side = sideName(interactionState.currentTurn || "left");
    const action = currentActionType() === "ban" ? "Ban" : "Pick";

    dom.stageButton.textContent = `Current Stage: ${stage.acronym}`;
    dom.actionButton.textContent = `${side} ${action}`;
    dom.actionSignButton.textContent = interactionState.indicatorsVisible === false
      ? "Show Pick/Ban Sign"
      : "Hide Pick/Ban Sign";
    dom.sceneButton.textContent = interactionState.view === "gameplay"
      ? "Switch to Mappool"
      : "Switch to Gameplay";
    dom.undoButton.disabled = interactionState.history.length === 0;
    dom.autoPickButton.textContent = `Auto Pick: ${interactionState.autoPick ? "ON" : "OFF"}`;
    dom.autoSceneButton.textContent = `Auto Scene: ${interactionState.autoScene ? "ON" : "OFF"}`;
    dom.autoPickButton.classList.toggle("is-off", !interactionState.autoPick);
    dom.autoSceneButton.classList.toggle("is-off", !interactionState.autoScene);
  }

  function toggleActionSigns() {
    interactionState.indicatorsVisible = interactionState.indicatorsVisible === false ? true : false;
    saveInteractionState();
    updateControls();
    queueRender(false);
    setControlStatus(interactionState.indicatorsVisible ? "Pick/ban sign visible." : "Pick/ban sign hidden.");
  }

  function cycleStage() {
    const current = stageInfo(resolveStage()).label;
    const index = STAGES.findIndex((stage) => stage.label === current);
    const next = STAGES[(index + 1) % STAGES.length];

    interactionState.stageOverride = next.label;
    saveInteractionState();
    queueRender(false);
    setControlStatus(`Stage set to ${next.label}.`);
  }

  function resolveStage() {
    return interactionState.stageOverride || matchData.stage;
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

    return match || { acronym: cleanText(value).toUpperCase() || "RO32", label: cleanText(value) || fallbackMatch.stage };
  }

  function formatMapMeta(map) {
    return [
      map.artist,
      map.difficulty ? `[${map.difficulty}]` : "",
      map.sr ? `SR ${formatNumber(map.sr, 2)}` : "",
      map.bpm ? `BPM ${map.bpm}` : "",
      map.length ? `LEN ${map.length}` : "",
      map.mapper ? `Mapper ${map.mapper}` : ""
    ].filter(Boolean).join(" / ");
  }

  function isActiveMap(map, activeMap) {
    const activeValues = [activeMap.pick, activeMap.id, activeMap.file, activeMap.title, activeMap.difficulty]
      .map(cleanText)
      .filter(Boolean);

    if (!activeValues.length) return false;

    const mapValues = [map.pick, map.beatmapId, map.title, map.difficulty, ...map.aliases]
      .map(cleanText)
      .filter(Boolean);

    return activeValues.some((active) => mapValues.some((value) => sameValue(active, value)));
  }

  function statusFromUrl(pick) {
    if (listedPick("banned", pick) || listedPick("ban", pick)) return { status: "banned" };
    if (listedPick("protected", pick) || listedPick("protect", pick)) return { status: "protected" };
    if (listedPick("picked", pick)) return { status: "picked" };
    if (samePick(params.get("leftPick"), pick)) return { status: "picked", pickedBy: "left" };
    if (samePick(params.get("rightPick"), pick)) return { status: "picked", pickedBy: "right" };
    if (samePick(params.get("leftBan"), pick)) return { status: "banned", bannedBy: "left" };
    if (samePick(params.get("rightBan"), pick)) return { status: "banned", bannedBy: "right" };
    return {};
  }

  function listedPick(paramName, pick) {
    return cleanText(params.get(paramName)).split(",").some((value) => samePick(value, pick));
  }

  function samePick(a, b) {
    return cleanText(a).toUpperCase() === cleanText(b).toUpperCase();
  }

  function formatStatus(map) {
    if (isStatus(map, "ban")) return sideLabel(map.bannedBy, "BAN") || "BANNED";
    if (isStatus(map, "protect")) return sideLabel(map.protectedBy, "PROTECT") || "PROTECT";
    if (isStatus(map, "pick") && map.wonBy) return sideLabel(map.wonBy, "WIN") || "WIN";
    if (isStatus(map, "pick")) return sideLabel(map.pickedBy, "PICK") || "PICK";
    return "";
  }

  function sideLabel(side, label) {
    if (side === "left") return `P1 ${label}`;
    if (side === "right") return `P2 ${label}`;
    return "";
  }

  function isStatus(map, type) {
    const status = cleanText(map.status).toLowerCase();
    if (type === "ban") return Boolean(map.bannedBy) || status.includes("ban");
    if (type === "pick") return Boolean(map.pickedBy) || status.includes("pick");
    if (type === "protect") return Boolean(map.protectedBy) || status.includes("protect");
    return false;
  }

  function sameValue(a, b) {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left === right || left.includes(right) || right.includes(left);
  }

  function fitPlayerName(element, value) {
    const length = cleanText(value).length;
    const maxSize = element.closest(".player").classList.contains("has-seed") ? 26 : 34;
    const size = Math.max(18, Math.min(maxSize, 36 - Math.max(0, length - 12) * 0.78));
    element.style.setProperty("--player-size", `${size}px`);
  }

  function fitSingleLine(element, value, maxSize, minSize, comfortableLength) {
    const length = cleanText(value).length;
    const size = Math.max(minSize, Math.min(maxSize, maxSize - Math.max(0, length - comfortableLength) * 0.28));
    element.style.setProperty("--commentator-size", `${size}px`);
  }

  function setAnimatedText(element, value, previousValue) {
    const text = cleanText(value);
    if (element.textContent === text) return;
    element.textContent = text;
    if (text === cleanText(previousValue)) return;

    element.classList.remove("is-data-fresh");
    void element.offsetWidth;
    element.classList.add("is-data-fresh");
  }

  function setDiagnostics(next) {
    Object.assign(diagnostics, next);
    if (!debugMode) return;

    dom.diagnosticsPanel.textContent = [
      "VCT match mappool diagnostics",
      `Match: ${diagnostics.match}`,
      `Mappool: ${diagnostics.mappool}`,
      `Tosu: ${diagnostics.socket}`,
      `WS: ${socketUrl}`,
      `Players: ${diagnostics.players}`,
      `Score: ${diagnostics.score}`,
      `Map: ${diagnostics.map}`
    ].join("\n");
  }

  function setControlStatus(message) {
    dom.controlStatus.textContent = message || "";
  }

  function pickPrefix(value) {
    return cleanText(value).replace(/\d+$/g, "").toUpperCase() || "MAP";
  }

  function normaliseBestOf(value) {
    const match = cleanText(value).match(/\d+/);
    const number = match ? Number(match[0]) : Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallbackMatch.bestOf;
    return Math.max(1, Math.min(15, Math.floor(number)));
  }

  function getBanLimit() {
    const explicit = Number(params.get("bans") || matchData.bansPerPlayer || matchData.bans);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(4, Math.floor(explicit)));

    const stage = cleanText(resolveStage()).toLowerCase().replace(/[^a-z]+/g, " ");
    return stage.includes("grand final") || /\bfinals?\b/.test(stage) ? 2 : 1;
  }

  function pointsToWin(bestOf) {
    return Math.ceil(bestOf / 2);
  }

  function normaliseSide(value) {
    const text = cleanText(value).toLowerCase();
    if (["1", "left", "blue", "team1", "team one", "playerone", "player one", "p1"].includes(text)) return "left";
    if (["2", "right", "red", "team2", "team two", "playertwo", "player two", "p2"].includes(text)) return "right";
    return "";
  }

  function otherSide(side) {
    return side === "right" ? "left" : "right";
  }

  function sideName(side) {
    return side === "right" ? "Player Right" : "Player Left";
  }

  function formatNumber(value, decimals) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return number.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Math.floor(numberOrZero(value))));
  }

  function cleanText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function normaliseLayer(value) {
    return ["background", "hud", "full"].includes(value) ? value : "full";
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

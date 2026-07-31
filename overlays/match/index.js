(function () {
  "use strict";

  const DATA_URL = "../../data/match.json";
  const STORAGE_KEY = "vct.match.data";
  const SCORE_OVERRIDE_KEY = "vct.match.score-override";
  const SOURCE_MAPPOOL_URL = "../../data/mappool.json";
  const CACHE_MAPPOOL_URL = "../../data/mappool.cache.json";
  const DEFAULT_TOSU_HOST = "127.0.0.1:24050";
  const ASSET_VERSION = "20260730c";
  const EMPTY_POINT = `../../assets/vct/match/point_empty.png?v=${ASSET_VERSION}`;
  const FULL_POINT = `../../assets/vct/match/point_full.png?v=${ASSET_VERSION}`;

  const fallbackData = {
    stage: "Round of 32",
    bestOf: 9,
    players: {
      left: { name: "Player Left", seed: "" },
      right: { name: "Player Right", seed: "" }
    },
    commentators: []
  };

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
    leftLiveScore: document.getElementById("leftLiveScore"),
    rightLiveScore: document.getElementById("rightLiveScore"),
    gameScorePanel: document.getElementById("gameScorePanel"),
    leftGameplayScore: document.getElementById("leftGameplayScore"),
    rightGameplayScore: document.getElementById("rightGameplayScore"),
    leftScoreBar: document.getElementById("leftScoreBar"),
    rightScoreBar: document.getElementById("rightScoreBar"),
    diffLeft: document.getElementById("diffLeft"),
    diffRight: document.getElementById("diffRight"),
    leftWin: document.getElementById("leftWin"),
    rightWin: document.getElementById("rightWin"),
    beatmapPick: document.getElementById("beatmapPick"),
    beatmapTitleWrap: document.getElementById("beatmapTitleWrap"),
    beatmapTitle: document.getElementById("beatmapTitle"),
    beatmapMeta: document.getElementById("beatmapMeta"),
    commentatorList: document.getElementById("commentatorList"),
    connectionChip: document.getElementById("connectionChip"),
    diagnosticsPanel: document.getElementById("diagnosticsPanel"),
    controlStatus: document.getElementById("controlStatus"),
    reloadDataButton: document.getElementById("reloadDataButton"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    swapPlayersButton: document.getElementById("swapPlayersButton"),
    clearStorageButton: document.getElementById("clearStorageButton")
  };

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get("debug") === "1";
  const freshData = params.get("fresh") === "1";
  const staticMode = params.get("static") === "1";
  const layer = normaliseLayer(params.get("layer"));
  const tosuHost = params.get("tosu") || (location.port === "24050" ? location.host : DEFAULT_TOSU_HOST);
  const socketUrl = `ws://${tosuHost}/ws`;
  const diagnostics = {
    json: "loading",
    socket: staticMode ? "static mode" : "starting",
    players: "-",
    stars: "-",
    score: "-",
    beatmap: "-"
  };

  let matchData = structuredClone(fallbackData);
  let maps = [];
  let liveState = createEmptyLiveState();
  let previousRenderState = null;
  let socket = null;
  let reconnectTimer = null;
  let renderQueued = false;

  dom.body.dataset.layer = layer;
  if (debugMode) dom.body.classList.add("debug");

  start();

  async function start() {
    wireControls();
    matchData = await loadMatchData();
    normaliseMatchData();
    maps = await loadMappoolData();
    queueRender();
    if (!staticMode && layer !== "background") connectTosu();
  }

  function wireControls() {
    dom.leftStars.addEventListener("click", (event) => handlePointClick(event, "left"));
    dom.leftStars.addEventListener("contextmenu", (event) => handlePointContextMenu(event, "left"));
    dom.rightStars.addEventListener("click", (event) => handlePointClick(event, "right"));
    dom.rightStars.addEventListener("contextmenu", (event) => handlePointContextMenu(event, "right"));

    dom.reloadDataButton.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEY);
      matchData = await loadMatchData();
      normaliseMatchData();
      maps = await loadMappoolData();
      queueRender();
    });

    dom.jsonFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const json = JSON.parse(await file.text());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        matchData = json;
        normaliseMatchData();
        queueRender();
        setControlStatus(`Loaded ${file.name}. This JSON is saved in this browser until cleared.`);
      } catch (error) {
        setControlStatus(`Could not load ${file.name}: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    dom.swapPlayersButton.addEventListener("click", () => {
      const left = matchData.players.left;
      matchData.players.left = matchData.players.right;
      matchData.players.right = left;
      liveState = {
        ...liveState,
        players: {
          left: liveState.players.right,
          right: liveState.players.left
        },
        stars: {
          left: liveState.stars.right,
          right: liveState.stars.left
        },
        gameplayScore: {
          left: liveState.gameplayScore.right,
          right: liveState.gameplayScore.left
        }
      };
      queueRender();
    });

    window.addEventListener("storage", (event) => {
      if (event.key === "vct.match-mappool.state" || event.key === SCORE_OVERRIDE_KEY) queueRender();
    });

    dom.clearStorageButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      setControlStatus("Saved browser JSON cleared. Use Reload JSON to read the repo data again.");
    });
  }

  async function loadMatchData() {
    const saved = freshData ? null : localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setControlStatus("Loaded saved browser JSON. Clear it to use the repo data file again.");
        return JSON.parse(saved);
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setDiagnostics({ json: `loaded ${DATA_URL}` });
      setControlStatus(`Loaded ${DATA_URL}.`);
      return response.json();
    } catch (error) {
      setDiagnostics({ json: `failed: ${error.message}` });
      setControlStatus(`Using placeholder data. Could not read ${DATA_URL}: ${error.message}`);
      return structuredClone(fallbackData);
    }
  }

  async function loadMappoolData() {
    try {
      const cache = await fetchJson(CACHE_MAPPOOL_URL).catch(() => null);
      const source = await fetchJson(SOURCE_MAPPOOL_URL);
      const json = cache ? mergeMappoolSource(cache, source) : source;
      return normaliseMaps(json);
    } catch (error) {
      try {
        return normaliseMaps(await fetchJson(CACHE_MAPPOOL_URL));
      } catch (cacheError) {
        return [];
      }
    }
  }

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function normaliseMatchData() {
    const source = matchData || {};
    const players = source.players || source.teams || {};

    matchData = {
      stage: cleanText(source.stage || source.round || source.title) || fallbackData.stage,
      bestOf: normaliseBestOf(source.bestOf || source.best_of || source.bo || fallbackData.bestOf),
      players: {
        left: normalisePlayer(players.left || players.red || source.leftPlayer || source.playerLeft || source.leftTeam || source.teamLeft, fallbackData.players.left),
        right: normalisePlayer(players.right || players.blue || source.rightPlayer || source.playerRight || source.rightTeam || source.teamRight, fallbackData.players.right)
      },
      commentators: normaliseCommentators(source.commentators || source.casters || source.hosts)
    };
  }

  function mergeMappoolSource(cacheData, sourceData) {
    const cache = Array.isArray(cacheData) ? { maps: cacheData } : cacheData || {};
    const source = Array.isArray(sourceData) ? { maps: sourceData } : sourceData || {};
    const cacheMaps = Array.isArray(cache.maps) ? cache.maps : [];
    const sourceMaps = Array.isArray(source.maps) ? source.maps : [];

    if (!sourceMaps.length) return sourceData;

    const byPick = new Map(cacheMaps.map((map) => [cleanText(map.pick).toUpperCase(), map]));
    const byId = new Map(cacheMaps
      .map((map) => [cleanText(map.beatmapId || map.beatmap_id || map.id), map])
      .filter(([id]) => id));
    const maps = sourceMaps.map((map) => {
      const sourceId = cleanText(map.beatmapId || map.beatmap_id || map.id);
      const cached = byId.get(sourceId)
        || (sourceId ? {} : byPick.get(cleanText(map.pick).toUpperCase()))
        || {};
      return mergeMapData(cached, map);
    });

    return Array.isArray(sourceData)
      ? maps
      : {
        ...cache,
        ...source,
        maps
      };
  }

  function mergeMapData(cached, source) {
    const merged = { ...cached };

    Object.entries(source || {}).forEach(([key, value]) => {
      if (shouldUseSourceValue(value)) {
        merged[key] = value;
      }
    });

    const aliases = [
      ...(Array.isArray(cached?.aliases) ? cached.aliases : []),
      ...(Array.isArray(source?.aliases) ? source.aliases : [])
    ].map(cleanText).filter(Boolean);

    if (aliases.length) merged.aliases = [...new Set(aliases)];
    return merged;
  }

  function shouldUseSourceValue(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function normaliseMaps(source) {
    const list = Array.isArray(source)
      ? source
      : source?.maps || source?.mappool || source?.beatmaps || [];

    return list.map((map, index) => {
      const beatmapId = cleanText(map.beatmapId || map.beatmap_id || map.id || "");
      return {
        pick: cleanText(map.pick || map.code || `MAP${index + 1}`).toUpperCase(),
        beatmapId,
        aliases: Array.isArray(map.aliases) ? map.aliases.map(cleanText).filter(Boolean) : [],
        title: cleanText(map.title || map.name || fallbackMapTitle(beatmapId)),
        artist: cleanText(map.artist || ""),
        difficulty: cleanText(map.difficulty || map.version || ""),
        mapper: cleanText(map.mapper || map.mappers || map.creator || ""),
        sr: numberOrNull(map.sr || map.starRating),
        length: cleanText(map.length || map.drainLength || map.totalLength || "")
      };
    }).filter((map) => map.pick);
  }

  function findPoolMap(id, file, title, difficulty) {
    const exactId = cleanText(id);
    if (exactId) {
      const exact = maps.find((map) => cleanText(map.beatmapId) === exactId || map.aliases.some((alias) => cleanText(alias) === exactId));
      if (exact) return exact;
    }

    const needle = [exactId, file, title, difficulty]
      .map(cleanText)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!needle) return null;

    return maps.find((map) => {
      const values = [map.beatmapId, map.title, map.difficulty, ...map.aliases]
        .map(cleanText)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return values && (needle.includes(values) || values.includes(needle));
    }) || null;
  }

  function fallbackMapTitle(beatmapId) {
    const text = cleanText(beatmapId);
    if (!text) return "";
    if (/^\d+$/.test(text)) return `Beatmap ${text}`;
    return text.replace(/\.osu$/i, "");
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
    const leftPlayer = resolvePlayer("left");
    const rightPlayer = resolvePlayer("right");
    const pointCount = pointsToWin(resolveBestOf());
    const displayStars = resolveDisplayedStars(pointCount);
    const nextState = createRenderState(leftPlayer, rightPlayer, pointCount, displayStars);
    const previous = previousRenderState || nextState;

    setAnimatedText(dom.leftSeed, leftPlayer.seed, previous.leftSeed);
    setAnimatedText(dom.rightSeed, rightPlayer.seed, previous.rightSeed);
    setAnimatedText(dom.leftName, leftPlayer.name, previous.leftName);
    setAnimatedText(dom.rightName, rightPlayer.name, previous.rightName);
    dom.leftName.closest(".player").classList.toggle("has-seed", Boolean(leftPlayer.seed));
    dom.rightName.closest(".player").classList.toggle("has-seed", Boolean(rightPlayer.seed));
    fitPlayerName(dom.leftName, leftPlayer.name);
    fitPlayerName(dom.rightName, rightPlayer.name);

    dom.matchScore.hidden = !(liveState.visibility.stars || displayStars.overridden);
    dom.leftStars.hidden = !(liveState.visibility.stars || displayStars.overridden);
    dom.rightStars.hidden = !(liveState.visibility.stars || displayStars.overridden);
    renderStars(dom.leftStars, displayStars.left, pointCount, previous.leftStars, "left");
    renderStars(dom.rightStars, displayStars.right, pointCount, previous.rightStars, "right");
    setAnimatedText(dom.leftLiveScore, formatScore(displayStars.left), formatScore(previous.leftStars));
    setAnimatedText(dom.rightLiveScore, formatScore(displayStars.right), formatScore(previous.rightStars));
    setAnimatedText(dom.stageLabel, nextState.stage, previous.stage);
    renderGameplayScore(previous);
    renderBeatmap(previous);
    setAnimatedText(dom.commentatorList, matchData.commentators.join(" / "), previous.commentators);
    fitSingleLine(dom.commentatorList, matchData.commentators.join(" / "), 21, 16, 32);
    prepareBeatmapMarquee();

    setDiagnostics({
      players: `${leftPlayer.name} vs ${rightPlayer.name}`,
      stars: `${displayStars.left}-${displayStars.right} / ${pointCount}${displayStars.overridden ? " manual" : ""}`,
      score: `${liveState.gameplayScore.left}-${liveState.gameplayScore.right}`,
      beatmap: liveState.beatmap.title
    });
    previousRenderState = nextState;
  }

  function resolvePlayer(side) {
    const liveName = cleanText(liveState.players[side].name);
    const dataPlayer = matchData.players[side];

    return {
      name: liveName || dataPlayer.name,
      seed: dataPlayer.seed
    };
  }

  function resolveBestOf() {
    return normaliseBestOf(liveState.bestOf || matchData.bestOf);
  }

  function resolveStage() {
    try {
      const state = JSON.parse(localStorage.getItem("vct.match-mappool.state") || "{}");
      return cleanText(state.stageOverride) || matchData.stage;
    } catch (error) {
      return matchData.stage;
    }
  }

  function createRenderState(leftPlayer, rightPlayer, pointCount, displayStars) {
    return {
      leftSeed: leftPlayer.seed,
      rightSeed: rightPlayer.seed,
      leftName: leftPlayer.name,
      rightName: rightPlayer.name,
      leftStars: displayStars.left,
      rightStars: displayStars.right,
      stage: resolveStage(),
      leftScore: liveState.gameplayScore.left,
      rightScore: liveState.gameplayScore.right,
      scoreDifference: Math.abs(liveState.gameplayScore.left - liveState.gameplayScore.right),
      beatmapTitle: liveState.beatmap.title,
      beatmapMeta: formatBeatmapMeta(liveState.beatmap),
      beatmapPick: liveState.beatmap.pick,
      commentators: matchData.commentators.join(" / ")
    };
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
      left: clampNumber(liveState.stars.left, 0, pointCount),
      right: clampNumber(liveState.stars.right, 0, pointCount),
      overridden: false
    };
  }

  function readScoreOverride(pointCount = 99) {
    try {
      const saved = JSON.parse(localStorage.getItem(SCORE_OVERRIDE_KEY) || "{}");
      if (saved.enabled !== true) return { enabled: false, left: 0, right: 0 };

      return {
        enabled: true,
        left: clampNumber(saved.left, 0, pointCount),
        right: clampNumber(saved.right, 0, pointCount)
      };
    } catch (error) {
      localStorage.removeItem(SCORE_OVERRIDE_KEY);
      return { enabled: false, left: 0, right: 0 };
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
    if (point && event.currentTarget.contains(point)) {
      const value = Number(point.dataset.score);
      return Number.isFinite(value) ? value + offset : null;
    }

    const points = [...event.currentTarget.querySelectorAll("img")];
    if (!points.length) return null;

    const bounds = event.currentTarget.getBoundingClientRect();
    const step = bounds.width / points.length;
    const index = Math.max(0, Math.min(points.length - 1, Math.floor((event.clientX - bounds.left) / step)));
    const score = event.currentTarget.classList.contains("point-track-right")
      ? points.length - index
      : index + 1;
    return score + offset;
  }

  function setManualScore(side, value) {
    const pointCount = pointsToWin(resolveBestOf());
    const saved = readScoreOverride(pointCount);
    const base = saved.enabled
      ? saved
      : {
        left: clampNumber(liveState.stars.left, 0, pointCount),
        right: clampNumber(liveState.stars.right, 0, pointCount)
      };
    const next = {
      enabled: true,
      left: base.left,
      right: base.right
    };

    next[side] = clampNumber(value, 0, pointCount);
    localStorage.setItem(SCORE_OVERRIDE_KEY, JSON.stringify(next));
    queueRender();
    setControlStatus(`Manual score: ${next.left} - ${next.right}. Ctrl+click the point track to use tosu again.`);
  }

  function clearManualScore() {
    localStorage.removeItem(SCORE_OVERRIDE_KEY);
    queueRender();
    setControlStatus("Using tosu score again.");
  }

  function renderStars(container, value, count, previousValue, side) {
    container.innerHTML = "";
    setPointSizing(container, count);
    const filled = clampNumber(value, 0, count);

    for (let index = 0; index < count; index += 1) {
      const score = side === "right" ? count - index : index + 1;
      const point = document.createElement("img");
      point.src = score <= filled ? FULL_POINT : EMPTY_POINT;
      point.alt = "";
      point.dataset.score = String(score);
      point.draggable = false;
      if (score === filled && filled > previousValue) {
        point.classList.add("is-new-point");
      }
      container.appendChild(point);
    }
  }

  function setPointSizing(container, count) {
    const maxWidth = 430;
    const defaultWidth = 67;
    const defaultHeight = 37;
    const gap = count > 5 ? 4 : 5;
    const width = Math.min(defaultWidth, Math.floor((maxWidth - gap * (count - 1)) / count));
    const height = Math.round((width / defaultWidth) * defaultHeight);

    container.style.setProperty("--point-gap", `${gap}px`);
    container.style.setProperty("--point-width", `${width}px`);
    container.style.setProperty("--point-height", `${height}px`);
  }

  function renderGameplayScore(previous) {
    const leftScore = numberOrZero(liveState.gameplayScore.left);
    const rightScore = numberOrZero(liveState.gameplayScore.right);
    const difference = Math.abs(leftScore - rightScore);
    const leftIsWinning = leftScore > rightScore;
    const rightIsWinning = rightScore > leftScore;
    const barWidth = Math.min(710, Math.round((difference / 150000) * 710));
    const showWin = liveState.ipcState === 4 && difference > 0;

    dom.gameScorePanel.hidden = !liveState.visibility.score;
    setAnimatedText(dom.leftGameplayScore, formatScore(leftScore), formatScore(previous.leftScore));
    setAnimatedText(dom.rightGameplayScore, formatScore(rightScore), formatScore(previous.rightScore));
    setAnimatedText(dom.diffLeft, `+${formatScore(difference)}`, `+${formatScore(previous.scoreDifference)}`);
    setAnimatedText(dom.diffRight, `+${formatScore(difference)}`, `+${formatScore(previous.scoreDifference)}`);

    dom.leftScoreBar.style.width = leftIsWinning ? `${barWidth}px` : "0";
    dom.rightScoreBar.style.width = rightIsWinning ? `${barWidth}px` : "0";
    dom.diffLeft.style.opacity = leftIsWinning ? "1" : "0";
    dom.diffRight.style.opacity = rightIsWinning ? "1" : "0";
    dom.leftWin.style.opacity = showWin && leftIsWinning ? "1" : "0";
    dom.rightWin.style.opacity = showWin && rightIsWinning ? "1" : "0";
    dom.leftGameplayScore.style.fontWeight = leftIsWinning ? "700" : "400";
    dom.rightGameplayScore.style.fontWeight = rightIsWinning ? "700" : "400";
  }

  function renderBeatmap(previous) {
    const beatmap = liveState.beatmap;
    const meta = formatBeatmapMeta(beatmap) || diagnostics.socket;
    setAnimatedText(dom.beatmapPick, beatmap.pick || "NM", previous.beatmapPick);
    setAnimatedText(dom.beatmapTitle, beatmap.title || "Waiting for current beatmap", previous.beatmapTitle);
    setAnimatedText(dom.beatmapMeta, meta, previous.beatmapMeta);
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
    const score = manager.gameplay?.score || {};
    const bools = manager.bools || {};

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
      ipcState: numberOrZero(manager.ipcState),
      visibility: {
        score: bools.scoreVisible !== false,
        stars: bools.starsVisible !== false
      },
      beatmap: extractBeatmap(data)
    };
  }

  function extractBeatmap(data) {
    const bm = data?.menu?.bm || {};
    const metadata = bm.metadata || {};
    const stats = bm.stats || {};
    const bpm = stats.BPM || stats.bpm || {};
    const time = bm.time || {};
    const mods = formatMods(data?.menu?.mods);
    const id = cleanText(bm.id || bm.beatmapId);
    const file = cleanText(bm.path?.file || bm.file);
    const title = cleanText(metadata.title || bm.title);
    const difficulty = cleanText(metadata.difficulty || metadata.version || bm.difficulty);
    const poolMap = findPoolMap(id, file, title, difficulty);
    const rawAr = numberOrNull(stats.AR ?? stats.ar ?? stats.approachRate);
    const rawCs = numberOrNull(stats.CS ?? stats.cs ?? stats.circleSize);

    return {
      pick: poolMap?.pick || (title || id || file ? "MAP" : "NM"),
      title: title || poolMap?.title || "Waiting for current beatmap",
      artist: cleanText(metadata.artist || bm.artist) || poolMap?.artist || "",
      difficulty: difficulty || poolMap?.difficulty || "",
      mapper: cleanText(metadata.mapper || metadata.creator || bm.mapper) || poolMap?.mapper || "",
      mods,
      bpmMin: moddedBpm(numberOrNull(bpm.min ?? stats.bpmMin ?? stats.minBPM ?? stats.bpmMin), mods),
      bpmMax: moddedBpm(numberOrNull(bpm.max ?? stats.bpmMax ?? stats.maxBPM ?? stats.bpmMax), mods),
      sr: numberOrNull(stats.fullSR ?? stats.SR ?? stats.starRating ?? poolMap?.sr),
      ar: rawAr == null ? numberOrNull(stats.memoryAR) : moddedAr(rawAr, mods),
      cs: rawCs == null ? numberOrNull(stats.memoryCS) : moddedCs(rawCs, mods),
      od: numberOrNull(stats.memoryOD ?? stats.OD),
      length: formatLength(moddedLength(time.full ?? time.mp3 ?? bm.length, mods)) || poolMap?.length || ""
    };
  }

  function prepareBeatmapMarquee() {
    dom.beatmapTitleWrap.classList.remove("is-long");
    dom.beatmapTitle.style.removeProperty("--duration");
    dom.beatmapTitle.style.removeProperty("--wrap-width");

    requestAnimationFrame(() => {
      const overflow = dom.beatmapTitle.scrollWidth > dom.beatmapTitleWrap.clientWidth + 4;
      dom.beatmapTitleWrap.classList.toggle("is-long", overflow);
      if (overflow) {
        const duration = Math.max(10, Math.min(24, dom.beatmapTitle.scrollWidth / 34));
        dom.beatmapTitle.style.setProperty("--duration", `${duration}s`);
        dom.beatmapTitle.style.setProperty("--wrap-width", `${dom.beatmapTitleWrap.clientWidth}px`);
      }
    });
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
    if (!value) return fallbackData.commentators;
    const values = Array.isArray(value) ? value : String(value).split(/[,&/]+/);
    const commentators = values.map((item) => cleanText(item.name || item)).filter(Boolean);
    return commentators.length ? commentators : fallbackData.commentators;
  }

  function normaliseBestOf(value) {
    const match = cleanText(value).match(/\d+/);
    const number = match ? Number(match[0]) : Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallbackData.bestOf;
    return Math.max(1, Math.min(15, Math.floor(number)));
  }

  function pointsToWin(bestOf) {
    return Math.ceil(bestOf / 2);
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
      ipcState: 0,
      visibility: {
        score: true,
        stars: true
      },
      beatmap: {
        pick: "NM",
        title: "Waiting for current beatmap",
        artist: "",
        difficulty: "",
        mapper: "",
        mods: ""
      }
    };
  }

  function setDiagnostics(next) {
    Object.assign(diagnostics, next);
    if (!debugMode) return;

    dom.diagnosticsPanel.textContent = [
      "VCT match diagnostics",
      `JSON: ${diagnostics.json}`,
      `Tosu: ${diagnostics.socket}`,
      `WS: ${socketUrl}`,
      `Players: ${diagnostics.players}`,
      `Stars: ${diagnostics.stars}`,
      `Score: ${diagnostics.score}`,
      `Beatmap: ${diagnostics.beatmap}`
    ].join("\n");
  }

  function setControlStatus(message) {
    dom.controlStatus.textContent = message || "";
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

  function formatBeatmapMeta(beatmap) {
    return [
      beatmap.artist,
      beatmap.difficulty ? `[${beatmap.difficulty}]` : "",
      formatBpm(beatmap),
      formatStat("SR", beatmap.sr, 2),
      formatStat("AR", beatmap.ar, 1),
      formatStat("CS", beatmap.cs, 1),
      formatStat("OD", beatmap.od, 1),
      beatmap.length ? `LEN ${beatmap.length}` : "",
      beatmap.mapper ? `mapped by ${beatmap.mapper}` : ""
    ].filter(Boolean).join(" / ");
  }

  function formatBpm(beatmap) {
    const min = beatmap.bpmMin;
    const max = beatmap.bpmMax ?? min;
    if (min == null) return "";
    const minText = formatStatNumber(min, 0);
    const maxText = formatStatNumber(max, 0);
    return minText === maxText ? `BPM ${minText}` : `BPM ${minText}-${maxText}`;
  }

  function formatStat(label, value, decimals) {
    if (value == null) return "";
    return `${label} ${formatStatNumber(value, decimals)}`;
  }

  function formatStatNumber(value, decimals) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return number.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function formatLength(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function moddedBpm(value, mods) {
    if (value == null) return null;
    return hasSpeedUp(mods) ? value * 1.5 : value;
  }

  function moddedLength(value, mods) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return hasSpeedUp(mods) ? ms / 1.5 : ms;
  }

  function moddedAr(value, mods) {
    if (value == null) return null;
    let ar = value;
    if (hasMod(mods, "HR")) ar = Math.min(10, ar * 1.4);
    if (hasSpeedUp(mods)) ar = msToAr(arToMs(ar) / 1.5);
    return ar;
  }

  function moddedCs(value, mods) {
    if (value == null) return null;
    return hasMod(mods, "HR") ? Math.min(10, value * 1.3) : value;
  }

  function arToMs(ar) {
    return ar < 5 ? 1800 - (120 * ar) : 1200 - (150 * (ar - 5));
  }

  function msToAr(ms) {
    return ms > 1200 ? (1800 - ms) / 120 : 5 + ((1200 - ms) / 150);
  }

  function hasSpeedUp(mods) {
    return hasMod(mods, "DT") || hasMod(mods, "NC");
  }

  function hasMod(mods, mod) {
    return cleanText(mods).toUpperCase().includes(mod);
  }

  function formatScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return number.toLocaleString("en-US");
  }

  function formatMods(value) {
    if (!value) return "";
    if (typeof value === "string") return cleanText(value).toUpperCase();
    if (Array.isArray(value)) return value.map((mod) => cleanText(mod.acronym || mod.name || mod)).filter(Boolean).join("");
    return cleanText(value.str || value.name || value.acronym).toUpperCase();
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clampNumber(value, min, max) {
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

    close() {
      this.closedByUser = true;
      this.ws?.close();
    }
  }
})();

(function () {
  "use strict";

  const DATA_URL = "../../data/mappool-showcase.json";
  const STORAGE_KEY = "vct.mappoolShowcase.data";
  const DEFAULT_TOSU_HOST = "127.0.0.1:24050";
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const ROUND_FRAMES = {
    qualifiers: "../../assets/vct/showcase-rounds/frame/Qualifier.png",
    qualifier: "../../assets/vct/showcase-rounds/frame/Qualifier.png",
    ro32: "../../assets/vct/showcase-rounds/frame/RO32.png",
    ro16: "../../assets/vct/showcase-rounds/frame/RO16.png",
    qf: "../../assets/vct/showcase-rounds/frame/Quarterfinals.png",
    quarterfinals: "../../assets/vct/showcase-rounds/frame/Quarterfinals.png",
    sf: "../../assets/vct/showcase-rounds/frame/Semifinals.png",
    semifinals: "../../assets/vct/showcase-rounds/frame/Semifinals.png",
    finals: "../../assets/vct/showcase-rounds/frame/Finals.png",
    f: "../../assets/vct/showcase-rounds/frame/Finals.png",
    gf: "../../assets/vct/showcase-rounds/frame/Grandfinals.png",
    grandfinals: "../../assets/vct/showcase-rounds/frame/Grandfinals.png",
    "grand-finals": "../../assets/vct/showcase-rounds/frame/Grandfinals.png"
  };

  const fallbackData = {
    tournament: "Vietnamese osu!catch Tournament",
    stage: "Mappool Showcase",
    stages: [
      { name: "Qualifiers", key: "qualifiers", frame: "../../assets/vct/showcase-rounds/frame/Qualifier.png" },
      { name: "Round of 32", key: "ro32", frame: "../../assets/vct/showcase-rounds/frame/RO32.png" },
      { name: "Round of 16", key: "ro16", frame: "../../assets/vct/showcase-rounds/frame/RO16.png" },
      { name: "Quarterfinals", key: "quarterfinals", frame: "../../assets/vct/showcase-rounds/frame/Quarterfinals.png" },
      { name: "Semifinals", key: "semifinals", frame: "../../assets/vct/showcase-rounds/frame/Semifinals.png" },
      { name: "Finals", key: "finals", frame: "../../assets/vct/showcase-rounds/frame/Finals.png" },
      { name: "Grand Finals", key: "grandfinals", frame: "../../assets/vct/showcase-rounds/frame/Grandfinals.png" }
    ],
    maps: [
      {
        pick: "NM1",
        beatmapId: "",
        title: "Add your mappool in data/mappool-showcase.json",
        artist: "VCT",
        difficulty: "Showcase",
        mapper: "VCT Staff",
        sr: "-.--",
        od: "-.-",
        bpm: "---",
        length: "--:--"
      },
      { pick: "NM2", beatmapId: "" },
      { pick: "NM3", beatmapId: "" },
      { pick: "NM4", beatmapId: "" },
      { pick: "NM5", beatmapId: "" },
      { pick: "HD1", beatmapId: "" },
      { pick: "HD2", beatmapId: "" },
      { pick: "HD3", beatmapId: "" },
      { pick: "HD4", beatmapId: "" },
      { pick: "HR1", beatmapId: "" },
      { pick: "HR2", beatmapId: "" },
      { pick: "HR3", beatmapId: "" },
      { pick: "HR4", beatmapId: "" },
      { pick: "DT1", beatmapId: "" },
      { pick: "DT2", beatmapId: "" },
      { pick: "DT3", beatmapId: "" },
      { pick: "DT4", beatmapId: "" },
      { pick: "TB", beatmapId: "" }
    ]
  };

  const dom = {
    body: document.body,
    originalTag: document.getElementById("originalTag"),
    customTag: document.getElementById("customTag"),
    mapTitle: document.getElementById("mapTitle"),
    mapArtist: document.getElementById("mapArtist"),
    mapDifficulty: document.getElementById("mapDifficulty"),
    mapMapper: document.getElementById("mapMapper"),
    titleWrap: document.getElementById("titleWrap"),
    artistWrap: document.getElementById("artistWrap"),
    difficultyWrap: document.getElementById("difficultyWrap"),
    mapperWrap: document.getElementById("mapperWrap"),
    mapSr: document.getElementById("mapSr"),
    mapOd: document.getElementById("mapOd"),
    mapBpm: document.getElementById("mapBpm"),
    mapLength: document.getElementById("mapLength"),
    beatmapArt: document.getElementById("beatmapArt"),
    pickQueue: document.getElementById("pickQueue"),
    vctFrame: document.getElementById("vctFrame"),
    ribbonTitle: document.getElementById("ribbonTitle"),
    connectionChip: document.getElementById("connectionChip"),
    diagnosticsPanel: document.getElementById("diagnosticsPanel"),
    controlStatus: document.getElementById("controlStatus"),
    reloadDataButton: document.getElementById("reloadDataButton"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    prevStageButton: document.getElementById("prevStageButton"),
    nextStageButton: document.getElementById("nextStageButton"),
    clearStorageButton: document.getElementById("clearStorageButton")
  };

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get("debug") === "1";
  const freshData = params.get("fresh") === "1";
  const initialStageParam = params.get("stage") || params.get("round");
  const initialPickParam = params.get("pick");
  const tosuHost = params.get("tosu") || (location.port === "24050" ? location.host : DEFAULT_TOSU_HOST);
  const tosuBase = `http://${tosuHost}`;
  const socketUrl = `ws://${tosuHost}/ws`;
  const diagnostics = {
    json: "loading",
    maps: "0",
    socket: "starting",
    live: "-",
    match: "-",
    url: socketUrl
  };

  let pool = fallbackData;
  let currentStageIndex = 0;
  let currentKey = "";
  let socket = null;
  let reconnectTimer = null;

  if (debugMode) {
    dom.body.classList.add("debug");
  }

  start();

  async function start() {
    wireControls();
    pool = await loadPoolData();
    normalisePool();
    renderQueue();
    setStage(resolveInitialStage());
    updateDetails(resolveInitialPick(), null, true);
    connectTosu();
  }

  function wireControls() {
    dom.reloadDataButton.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEY);
      pool = await loadPoolData();
      normalisePool();
      renderQueue();
      setStage(resolveInitialStage());
      updateDetails(resolveInitialPick(), null, true);
    });

    dom.jsonFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const json = JSON.parse(await file.text());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        pool = json;
        normalisePool();
        renderQueue();
        setStage(resolveInitialStage());
        updateDetails(resolveInitialPick(), null, true);
        setControlStatus(`Loaded ${file.name}. This JSON is saved in this browser until cleared.`);
      } catch (error) {
        setControlStatus(`Could not load ${file.name}: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    dom.prevStageButton.addEventListener("click", () => cycleStage(-1));
    dom.nextStageButton.addEventListener("click", () => cycleStage(1));
    dom.clearStorageButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      setControlStatus("Saved browser JSON cleared. Use Reload JSON to read the repo data again.");
    });
  }

  async function loadPoolData() {
    const saved = freshData ? null : localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setControlStatus("Loaded saved browser JSON. Clear it to use the repo data file again.");
        return parsed;
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      setDiagnostics({ json: `loaded ${DATA_URL}` });
      setControlStatus(`Loaded ${DATA_URL}.`);
      return json;
    } catch (error) {
      setDiagnostics({ json: `failed: ${error.message}` });
      setControlStatus(`Using built-in placeholder data. Could not read ${DATA_URL}: ${error.message}`);
      return structuredClone(fallbackData);
    }
  }

  function normalisePool() {
    const source = Array.isArray(pool) ? { maps: pool } : pool;

    pool = {
      tournament: source.tournament || fallbackData.tournament,
      stage: source.stage || fallbackData.stage,
      stages: Array.isArray(source.stages) && source.stages.length ? source.stages : fallbackData.stages,
      maps: pickMapList(source)
    };

    pool.stages = pool.stages.map(normaliseStage);
    pool.maps = pool.maps.map((map, index) => ({
      pick: map.pick || `MAP${index + 1}`,
      beatmapId: stringifyId(map.beatmapId || map.id || ""),
      aliases: Array.isArray(map.aliases) ? map.aliases.map(stringifyId) : [],
      title: map.title || "",
      artist: map.artist || "",
      difficulty: map.difficulty || map.version || "",
      mapper: map.mapper || map.mappers || "",
      sr: map.sr || map.starRating || "",
      od: map.od || "",
      bpm: map.bpm || "",
      length: map.length || "",
      background: normaliseBackgroundList(map.background),
      original: Boolean(map.original),
      custom: Boolean(map.custom || map.isCustom)
    }));
    setDiagnostics({ maps: String(pool.maps.length) });

    const stageIndex = pool.stages.findIndex((stage) => stage.name === pool.stage || stage.key === slugify(pool.stage));
    currentStageIndex = stageIndex >= 0 ? stageIndex : 0;
  }

  function pickMapList(source) {
    if (Array.isArray(source.maps) && source.maps.length) return source.maps;
    if (Array.isArray(source.beatmaps) && source.beatmaps.length) return source.beatmaps;
    if (Array.isArray(source.mappool) && source.mappool.length) return source.mappool;
    return fallbackData.maps;
  }

  function renderQueue(activePick) {
    dom.pickQueue.innerHTML = "";
    const activeIndex = pool.maps.findIndex((map) => map.pick === activePick);

    pool.maps.forEach((map, index) => {
      const item = document.createElement("div");
      item.className = "queue-pick";
      item.textContent = map.pick;
      if (map.pick === activePick) item.classList.add("is-active");
      if (activeIndex >= 0 && Math.abs(index - activeIndex) === 1) item.classList.add("is-near");
      dom.pickQueue.appendChild(item);
    });

    requestAnimationFrame(centerActivePick);
  }

  function connectTosu() {
    clearTimeout(reconnectTimer);

    socket = new ReconnectingSocket(socketUrl, {
      onOpen() {
        dom.connectionChip.textContent = "tosu connected";
        dom.connectionChip.classList.remove("is-warning");
        setDiagnostics({ socket: "connected" });
        setControlStatus("Connected to tosu.");
      },
      onClose() {
        dom.connectionChip.textContent = "tosu offline";
        dom.connectionChip.classList.add("is-warning");
        setDiagnostics({ socket: "closed / blocked" });
        setControlStatus("");
      },
      onMessage(event) {
        try {
          handleTosuData(JSON.parse(event.data));
        } catch (error) {
          console.warn("Could not parse tosu payload", error);
        }
      }
    });
  }

  function handleTosuData(data) {
    const live = extractLiveBeatmap(data);
    const key = `${live.id}|${live.file}|${live.sr}|${live.od}|${live.length}`;
    if (key === currentKey) return;
    currentKey = key;

    const poolMap = findPoolMap(live);
    setDiagnostics({
      live: `${live.id || "no id"} ${live.title || ""} [${live.difficulty || ""}]`,
      match: poolMap ? poolMap.pick : "no pool match"
    });
    updateDetails(poolMap || live, live, false);
  }

  function updateDetails(source, live, instant) {
    const item = {
      pick: source.pick || (live ? "LIVE" : "VCT"),
      title: live?.title || source.title || "Waiting for current beatmap",
      artist: live?.artist || source.artist || pool.tournament,
      difficulty: live?.difficulty || source.difficulty || inferCatchPool(source.pick),
      mapper: source.mapper || live?.mapper || "Unknown mapper",
      sr: formatStat(live?.sr || source.sr, "-.--"),
      od: formatStat(live?.od || source.od, "-.-"),
      bpm: formatBpm(live?.bpm || source.bpm),
      length: live?.length || source.length || "--:--",
      background: live?.background || source.background || "",
      original: Boolean(source.original),
      custom: Boolean(source.custom)
    };

    animateSwap(instant, () => {
      setText(dom.mapTitle, item.title);
      setText(dom.mapArtist, item.artist);
      setText(dom.mapDifficulty, item.difficulty);
      setText(dom.mapMapper, item.mapper);
      dom.mapSr.textContent = item.sr;
      dom.mapOd.textContent = item.od;
      dom.mapBpm.textContent = item.bpm;
      dom.mapLength.textContent = item.length;
      dom.originalTag.classList.toggle("is-visible", item.original);
      dom.customTag.classList.toggle("is-visible", item.custom);
      updateBackground(item.background);
      prepareMarquees();
      renderQueue(source.pick);
    });
  }

  function animateSwap(instant, update) {
    const animated = [
      dom.mapTitle.closest(".detail-block"),
      dom.mapArtist.closest(".detail-block"),
      dom.mapDifficulty.closest(".detail-block"),
      dom.mapMapper.closest(".detail-block"),
      document.querySelector(".stats-grid")
    ];

    if (instant) {
      update();
      return;
    }

    animated.forEach((element) => element.classList.add("is-changing"));
    window.setTimeout(() => {
      update();
      animated.forEach((element) => element.classList.remove("is-changing"));
    }, 210);
  }

  function updateBackground(source) {
    const sources = normaliseBackgroundList(source);
    const signature = sources.join("|");

    if (!sources.length) {
      dom.beatmapArt.dataset.src = "";
      dom.beatmapArt.dataset.pending = "";
      dom.beatmapArt.src = TRANSPARENT_PIXEL;
      return;
    }

    if (dom.beatmapArt.dataset.src === signature) return;
    dom.beatmapArt.dataset.src = signature;
    dom.beatmapArt.classList.add("is-changing");
    loadBackgroundCandidate(sources, 0);
  }

  function loadBackgroundCandidate(sources, index) {
    const src = sources[index];
    if (!src) {
      dom.beatmapArt.dataset.pending = "";
      dom.beatmapArt.src = TRANSPARENT_PIXEL;
      dom.beatmapArt.classList.remove("is-changing");
      return;
    }

    dom.beatmapArt.dataset.pending = src;
    dom.beatmapArt.onload = () => {
      if (dom.beatmapArt.dataset.pending !== src) return;
      dom.beatmapArt.classList.remove("is-changing");
    };
    dom.beatmapArt.onerror = () => {
      if (dom.beatmapArt.dataset.pending !== src) return;
      loadBackgroundCandidate(sources, index + 1);
    };
    window.setTimeout(() => {
      dom.beatmapArt.src = src;
    }, 180);
  }

  function findPoolMap(live) {
    const candidates = [live.id, live.file, live.fileNoExt, live.fullPath].filter(Boolean).map(stringifyId);

    return pool.maps.find((map) => {
      const values = [map.beatmapId, ...map.aliases].filter(Boolean);
      return values.some((value) => candidates.includes(stringifyId(value)));
    });
  }

  function extractLiveBeatmap(data) {
    const bm = data?.menu?.bm || {};
    const metadata = bm.metadata || {};
    const stats = bm.stats || {};
    const time = bm.time || {};
    const bpm = stats.BPM || stats.bpm || {};
    const path = bm.path || {};
    const file = path.file || "";
    const fullPath = path.full || "";

    return {
      id: stringifyId(bm.id || bm.beatmapId || ""),
      file,
      fileNoExt: file.replace(/\.osu$/i, ""),
      fullPath,
      pick: "LIVE",
      title: metadata.title || bm.title || "Unknown title",
      artist: metadata.artist || bm.artist || "Unknown artist",
      difficulty: metadata.difficulty || metadata.version || bm.difficulty || "Unknown difficulty",
      mapper: metadata.mapper || metadata.creator || bm.mapper || "Unknown mapper",
      sr: stats.fullSR || stats.SR || stats.starRating || "",
      od: stats.memoryOD || stats.OD || "",
      bpm: formatBpmRange(bpm.min, bpm.max) || stats.BPM || "",
      length: formatTime(time.full || time.mp3 || bm.length),
      background: getLiveBackgroundCandidates(bm, path)
    };
  }

  function cycleStage(direction) {
    currentStageIndex = (currentStageIndex + direction + pool.stages.length) % pool.stages.length;
    setStage(pool.stages[currentStageIndex]);
  }

  function setStage(stage) {
    const stageInfo = typeof stage === "object" ? stage : normaliseStage(stage);
    pool.stage = stageInfo.name;
    dom.body.dataset.stage = stageInfo.key;
    dom.ribbonTitle.textContent = `${pool.tournament} / ${stageInfo.name}`;
    dom.vctFrame.src = stageInfo.frame || ROUND_FRAMES[stageInfo.key] || fallbackData.stages[0].frame;
    requestAnimationFrame(centerActivePick);
  }

  function resolveInitialStage() {
    if (initialStageParam) {
      const wanted = slugify(initialStageParam);
      return pool.stages.find((stage) => stage.key === wanted || slugify(stage.name) === wanted) || normaliseStage(initialStageParam);
    }

    return pool.stages[currentStageIndex] || normaliseStage(pool.stage || fallbackData.stage);
  }

  function resolveInitialPick() {
    if (initialPickParam) {
      const wanted = stringifyId(initialPickParam).toLowerCase();
      return pool.maps.find((map) => map.pick.toLowerCase() === wanted) || pool.maps[0] || fallbackData.maps[0];
    }

    return pool.maps[0] || fallbackData.maps[0];
  }

  function normaliseStage(stage) {
    if (typeof stage === "object" && stage !== null) {
      const name = stage.name || stage.stage || stage.label || fallbackData.stage;
      const key = stage.key || slugify(name);
      return {
        name,
        key,
        frame: stage.frame || ROUND_FRAMES[key] || ROUND_FRAMES[slugify(name)] || fallbackData.stages[0].frame
      };
    }

    const name = stage || fallbackData.stage;
    const key = slugify(name);
    return {
      name,
      key,
      frame: ROUND_FRAMES[key] || fallbackData.stages[0].frame
    };
  }

  function centerActivePick() {
    const active = dom.pickQueue.querySelector(".queue-pick.is-active");
    const container = dom.pickQueue.parentElement;
    dom.pickQueue.style.transform = "translateX(0)";

    if (dom.pickQueue.scrollWidth <= container.clientWidth) {
      return;
    }

    if (!active) {
      return;
    }

    requestAnimationFrame(() => {
      const containerBox = container.getBoundingClientRect();
      const activeBox = active.getBoundingClientRect();
      const activeCenter = activeBox.left + activeBox.width / 2;
      const targetCenter = containerBox.left + containerBox.width / 2;
      dom.pickQueue.style.transform = `translateX(${targetCenter - activeCenter}px)`;
    });
  }

  function setControlStatus(message) {
    dom.controlStatus.textContent = debugMode ? message : "";
  }

  function setDiagnostics(next) {
    Object.assign(diagnostics, next);
    if (!debugMode) return;

    dom.diagnosticsPanel.textContent = [
      "VCT showcase diagnostics",
      `JSON: ${diagnostics.json}`,
      `Maps: ${diagnostics.maps}`,
      `Tosu: ${diagnostics.socket}`,
      `WS: ${diagnostics.url}`,
      `Live: ${diagnostics.live}`,
      `Match: ${diagnostics.match}`
    ].join("\n");
  }

  function setText(element, value) {
    element.textContent = value || "";
  }

  function prepareMarquees() {
    [
      [dom.titleWrap, dom.mapTitle],
      [dom.artistWrap, dom.mapArtist],
      [dom.difficultyWrap, dom.mapDifficulty],
      [dom.mapperWrap, dom.mapMapper]
    ].forEach(([wrap, text]) => {
      wrap.classList.remove("is-long");
      text.style.removeProperty("--duration");
      text.style.removeProperty("--wrap-width");

      requestAnimationFrame(() => {
        const overflow = text.scrollWidth > wrap.clientWidth + 4;
        wrap.classList.toggle("is-long", overflow);
        if (overflow) {
          const duration = Math.max(10, Math.min(24, text.scrollWidth / 28));
          text.style.setProperty("--duration", `${duration}s`);
          text.style.setProperty("--wrap-width", `${wrap.clientWidth}px`);
        }
      });
    });
  }

  function formatStat(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toFixed(fallback === "-.--" ? 2 : 1);
  }

  function formatBpm(value) {
    if (value === undefined || value === null || value === "") return "---";
    return String(value)
      .replace(/\s+/g, "")
      .replace(/(\d+(?:\.\d+)?)/g, (match) => String(Math.round(Number(match))));
  }

  function formatBpmRange(min, max) {
    const minNumber = Number(min);
    const maxNumber = Number(max);
    if (!Number.isFinite(minNumber) || !Number.isFinite(maxNumber)) return "";

    const roundedMin = Math.round(minNumber);
    const roundedMax = Math.round(maxNumber);
    return roundedMin === roundedMax ? String(roundedMin) : `${roundedMin}-${roundedMax}`;
  }

  function formatTime(ms) {
    const number = Number(ms);
    if (!Number.isFinite(number) || number <= 0) return "";
    const totalSeconds = Math.floor(number / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function stringifyId(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function normaliseBackgroundList(value) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((item) => stringifyId(item))
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index);
  }

  function getLiveBackgroundCandidates(bm, path) {
    const cacheBust = Date.now();
    const candidates = [`${tosuBase}/files/beatmap/background?v=${cacheBust}`];
    const folder = path.folder || path.dir || path.directory || "";
    const background = path.bg || path.background || path.image || bm.bg || bm.background || "";

    if (folder && background) {
      candidates.push(`${tosuBase}/Songs/${encodeBeatmapPath(`${folder}/${background}`)}?v=${cacheBust}`);
    }

    [
      path.full,
      path.beatmap,
      path.filePath,
      bm.pathFull,
      bm.backgroundPath
    ].forEach((candidate) => {
      if (candidate) candidates.push(`${tosuBase}/Songs/${encodeBeatmapPath(candidate)}?v=${cacheBust}`);
    });

    return normaliseBackgroundList(candidates);
  }

  function inferCatchPool(pick) {
    const code = stringifyId(pick).replace(/\d+$/g, "").toUpperCase();
    const labels = {
      RC: "Rain Catch",
      NM: "No Mod",
      HB: "Hyperdash",
      LN: "Low AR",
      SV: "Slider Velocity",
      TB: "Tiebreaker"
    };

    return labels[code] || "Catch";
  }

  function slugify(value) {
    const normalised = stringifyId(value)
      .toLowerCase()
      .replace(/round\s*of\s*32/g, "ro32")
      .replace(/round\s*of\s*16/g, "ro16")
      .replace(/grand\s*finals/g, "grandfinals")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return normalised || "qualifiers";
  }

  function encodeBeatmapPath(path) {
    return String(path)
      .split(/[\\/]/)
      .map((part) => encodeURIComponent(part))
      .join("/");
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

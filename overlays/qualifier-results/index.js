(function () {
  "use strict";

  const DATA_URL = "../../data/seeding.json";
  const STORAGE_KEY = "vct.qualifierResults.data.v4";
  const OLD_STORAGE_KEYS = [
    "vct.qualifierResults.data",
    "vct.qualifierResults.data.v2",
    "vct.qualifierResults.data.v3"
  ];
  const DEFAULT_AVATAR = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const DEFAULT_BRACKETS = [
    { mod: "NM", label: "NM", seedLabel: "NM Seed" },
    { mod: "HD", label: "HD", seedLabel: "HD Seed" },
    { mod: "HR", label: "HR", seedLabel: "HR Seed" },
    { mod: "DT", label: "DT", seedLabel: "DT Seed" }
  ];

  const fallbackData = {
    tournament: "Vietnamese osu!catch Tournament",
    title: "Qualifier Results",
    brackets: DEFAULT_BRACKETS,
    maps: [],
    players: []
  };

  const dom = {
    playerAvatar: document.getElementById("playerAvatar"),
    avatarFallback: document.getElementById("avatarFallback"),
    playerName: document.getElementById("playerName"),
    playerCountry: document.getElementById("playerCountry"),
    globalRank: document.getElementById("globalRank"),
    qualifierSeed: document.getElementById("qualifierSeed"),
    percentMaxSum: document.getElementById("percentMaxSum"),
    averageScore: document.getElementById("averageScore"),
    bracketList: document.getElementById("bracketList"),
    emptyState: document.getElementById("emptyState"),
    controlStatus: document.getElementById("controlStatus"),
    reloadDataButton: document.getElementById("reloadDataButton"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    prevPlayerButton: document.getElementById("prevPlayerButton"),
    nextPlayerButton: document.getElementById("nextPlayerButton"),
    playerSelect: document.getElementById("playerSelect"),
    clearStorageButton: document.getElementById("clearStorageButton")
  };

  const params = new URLSearchParams(window.location.search);
  const freshData = params.get("fresh") === "1";
  const playerParam = params.get("player");
  const indexParam = params.get("index");

  let data = structuredClone(fallbackData);
  let playerIndex = 0;

  start();

  async function start() {
    clearOldSavedData();
    wireControls();
    data = await loadData();
    normaliseData();
    playerIndex = resolveInitialPlayerIndex();
    renderPlayerOptions();
    render();
  }

  function clearOldSavedData() {
    OLD_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }

  function wireControls() {
    dom.reloadDataButton.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEY);
      data = await loadData();
      normaliseData();
      playerIndex = resolveInitialPlayerIndex();
      renderPlayerOptions();
      render();
    });

    dom.jsonFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const json = JSON.parse(await file.text());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        data = json;
        normaliseData();
        playerIndex = 0;
        renderPlayerOptions();
        render();
        setControlStatus(`Loaded ${file.name}. This JSON is saved in this browser until cleared.`);
      } catch (error) {
        setControlStatus(`Could not load ${file.name}: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    dom.prevPlayerButton.addEventListener("click", () => cyclePlayer(-1));
    dom.nextPlayerButton.addEventListener("click", () => cyclePlayer(1));
    dom.playerSelect.addEventListener("change", () => {
      playerIndex = Number(dom.playerSelect.value) || 0;
      render();
    });
    dom.clearStorageButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      setControlStatus("Saved browser JSON cleared. Use Reload JSON to read the repo data again.");
    });
  }

  async function loadData() {
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
      setControlStatus(`Loaded ${DATA_URL}.`);
      return await response.json();
    } catch (error) {
      setControlStatus(`Using placeholder data. Could not read ${DATA_URL}: ${error.message}`);
      return structuredClone(fallbackData);
    }
  }

  function normaliseData() {
    const source = Array.isArray(data) ? { players: data } : data || {};
    const qualifierOverlay = source.overlays?.qualifierResults || source.qualifierResults || source.qualifier || {};
    const qualifierPool = source.mappools?.qualifiers || source.mappools?.qualifier || {};

    data = {
      tournament: getTournamentName(source.tournament) || fallbackData.tournament,
      title: cleanText(qualifierOverlay.title || source.title) || fallbackData.title,
      brackets: normaliseBrackets(qualifierOverlay.brackets || source.brackets),
      maps: normaliseMaps(qualifierOverlay.maps || qualifierPool.maps || source.maps || source.mappool || source.beatmaps),
      players: sortQualifierPlayers(normalisePlayers(source.players || source.results || source.seeds))
    };
    applyCalculatedBracketSeeds();
  }

  function normaliseBrackets(value) {
    const brackets = Array.isArray(value) && value.length ? value : DEFAULT_BRACKETS;

    return brackets.map((bracket) => {
      const mod = cleanText(bracket.mod || bracket.key || bracket.label).toUpperCase();
      return {
        mod,
        label: cleanText(bracket.label) || mod,
        seedLabel: cleanText(bracket.seedLabel || bracket.seed_label) || `${mod} Seed`
      };
    }).filter((bracket) => bracket.mod);
  }

  function normaliseMaps(value) {
    if (!Array.isArray(value)) return [];

    return value.map((map, index) => {
      const pick = cleanText(map.pick || map.slot || map.code || `MAP${index + 1}`).toUpperCase();
      const mod = cleanText(map.mod || map.bracket || inferModFromPick(pick)).toUpperCase();

      return {
        pick,
        mod,
        beatmapId: cleanText(map.beatmapId || map.id || ""),
        title: cleanText(map.title || map.song || "Untitled map"),
        artist: cleanText(map.artist || ""),
        difficulty: cleanText(map.difficulty || map.version || ""),
        mapper: cleanText(map.mapper || map.mappers || "")
      };
    });
  }

  function normalisePlayers(value) {
    if (!Array.isArray(value)) return [];

    return value.map((player, index) => {
      const qualifier = player.qualifier || player.qualifiers || player.qualifierResults || {};
      const summary = qualifier.summary || qualifier.metrics || player.summary || player.metrics || {};
      const ranks = player.ranks || {};

      return {
        id: cleanText(player.id || player.osuId || player.username || `player-${index + 1}`),
        osuId: cleanText(player.osuId || player.osu_id || ""),
        username: cleanText(player.username || player.name || `Player ${index + 1}`),
        country: cleanText(player.country || player.team || ""),
        countryCode: cleanText(player.countryCode || player.country_code || player.country?.code || ""),
        avatar: cleanText(player.avatar || player.avatarUrl || player.profilePicture || ""),
        globalRank: formatRank(ranks.catch || ranks.ctb || player.globalRank || player.catchRank || player.rank),
        countryRank: formatRank(ranks.catchCountry || ranks.countryCatch || ranks.catch_country || player.countryRank || player.catchCountryRank),
        qualifierSeed: formatRank(qualifier.seed || player.qualifierSeed || player.seed || player.overallSeed),
        qualifierSeedValue: parseRankNumber(qualifier.seed || player.qualifierSeed || player.seed || player.overallSeed),
        percentMaxSum: formatPercent(getFirstValue(
          qualifier.percentMaxSum,
          qualifier.percent_max_sum,
          qualifier.percentMax,
          qualifier["%max sum"],
          qualifier["%Max Sum"],
          qualifier["percent max sum"],
          qualifier["Percent Max Sum"],
          qualifier.maxPercentSum,
          qualifier.max_sum_percent,
          summary.percentMaxSum,
          summary.percent_max_sum,
          summary.percentMax,
          summary["%max sum"],
          summary["%Max Sum"],
          summary["percent max sum"],
          summary["Percent Max Sum"],
          summary.maxPercentSum,
          summary.max_sum_percent,
          player.percentMaxSum,
          player.percent_max_sum,
          player.percentMax,
          player["%max sum"],
          player["%Max Sum"],
          player["percent max sum"],
          player["Percent Max Sum"],
          player.maxPercentSum,
          player.max_sum_percent
        )),
        averageScore: formatScore(getFirstValue(
          qualifier.averageScore,
          qualifier.avgScore,
          qualifier.avg_score,
          qualifier["avg score"],
          qualifier["Avg Score"],
          qualifier["Avg. Score"],
          qualifier["average score"],
          qualifier["Average Score"],
          summary.averageScore,
          summary.avgScore,
          summary.avg_score,
          summary["avg score"],
          summary["Avg Score"],
          summary["Avg. Score"],
          summary["average score"],
          summary["Average Score"],
          player.averageScore,
          player.avgScore,
          player.avg_score,
          player["avg score"],
          player["Avg Score"],
          player["Avg. Score"],
          player["average score"],
          player["Average Score"]
        )),
        bracketSeeds: normaliseBracketSeeds(qualifier.bracketSeeds || player.bracketSeeds || player.modSeeds || player.brackets),
        scores: normaliseScores(qualifier.scores || player.scores || player.maps || player.results)
      };
    });
  }

  function normaliseBracketSeeds(value) {
    if (!value || typeof value !== "object") return {};

    if (Array.isArray(value)) {
      return Object.fromEntries(value.map((item) => [
        cleanText(item.mod || item.bracket || item.label).toUpperCase(),
        formatRank(item.seed || item.rank || item.value)
      ]));
    }

    return Object.fromEntries(Object.entries(value).map(([key, rank]) => [
      cleanText(key).toUpperCase(),
      formatRank(rank)
    ]));
  }

  function normaliseScores(value) {
    if (!value || typeof value !== "object") return {};

    if (Array.isArray(value)) {
      return Object.fromEntries(value.map((item) => [
        cleanText(item.pick || item.slot || item.code).toUpperCase(),
        normaliseScore(item)
      ]));
    }

    return Object.fromEntries(Object.entries(value).map(([pick, score]) => [
      cleanText(pick).toUpperCase(),
      normaliseScore(score)
    ]));
  }

  function normaliseScore(value) {
    if (typeof value === "number" || typeof value === "string") {
      return { score: formatScore(value), rank: "" };
    }

    return {
      score: formatScore(value?.score || value?.points || value?.value || ""),
      rank: formatRank(value?.rank || value?.seed || value?.placement || "")
    };
  }

  function resolveInitialPlayerIndex() {
    if (playerParam) {
      const wanted = cleanText(playerParam).toLowerCase();
      const index = data.players.findIndex((player) => (
        player.id.toLowerCase() === wanted ||
        player.username.toLowerCase() === wanted
      ));
      if (index >= 0) return index;
    }

    const index = Number(indexParam);
    if (Number.isInteger(index) && index >= 0 && index < data.players.length) return index;
    return 0;
  }

  function renderPlayerOptions() {
    dom.playerSelect.innerHTML = "";

    data.players.forEach((player, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${player.qualifierSeed || "-"} ${player.username}`;
      dom.playerSelect.appendChild(option);
    });
  }

  function render() {
    const player = data.players[playerIndex] || null;
    dom.emptyState.classList.toggle("is-visible", !player || !data.maps.length);
    dom.playerSelect.value = String(playerIndex);

    renderPlayer(player);
    renderBrackets(player);
  }

  function renderPlayer(player) {
    const name = player?.username || "Player Name";
    dom.playerName.textContent = name;
    dom.playerName.classList.toggle("is-placeholder", !player);
    fitPlayerName(name);
    dom.playerCountry.textContent = formatCountryLine(player);
    dom.globalRank.textContent = player?.globalRank || "-";
    dom.qualifierSeed.textContent = player?.qualifierSeed || "#---";
    dom.percentMaxSum.textContent = player?.percentMaxSum || "-";
    dom.averageScore.textContent = player?.averageScore || "-";
    dom.avatarFallback.textContent = getInitials(name);

    if (player?.avatar) {
      dom.playerAvatar.src = player.avatar;
      dom.playerAvatar.classList.add("is-visible");
    } else {
      dom.playerAvatar.src = DEFAULT_AVATAR;
      dom.playerAvatar.classList.remove("is-visible");
    }
  }

  function fitPlayerName(name) {
    const length = cleanText(name).length;
    const size = Math.max(25, Math.min(36, 40 - Math.max(0, length - 10) * 1.15));
    dom.playerName.style.setProperty("--name-size", `${size}px`);
  }

  function renderBrackets(player) {
    dom.bracketList.innerHTML = "";

    data.brackets.forEach((bracket) => {
      const maps = data.maps.filter((map) => map.mod === bracket.mod);
      const section = document.createElement("article");
      section.className = "bracket";
      section.dataset.mod = bracket.mod.toLowerCase();
      section.style.setProperty("--map-count", String(Math.max(1, maps.length)));

      const header = document.createElement("header");
      header.className = "bracket-header";
      const bracketSeed = player?.bracketSeeds?.[bracket.mod] || "";
      header.innerHTML = `
        <div class="mod-seed${bracketSeed ? "" : " is-empty"}">
          <strong>${escapeHtml(bracketSeed)}</strong>
        </div>
      `;
      section.appendChild(header);

      const rows = document.createElement("div");
      rows.className = "map-rows";

      maps.forEach((map) => {
        const score = player?.scores?.[map.pick] || {};
        const row = document.createElement("div");
        row.className = "map-row";
        row.innerHTML = `
          <div class="map-copy">
            <div class="map-title">${escapeHtml(formatMapLine(map))}</div>
          </div>
          <div class="map-score">${escapeHtml(score.score || "")}</div>
          <div class="map-rank">${escapeHtml(score.rank || "")}</div>
        `;
        rows.appendChild(row);
      });

      if (!maps.length) {
        const row = document.createElement("div");
        row.className = "map-row is-empty";
        row.innerHTML = `
          <div class="map-copy">
            <div class="map-title">No maps added for this bracket</div>
          </div>
          <div class="map-score"></div>
          <div class="map-rank"></div>
        `;
        rows.appendChild(row);
      }

      section.appendChild(rows);
      dom.bracketList.appendChild(section);
    });
  }

  function applyCalculatedBracketSeeds() {
    data.brackets.forEach((bracket) => {
      const maps = data.maps.filter((map) => map.mod === bracket.mod);
      const rows = [];

      data.players.forEach((player) => {
        player.bracketSeeds = player.bracketSeeds && typeof player.bracketSeeds === "object" ? player.bracketSeeds : {};
        const scores = maps.map((map) => player.scores?.[map.pick] || {});
        const ranks = scores.map((score) => parseRankNumber(score.rank));

        if (!maps.length || ranks.some((rank) => !Number.isFinite(rank))) {
          player.bracketSeeds[bracket.mod] = "";
          return;
        }

        rows.push({
          player,
          rankSum: ranks.reduce((sum, rank) => sum + rank, 0),
          scoreSum: scores.reduce((sum, score) => sum + parseScoreNumber(score.score), 0)
        });
      });

      rows.sort((a, b) => (
        a.rankSum - b.rankSum ||
        b.scoreSum - a.scoreSum ||
        a.player.qualifierSeedValue - b.player.qualifierSeedValue ||
        a.player.username.localeCompare(b.player.username)
      ));

      rows.forEach((row, index) => {
        row.player.bracketSeeds[bracket.mod] = formatRank(index + 1);
      });
    });
  }

  function cyclePlayer(direction) {
    if (!data.players.length) return;
    playerIndex = (playerIndex + direction + data.players.length) % data.players.length;
    render();
  }

  function setControlStatus(message) {
    dom.controlStatus.textContent = message || "";
  }

  function inferModFromPick(pick) {
    return cleanText(pick).replace(/\d+$/g, "").toUpperCase() || "NM";
  }

  function getTournamentName(value) {
    if (typeof value === "object" && value !== null) {
      return cleanText(value.name || value.title || value.shortName);
    }

    return cleanText(value);
  }

  function formatMapLine(map) {
    const title = cleanText(map.title) || "Untitled map";
    const mapper = cleanText(map.mapper);
    const artist = cleanText(map.artist);
    if (mapper) return `${title} by ${mapper}`;
    if (artist) return `${title} by ${artist}`;
    return title;
  }

  function formatScore(value) {
    const text = cleanText(value);
    if (!text) return "";
    const number = Number(text.replace(/,/g, ""));
    return Number.isFinite(number) ? number.toLocaleString("en-US") : text;
  }

  function parseScoreNumber(value) {
    const number = Number(cleanText(value).replace(/[,\s]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function formatCountryLine(player) {
    if (!player) return "";

    const flag = getCountryFlag(player.countryCode);
    if (player.countryRank || flag) return [player.countryRank || "#---", flag].filter(Boolean).join(" ");
    return [player.country, flag].filter(Boolean).join(" ");
  }

  function getCountryFlag(countryCode) {
    const code = cleanText(countryCode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return "";

    return [...code]
      .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
      .join("");
  }

  function formatPercent(value) {
    const text = cleanText(value);
    if (!text) return "";
    if (text === "-") return "-";
    const numeric = Number(text.replace(/%/g, "").replace(/,/g, ""));
    if (!Number.isFinite(numeric)) return text;
    const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
    return `${formatDecimal(percent, 3)}%`;
  }

  function formatDecimal(value, maximumFractionDigits = 2) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits
    });
  }

  function formatRank(value) {
    const text = cleanText(value);
    if (text === "-") return "-";
    if (!text) return "";
    return text.startsWith("#") ? text : `#${text}`;
  }

  function parseRankNumber(value) {
    const text = cleanText(value).replace(/^#/g, "");
    if (!text) return Number.NaN;
    const number = Number(text);
    return Number.isFinite(number) ? number : Number.NaN;
  }

  function sortQualifierPlayers(players) {
    return players
      .filter((player) => Number.isFinite(player.qualifierSeedValue) && hasQualifierResultData(player))
      .sort((a, b) => a.qualifierSeedValue - b.qualifierSeedValue || a.username.localeCompare(b.username));
  }

  function hasQualifierResultData(player) {
    return Object.values(player.scores || {}).some((score) => (
      cleanText(score.score) || cleanText(score.rank)
    ));
  }

  function getInitials(value) {
    const words = cleanText(value).split(/\s+/).filter(Boolean);
    if (!words.length) return "VCT";
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function cleanText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function getFirstValue(...values) {
    return values.find((value) => cleanText(value));
  }

  function escapeHtml(value) {
    return cleanText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();

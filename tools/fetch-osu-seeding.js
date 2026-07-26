const fs = require("fs");

const args = process.argv.slice(2);
const dataFile = args.find((arg) => !arg.startsWith("--")) || "data/seeding.json";
const syncPlayers = !args.includes("--maps-only");
const syncMaps = !args.includes("--players-only");
const clientId = process.env.OSU_CLIENT_ID;
const clientSecret = process.env.OSU_CLIENT_SECRET;
const MODE = "fruits";
const API_BASE = "https://osu.ppy.sh/api/v2";

if (!clientId || !clientSecret) {
  console.error("Missing OSU_CLIENT_ID or OSU_CLIENT_SECRET.");
  console.error("PowerShell example:");
  console.error("$env:OSU_CLIENT_ID='12345'; $env:OSU_CLIENT_SECRET='your_secret'; node tools/fetch-osu-seeding.js");
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const token = await getAccessToken();
  const summary = { players: 0, maps: 0, failed: [] };

  if (syncPlayers) {
    summary.players = await syncPlayerData(token, data, summary.failed);
  }

  if (syncMaps) {
    summary.maps = await syncBeatmapData(token, data, summary.failed);
  }

  if (!Array.isArray(data)) {
    data.updatedAt = new Date().toISOString();
    data.sources = {
      ...(data.sources || {}),
      osuApi: {
        version: "v2",
        mode: MODE,
        syncedAt: data.updatedAt
      }
    };
  }

  fs.writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Updated ${summary.players} player(s) and ${summary.maps} map(s) in ${dataFile}.`);

  if (summary.failed.length) {
    console.log("Failed lookups:");
    summary.failed.forEach((item) => console.log(`- ${item}`));
  }
}

async function syncPlayerData(token, data, failed) {
  const players = Array.isArray(data.players) ? data.players : [];
  if (!players.length) {
    console.warn(`No players found in ${dataFile}.`);
    return 0;
  }

  let updated = 0;
  const idPlayers = players.filter((player) => clean(player.osuId || player.osu_id));
  const usernamePlayers = players.filter((player) => !clean(player.osuId || player.osu_id));

  for (const chunk of chunkArray(idPlayers, 50)) {
    const users = await getUsers(token, chunk.map((player) => clean(player.osuId || player.osu_id)));
    const byId = new Map(users.map((user) => [String(user.id), user]));

    for (const player of chunk) {
      const id = clean(player.osuId || player.osu_id);
      const user = byId.get(id);

      if (!user) {
        failed.push(`${player.username || id}: osu! user id ${id} was not returned by /users`);
        continue;
      }

      applyUser(player, user);
      updated += 1;
      console.log(`${player.username}: catch rank ${player.ranks?.catch || "-"}`);
    }

    await wait(160);
  }

  for (const player of usernamePlayers) {
    const username = clean(player.username || player.name || player.id);
    if (!username) {
      failed.push(`${player.id || "(missing id)"}: missing osuId and username`);
      continue;
    }

    try {
      const user = await getUser(token, { key: "username", value: username });
      applyUser(player, user);
      updated += 1;
      console.log(`${player.username}: catch rank ${player.ranks?.catch || "-"}`);
    } catch (error) {
      failed.push(`${username}: ${error.message}`);
    }

    await wait(160);
  }

  return updated;
}

async function syncBeatmapData(token, data, failed) {
  const maps = getAllMaps(data);
  const mapsWithIds = maps.filter((map) => clean(map.beatmapId || map.id));

  if (!mapsWithIds.length) {
    console.warn(`No beatmap IDs found in ${dataFile}.`);
    return 0;
  }

  let updated = 0;

  for (const chunk of chunkArray(mapsWithIds, 50)) {
    const ids = chunk.map((map) => clean(map.beatmapId || map.id));
    const beatmaps = await getBeatmaps(token, ids);
    const byId = new Map(beatmaps.map((beatmap) => [String(beatmap.id), beatmap]));

    for (const map of chunk) {
      const id = clean(map.beatmapId || map.id);
      const beatmap = byId.get(id);

      if (!beatmap) {
        failed.push(`${map.pick || id}: beatmap id ${id} was not returned by /beatmaps`);
        continue;
      }

      applyBeatmap(map, beatmap);
      updated += 1;
      console.log(`${map.pick || id}: ${map.artist} - ${map.title} [${map.difficulty}]`);
    }

    await wait(160);
  }

  return updated;
}

async function getAccessToken() {
  const response = await fetch("https://osu.ppy.sh/oauth/token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: Number(clientId),
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "public"
    })
  });

  if (!response.ok) {
    throw new Error(`Could not get osu! access token: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  if (!json.access_token) throw new Error("osu! token response did not include access_token.");
  return json.access_token;
}

async function getUsers(token, ids) {
  const url = new URL(`${API_BASE}/users`);
  ids.forEach((id) => url.searchParams.append("ids[]", id));

  const response = await apiGet(token, url);
  return Array.isArray(response.users) ? response.users : [];
}

async function getUser(token, lookup) {
  const url = new URL(`${API_BASE}/users/${encodeURIComponent(lookup.value)}/${MODE}`);
  url.searchParams.set("key", lookup.key);
  return apiGet(token, url);
}

async function getBeatmaps(token, ids) {
  const url = new URL(`${API_BASE}/beatmaps`);
  ids.forEach((id) => url.searchParams.append("ids[]", id));

  const response = await apiGet(token, url);
  return Array.isArray(response.beatmaps) ? response.beatmaps : [];
}

async function apiGet(token, url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Could not fetch ${url.pathname}: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function applyUser(player, user) {
  const statistics = user.statistics_rulesets?.fruits || user.statistics || {};
  const country = user.country || {};

  player.id = clean(player.id) || String(user.id);
  player.osuId = String(user.id || player.osuId || "");
  player.username = user.username || player.username;
  player.profileUrl = `https://osu.ppy.sh/users/${player.osuId}/${MODE}`;
  player.avatar = user.avatar_url || player.avatar || "";
  player.cover = {
    url: user.cover_url || user.cover?.url || "",
    customUrl: user.cover?.custom_url || "",
    id: user.cover?.id || null
  };
  player.country = country.name || player.country || "";
  player.countryCode = country.code || player.countryCode || "";
  player.isRestricted = Boolean(user.is_restricted);

  player.ranks = player.ranks && typeof player.ranks === "object" ? player.ranks : {};
  player.ranks.catch = formatRank(statistics.global_rank) || (player.ranks.catch === "-" ? "-" : "");
  player.ranks.catchCountry = formatRank(statistics.country_rank);

  player.stats = player.stats && typeof player.stats === "object" ? player.stats : {};
  player.stats.catch = {
    pp: numberOrNull(statistics.pp),
    accuracy: numberOrNull(statistics.hit_accuracy),
    playCount: numberOrNull(statistics.play_count),
    playTime: numberOrNull(statistics.play_time),
    rankedScore: numberOrNull(statistics.ranked_score),
    totalScore: numberOrNull(statistics.total_score),
    maxCombo: numberOrNull(statistics.maximum_combo),
    replaysWatched: numberOrNull(statistics.replays_watched_by_others),
    level: numberOrNull(statistics.level?.current),
    gradeCounts: {
      ssh: numberOrNull(statistics.grade_counts?.ssh),
      ss: numberOrNull(statistics.grade_counts?.ss),
      sh: numberOrNull(statistics.grade_counts?.sh),
      s: numberOrNull(statistics.grade_counts?.s),
      a: numberOrNull(statistics.grade_counts?.a)
    }
  };
}

function applyBeatmap(map, beatmap) {
  const set = beatmap.beatmapset || {};
  const covers = set.covers || {};
  const owners = Array.isArray(beatmap.owners) && beatmap.owners.length
    ? beatmap.owners.map((owner) => owner.username).filter(Boolean)
    : [];

  map.beatmapId = String(beatmap.id || map.beatmapId || "");
  map.beatmapSetId = String(beatmap.beatmapset_id || set.id || map.beatmapSetId || "");
  map.url = beatmap.url || map.url || `https://osu.ppy.sh/beatmapsets/${map.beatmapSetId}#${beatmap.mode || MODE}/${map.beatmapId}`;
  map.mode = beatmap.mode || map.mode || "";
  map.status = beatmap.status || map.status || "";
  map.artist = set.artist || map.artist || "";
  map.artistUnicode = set.artist_unicode || map.artistUnicode || "";
  map.title = set.title || map.title || "";
  map.titleUnicode = set.title_unicode || map.titleUnicode || "";
  map.difficulty = beatmap.version || map.difficulty || "";
  map.mapper = owners.join(", ") || set.creator || map.mapper || "";
  map.sr = round(beatmap.difficulty_rating, 2);
  map.ar = round(beatmap.ar, 1);
  map.cs = round(beatmap.cs, 1);
  map.od = round(beatmap.accuracy, 1);
  map.hp = round(beatmap.drain, 1);
  map.bpm = round(beatmap.bpm, 2);
  map.drainLength = formatSeconds(beatmap.hit_length);
  map.drainLengthSeconds = numberOrNull(beatmap.hit_length);
  map.totalLength = formatSeconds(beatmap.total_length);
  map.totalLengthSeconds = numberOrNull(beatmap.total_length);
  map.maxCombo = numberOrNull(beatmap.max_combo);
  map.cover = {
    list: covers.list || "",
    card: covers.card || "",
    cover: covers.cover || "",
    slimcover: covers.slimcover || "",
    "list@2x": covers["list@2x"] || "",
    "card@2x": covers["card@2x"] || "",
    "cover@2x": covers["cover@2x"] || "",
    "slimcover@2x": covers["slimcover@2x"] || ""
  };
}

function getAllMaps(data) {
  if (Array.isArray(data)) return data;

  const pools = data.mappools && typeof data.mappools === "object" ? Object.values(data.mappools) : [];
  const poolMaps = pools.flatMap((pool) => Array.isArray(pool.maps) ? pool.maps : []);

  if (poolMaps.length) return poolMaps;
  if (Array.isArray(data.maps)) return data.maps;
  if (Array.isArray(data.mappool)) return data.mappool;
  if (Array.isArray(data.beatmaps)) return data.beatmaps;

  return [];
}

function formatRank(value) {
  const text = clean(value);
  if (text === "-") return "-";
  if (!text) return "";
  return text.startsWith("#") ? text : `#${text}`;
}

function formatSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const minutes = Math.floor(number / 60);
  const seconds = String(Math.floor(number % 60)).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number(number.toFixed(digits));
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

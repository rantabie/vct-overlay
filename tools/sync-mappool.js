const fs = require("fs");

const args = process.argv.slice(2);
const sourceFile = args.find((arg) => !arg.startsWith("--")) || "data/mappool.json";
const outArg = args.find((arg) => arg.startsWith("--out="));
const outputFile = outArg ? outArg.slice("--out=".length) : "data/mappool.cache.json";
const clientId = process.env.OSU_CLIENT_ID;
const clientSecret = process.env.OSU_CLIENT_SECRET;
const MODE = "fruits";
const API_BASE = "https://osu.ppy.sh/api/v2";
const PUBLIC_API_BASE = "https://mirror.hinamizawa.ai/v3/osu/beatmaps";
const USER_AGENT = "vct-overlay-mappool-sync/1.0 (+https://github.com/rantabie/vct-overlay)";

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const maps = getMapList(source);
  const hasOfficialCredentials = Boolean(clientId && clientSecret);
  const token = hasOfficialCredentials ? await getAccessToken() : "";
  const ids = maps.map((map) => clean(map.beatmapId || map.id)).filter(Boolean);
  const beatmaps = hasOfficialCredentials
    ? await getBeatmaps(token, ids)
    : await getPublicBeatmaps(ids);
  const beatmapsById = new Map(beatmaps.map((beatmap) => [String(beatmap.id), beatmap]));
  const outputMaps = [];
  const failed = [];

  if (!hasOfficialCredentials) {
    console.log("OSU_CLIENT_ID/OSU_CLIENT_SECRET not set; using public beatmap metadata fallback.");
  }

  for (const map of maps) {
    const id = clean(map.beatmapId || map.id);
    if (!id) {
      outputMaps.push({ ...map });
      continue;
    }

    const beatmap = beatmapsById.get(id);
    if (!beatmap) {
      failed.push(`${map.pick || id}: beatmap id ${id} was not returned by /beatmaps`);
      outputMaps.push({ ...map });
      continue;
    }

    const apiMap = buildBeatmapData(beatmap);
    const outputMap = mergeMapData(apiMap, map);
    outputMap.pick = map.pick || apiMap.pick || "";
    outputMap.beatmapId = String(beatmap.id);
    const mods = inferMods(outputMap);

    if (mods.length && hasOfficialCredentials) {
      try {
        const attributes = await getBeatmapAttributes(token, id, mods);
        const starRating = numberOrNull(attributes.star_rating);
        outputMap.modded = {
          ...(outputMap.modded || {}),
          mods,
          sr: starRating === null ? "" : round(starRating, 2),
          maxCombo: numberOrNull(attributes.max_combo)
        };
        outputMap.moddedSr = outputMap.modded.sr;
      } catch (error) {
        failed.push(`${outputMap.pick || id}: modded attributes failed (${mods.join("")}): ${error.message}`);
      }
    } else if (mods.length) {
      failed.push(`${outputMap.pick || id}: skipped modded attributes (${mods.join("")}); set OSU_CLIENT_ID/OSU_CLIENT_SECRET to sync official modded SR`);
    }

    outputMaps.push(outputMap);
    console.log(`${outputMap.pick || id}: ${outputMap.artist} - ${outputMap.title} [${outputMap.difficulty}]`);
    await wait(120);
  }

  const output = Array.isArray(source)
    ? outputMaps
    : {
      ...source,
      maps: outputMaps,
      updatedAt: new Date().toISOString()
    };

  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${outputMaps.length} map(s) to ${outputFile}.`);

  if (failed.length) {
    console.log("Failed lookups:");
    failed.forEach((item) => console.log(`- ${item}`));
  }
}

async function getPublicBeatmaps(ids) {
  const results = [];
  for (const id of [...new Set(ids)]) {
    try {
      results.push(await publicFetch(`${PUBLIC_API_BASE}/b/${encodeURIComponent(id)}`));
      await wait(180);
    } catch (error) {
      console.warn(`Public lookup failed for ${id}: ${error.message}`);
    }
  }
  return results;
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

async function getBeatmaps(token, ids) {
  const results = [];
  for (const chunk of chunkArray([...new Set(ids)], 50)) {
    const url = new URL(`${API_BASE}/beatmaps`);
    chunk.forEach((id) => url.searchParams.append("ids[]", id));
    const response = await apiFetch(token, url, { method: "GET" });
    results.push(...(Array.isArray(response.beatmaps) ? response.beatmaps : []));
    await wait(160);
  }
  return results;
}

async function getBeatmapAttributes(token, id, mods) {
  const url = new URL(`${API_BASE}/beatmaps/${encodeURIComponent(id)}/attributes`);
  const response = await apiFetch(token, url, {
    method: "POST",
    body: JSON.stringify({
      ruleset: MODE,
      mods
    })
  });

  return response.attributes || {};
}

async function publicFetch(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function apiFetch(token, url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {})
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return response.json();
}

function buildBeatmapData(beatmap) {
  const set = beatmap.beatmapset || {};
  const covers = set.covers || {};
  const owners = Array.isArray(beatmap.owners) && beatmap.owners.length
    ? beatmap.owners.map((owner) => owner.username).filter(Boolean)
    : [];

  return {
    beatmapId: String(beatmap.id || ""),
    beatmapSetId: String(beatmap.beatmapset_id || set.id || ""),
    url: beatmap.url || "",
    mode: beatmap.mode || "",
    status: beatmap.status || "",
    artist: set.artist || "",
    artistUnicode: set.artist_unicode || "",
    title: set.title || "",
    titleUnicode: set.title_unicode || "",
    difficulty: beatmap.version || "",
    mapper: owners.join(", ") || set.creator || "",
    sr: round(beatmap.difficulty_rating, 2),
    ar: round(beatmap.ar, 1),
    cs: round(beatmap.cs, 1),
    od: round(beatmap.accuracy, 1),
    hp: round(beatmap.drain, 1),
    bpm: round(beatmap.bpm, 2),
    drainLength: formatSeconds(beatmap.hit_length),
    drainLengthSeconds: numberOrNull(beatmap.hit_length),
    totalLength: formatSeconds(beatmap.total_length),
    totalLengthSeconds: numberOrNull(beatmap.total_length),
    maxCombo: numberOrNull(beatmap.max_combo),
    cover: {
      list: covers.list || "",
      card: covers.card || "",
      cover: covers.cover || "",
      slimcover: covers.slimcover || "",
      "list@2x": covers["list@2x"] || "",
      "card@2x": covers["card@2x"] || "",
      "cover@2x": covers["cover@2x"] || "",
      "slimcover@2x": covers["slimcover@2x"] || ""
    }
  };
}

function mergeMapData(apiMap, sourceMap) {
  const output = { ...apiMap };

  Object.entries(sourceMap).forEach(([key, value]) => {
    if (shouldUseSourceValue(value)) {
      output[key] = value;
    }
  });

  return output;
}

function shouldUseSourceValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getMapList(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source.maps)) return source.maps;
  if (Array.isArray(source.mappool)) return source.mappool;
  if (Array.isArray(source.beatmaps)) return source.beatmaps;
  return [];
}

function inferMods(map) {
  const explicit = normaliseMods(map.mods);
  if (explicit.length) return explicit;

  const pick = clean(map.pick).toUpperCase();
  if (pick.startsWith("HR")) return ["HR"];
  if (pick.startsWith("DT")) return ["DT"];
  return [];
}

function normaliseMods(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((mod) => normaliseMods(mod?.acronym || mod?.name || mod)))];
  }

  const text = clean(value).toUpperCase();
  const matches = text.match(/NC|DT|HR|HD|EZ|HT|FL|NF|SD|PF/g);
  return matches ? [...new Set(matches.map((mod) => mod === "NC" ? "DT" : mod))] : [];
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

const fs = require("fs");

const dataFile = process.argv[2] || "data/seeding.json";
const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const maps = getQualifierMaps(data);
const players = Array.isArray(data.players) ? data.players : [];
const mods = [...new Set(maps.map((map) => getMapMod(map)).filter(Boolean))];

for (const player of players) {
  player.qualifier = player.qualifier || {};
  player.qualifier.bracketSeeds = isObject(player.qualifier.bracketSeeds) ? player.qualifier.bracketSeeds : {};
}

for (const mod of mods) {
  const modMaps = maps.filter((map) => getMapMod(map) === mod);
  const rows = [];

  for (const player of players) {
    const scores = player.qualifier?.scores || {};
    const entries = modMaps.map((map) => scores[clean(map.pick).toUpperCase()]);
    const ranks = entries.map((entry) => rankNumber(entry?.rank));

    if (!entries.length || ranks.some((rank) => !Number.isFinite(rank))) {
      player.qualifier.bracketSeeds[mod] = "";
      continue;
    }

    rows.push({
      player,
      rankSum: ranks.reduce((sum, rank) => sum + rank, 0),
      scoreSum: entries.reduce((sum, entry) => sum + scoreNumber(entry?.score), 0),
      qualifierSeed: rankNumber(player.qualifier?.seed),
      username: clean(player.username)
    });
  }

  rows.sort((a, b) => (
    a.rankSum - b.rankSum ||
    b.scoreSum - a.scoreSum ||
    sortNumber(a.qualifierSeed) - sortNumber(b.qualifierSeed) ||
    a.username.localeCompare(b.username)
  ));

  rows.forEach((row, index) => {
    row.player.qualifier.bracketSeeds[mod] = index + 1;
  });

  const preview = rows
    .slice(0, 5)
    .map((row) => `${row.player.username}: #${row.player.qualifier.bracketSeeds[mod]} (${row.rankSum})`)
    .join(", ");
  console.log(`${mod}: ${preview}`);
}

fs.writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Updated bracket seeds in ${dataFile}.`);

function getQualifierMaps(value) {
  if (Array.isArray(value.maps)) return value.maps;
  if (Array.isArray(value.mappool)) return value.mappool;
  return value.mappools?.qualifiers?.maps || value.mappools?.qualifier?.maps || [];
}

function getMapMod(map) {
  return clean(map.mod || map.bracket || clean(map.pick).replace(/\d+$/g, "")).toUpperCase();
}

function rankNumber(value) {
  const text = clean(value).replace(/^#/g, "");
  if (!text) return Number.NaN;
  const number = Number(text);
  return Number.isFinite(number) ? number : Number.NaN;
}

function scoreNumber(value) {
  const number = Number(clean(value).replace(/[,\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function sortNumber(value) {
  return Number.isFinite(value) ? value : 9999;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

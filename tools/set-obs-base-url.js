const fs = require("fs");

const baseUrl = process.argv[2]?.replace(/\/+$/, "");

if (!baseUrl) {
  console.error("Usage: node tools/set-obs-base-url.js https://USERNAME.github.io/REPOSITORY");
  process.exit(1);
}

const sceneFiles = [
  "data/obs_scenes/VCT__SHOWCASE.json",
  "data/obs_scenes/VCT__MATCH.json",
  "data/obs_scenes/VCT__MATCH_MAPPOOL.json",
  "data/obs_scenes/VCT__MATCH_WINNER.json",
  "data/obs_scenes/VCT__MATCH_SCHEDULE.json"
].filter((file) => fs.existsSync(file));

const showcaseStages = {
  QUALIFIERS: "qualifiers",
  RO32: "ro32",
  RO16: "ro16",
  QUARTERFINALS: "quarterfinals",
  SEMIFINALS: "semifinals",
  FINALS: "finals",
  "GRAND FINALS": "grandfinals"
};

const overlaySources = {
  COUNTDOWN: { path: "/overlays/countdown/", width: 2240, height: 1080 },
  "ENDING VIDEO": { path: "/overlays/ending/", reroute_audio: true },
  "CUSTOM MAP ALERT VIDEO": {
    path: "/overlays/custom-map-alert/",
    reroute_audio: true,
    restart_when_active: true
  },
  "QUALIFIER RESULTS OVERLAY": { path: "/overlays/qualifier-results/?fresh=1", width: 2240, height: 1080 },
  "MATCH BACKGROUND": { path: "/overlays/match/?layer=background&fresh=1" },
  "MATCH HUD": { path: "/overlays/match/?layer=hud&fresh=1" },
  "MATCH MAPPOOL OVERLAY": { path: "/overlays/match-mappool/?mode=match&fresh=1", width: 2240 },
  "MATCH MAPPOOL BACKGROUND": { path: "/overlays/match-mappool/?layer=background&fresh=1" },
  "MATCH MAPPOOL HUD": { path: "/overlays/match-mappool/?layer=hud&fresh=1" },
  "MATCH WINNER OVERLAY": { path: "/overlays/match-winner/?fresh=1" },
  "MATCH SCHEDULE BACKGROUND": { path: "/overlays/match-schedule/?layer=background&fresh=1" },
  "MATCH SCHEDULE HUD": { path: "/overlays/match-schedule/?layer=hud&fresh=1" }
};

for (const sceneFile of sceneFiles) {
  const scene = JSON.parse(fs.readFileSync(sceneFile, "utf8"));

  for (const source of scene.sources) {
    const overlay = getOverlaySource(source.name);
    if (!overlay) continue;

    source.id = "browser_source";
    source.versioned_id = "browser_source";
    source.settings = {
      url: `${baseUrl}${overlay.path}`,
      width: overlay.width || 1920,
      height: overlay.height || 1080,
      reroute_audio: Boolean(overlay.reroute_audio),
      restart_when_active: Boolean(overlay.restart_when_active),
      shutdown: false
    };
  }

  fs.writeFileSync(sceneFile, JSON.stringify(scene, null, 4));
  console.log(`Updated ${sceneFile} to use ${baseUrl}`);
}

function getOverlaySource(name) {
  const showcaseMatch = name.match(/^(?:VCT )?SHOWCASE - (.+) OVERLAY$/);
  if (showcaseMatch) {
    const stage = showcaseStages[showcaseMatch[1]];
    return stage ? { path: `/overlays/mappool/?stage=${stage}&fresh=1`, width: 2240, height: 1080 } : null;
  }

  return overlaySources[name] || null;
}

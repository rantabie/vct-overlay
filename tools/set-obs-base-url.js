const fs = require("fs");

const baseUrl = process.argv[2]?.replace(/\/+$/, "");

if (!baseUrl) {
  console.error("Usage: node tools/set-obs-base-url.js https://USERNAME.github.io/REPOSITORY");
  process.exit(1);
}

const sceneFile = "data/obs_scenes/VCT__SHOWCASE.json";
const scene = JSON.parse(fs.readFileSync(sceneFile, "utf8"));

const showcaseStages = {
  QUALIFIERS: "qualifiers",
  RO32: "ro32",
  RO16: "ro16",
  QUARTERFINALS: "quarterfinals",
  SEMIFINALS: "semifinals",
  FINALS: "finals",
  "GRAND FINALS": "grandfinals"
};

for (const source of scene.sources) {
  const showcaseMatch = source.name.match(/^(?:VCT )?SHOWCASE - (.+) OVERLAY$/);
  const stage = showcaseMatch ? showcaseStages[showcaseMatch[1]] : null;
  const url = stage
    ? `${baseUrl}/overlays/mappool-showcase/?stage=${stage}&fresh=1`
    : source.name === "COUNTDOWN"
      ? `${baseUrl}/overlays/countdown/`
      : source.name === "ENDING VIDEO"
        ? `${baseUrl}/overlays/ending/`
      : null;

  if (!url) continue;

  source.id = "browser_source";
  source.versioned_id = "browser_source";
  source.settings = source.name === "COUNTDOWN"
    ? {
        url,
        width: 2240,
        height: 1080,
        reroute_audio: false,
        restart_when_active: false,
        shutdown: false
      }
    : source.name === "ENDING VIDEO"
      ? {
          url,
          width: 1920,
          height: 1080,
          reroute_audio: true,
          restart_when_active: false,
          shutdown: false
        }
    : {
        ...(source.settings || {}),
        url,
        width: 2240,
        height: 1080,
        restart_when_active: false,
        shutdown: false
      };
}

fs.writeFileSync(sceneFile, JSON.stringify(scene, null, 4));
console.log(`Updated ${sceneFile} to use ${baseUrl}`);

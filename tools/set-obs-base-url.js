const fs = require("fs");

const baseUrl = process.argv[2]?.replace(/\/+$/, "");

if (!baseUrl) {
  console.error("Usage: node tools/set-obs-base-url.js https://USERNAME.github.io/REPOSITORY");
  process.exit(1);
}

const sceneFile = "data/obs_scenes/VCT__SHOWCASE.json";
const scene = JSON.parse(fs.readFileSync(sceneFile, "utf8"));

const overlayUrls = {
  "VCT SHOWCASE - QUALIFIERS OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=qualifiers&fresh=1`,
  "VCT SHOWCASE - RO32 OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=ro32&fresh=1`,
  "VCT SHOWCASE - RO16 OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=ro16&fresh=1`,
  "VCT SHOWCASE - QUARTERFINALS OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=quarterfinals&fresh=1`,
  "VCT SHOWCASE - SEMIFINALS OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=semifinals&fresh=1`,
  "VCT SHOWCASE - FINALS OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=finals&fresh=1`,
  "VCT SHOWCASE - GRAND FINALS OVERLAY": `${baseUrl}/overlays/mappool-showcase/?stage=grandfinals&fresh=1`
};

for (const source of scene.sources) {
  const url = overlayUrls[source.name];
  if (source.name === "COUNTDOWN") {
    source.id = "ffmpeg_source";
    source.versioned_id = "ffmpeg_source";
    source.settings = {
      close_when_inactive: false,
      clear_on_media_end: false,
      input: `${baseUrl}/assets/vct/overlay/countdown.web.mp4`,
      is_local_file: false,
      looping: false,
      restart_on_activate: true,
      speed_percent: 100
    };
    continue;
  }

  if (!url) continue;

  source.id = "browser_source";
  source.versioned_id = "browser_source";
  source.settings = {
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

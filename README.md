# VCT Stream Overlay

Static tosu overlays for Vietnamese osu!catch Tournament.

## Current Overlay

- `overlays/mappool-showcase/` is the finished mappool showcase page.
- `assets/vct/showcase.original.png` is the source artwork.
- `assets/vct/showcase.frame.png` is the OBS-ready frame with the gameplay window made transparent.
- `assets/fonts/BerkshireSwash-Regular.ttf` is the local display font used for VCT-styled labels.
- `data/mappool-showcase.json` controls the mappool queue.

## Design Tokens

The current palette is:

- `#59483C`
- `#6E5948`
- `#A69585`
- `#F9E4D3`

## Preview

From this folder:

```powershell
npx serve . -l 5173
```

Then open:

```text
http://127.0.0.1:5173/overlays/mappool-showcase/?debug=1
```

Remove `?debug=1` for the transparent OBS version.

## OBS Scene Collection

An OBS import JSON is included at:

```text
data/obs_scenes/VCT__SHOWCASE.json
```

It creates a countdown scene and one showcase scene per round:

- `VCT COUNTDOWN`
- `VCT SHOWCASE - QUALIFIERS`
- `VCT SHOWCASE - RO32`
- `VCT SHOWCASE - RO16`
- `VCT SHOWCASE - QUARTERFINALS`
- `VCT SHOWCASE - SEMIFINALS`
- `VCT SHOWCASE - FINALS`
- `VCT SHOWCASE - GRAND FINALS`

`VCT COUNTDOWN` uses a browser source named `COUNTDOWN`, pointed at:

```text
http://127.0.0.1:24050/overlays/countdown/
```

The countdown page uses `assets/vct/overlay/countdown.web.mp4` inside the browser and keeps time from an absolute deadline, so it catches up after scene switches or browser throttling.

Each showcase scene has `VCT SHOWCASE CLIENT` underneath and a browser overlay source on top.

The right curtain is rendered inside the mappool showcase browser overlay, not as a separate OBS image source.

Each showcase scene also includes `COMMENTATOR OVERLAY`, copied from the ASC showcase reference. It uses the Discord StreamKit browser source and is positioned toward the upper-left header area.

## GitHub Pages

The project is ready to be hosted from GitHub Pages. The countdown video used by the browser overlay is `assets/vct/overlay/countdown.web.mp4`, which is small enough for a normal GitHub push. The original `countdown.mp4` is ignored because it is over GitHub's 100 MB file limit.

After GitHub Pages is enabled, rewrite the OBS browser source URLs to the final hosted URL:

```powershell
node tools/set-obs-base-url.js https://USERNAME.github.io/REPOSITORY
```

For example, if the repo is `vct-overlay` under `myname`:

```powershell
node tools/set-obs-base-url.js https://myname.github.io/vct-overlay
```

Then in tosu settings, add the GitHub Pages domain to Allowed IPs / allowed origins:

```text
USERNAME.github.io
```

## Tosu

The overlay connects to `ws://127.0.0.1:24050/ws` by default. If previewing from another local server, add a query parameter:

```text
http://127.0.0.1:5173/overlays/mappool-showcase/?tosu=127.0.0.1:24050
```

When the current beatmap matches a `beatmapId` entry in `data/mappool-showcase.json`, the pick code is highlighted in the bottom queue. Custom or unreleased maps can use the `.osu` filename as the `beatmapId`.

## Showcase Rounds

Use the `stage` query parameter for round-specific showcase frames:

```text
?stage=qualifiers
?stage=ro32
?stage=ro16
?stage=quarterfinals
?stage=semifinals
?stage=finals
?stage=grandfinals
```

For testing without changing maps in osu!, use `pick`:

```text
http://127.0.0.1:5173/overlays/mappool-showcase/?stage=ro32&pick=HD4&fresh=1
```

`fresh=1` ignores any JSON previously loaded through the browser control panel and reads `data/mappool-showcase.json` directly.

## Mappool Data

```json
[
  {
    "pick": "RC1",
    "beatmapId": "1234567",
    "isCustom": false,
    "mappers": ""
  },
  {
    "pick": "SV1",
    "beatmapId": "Artist - Title (Mapper) [Difficulty].osu",
    "isCustom": true,
    "mappers": "Mapper"
  }
]
```

You can freely add, remove, or rename slots. The bottom queue renders directly from this array in order.

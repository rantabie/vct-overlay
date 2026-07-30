# VCT Match Overlay Streamer Guide

This guide is for the VCT 1v1 match overlay.

## Scenes Used

- Countdown Scene
- Match Scene
- Winner Scene
- Match Schedule Scene, optional after a match

The Match Scene contains both mappool and gameplay. Do not switch to a separate mappool scene during a match unless you are only testing.

## Tosu Setup

Before streaming, open:

```text
http://127.0.0.1:24050/settings
```

Under `Allowed IPs`, add the site hosting the overlay. For the current VCT export, use:

```text
rantabie.github.io
```

If you are testing locally, also allow:

```text
127.0.0.1
localhost
```

If this is not set, the browser overlay cannot read tosu data.

## tournament.cfg Setup

Add this line to `tournament.cfg`:

```text
ClientNameSize = 0
```

## Before Going Live

1. Open the tournament client and join the correct multiplayer lobby.
2. Make sure the lobby has valid 1v1 player names.
3. Set the Best Of correctly in the tournament client.
4. In OBS, open `Interact` on `MATCH MAPPOOL OVERLAY`.
5. The overlay reads `data/mappool.json` for the repo mappool. Click `Load Mappool JSON` only when staff gives you a one-off replacement file.
6. Click `Current Stage` until it matches the round being streamed.
7. Check who won roll and set the `Player Ban/Pick` button to the correct first action.

## Ban Rules

Up to Semifinals:

- Each player has 1 ban.
- If Player A chooses ban first / pick second: Player A bans, Player B bans, Player B picks.
- If Player A chooses pick first / ban second: Player B bans, Player A bans, Player A picks.

Finals and Grand Finals:

- Each player has 2 bans.
- Use ABBA ban order.
- If Player A chooses ban first / pick second: Player A bans, Player B bans twice, Player A bans, Player B picks.
- If Player A chooses pick first / ban second: Player B bans, Player A bans twice, Player B bans, Player A picks.

## Interact Buttons

`Current Stage`

Cycles the stage shown on the match overlay. It also controls whether the overlay expects 1 ban each or 2 bans each.

`Player Ban/Pick`

Shows the next action that will happen when a map is clicked. Click this button to manually switch the acting player.

`Hide/Show Pick/Ban Sign`

Toggles the small Ban/Pick indicator near the player header.

`Switch to Gameplay/Mappool`

Manually switches the Match Scene overlay between mappool and gameplay view.

`Undo Action`

Reverts the latest map action and restores the previous acting player.

`Auto Pick`

On by default. After the ban phase, if the referee changes the client to a beatmap in the pool, the overlay marks that map as picked for the current player.

`Auto Scene`

On by default. It switches to gameplay when the client enters gameplay, switches to gameplay 20 seconds after a pick if needed, and returns to mappool 30 seconds after the result screen.

## Map Controls

Inside OBS Interact on `MATCH MAPPOOL OVERLAY`:

- Left click a map: perform the current upcoming action.
- Right click a map: perform the current upcoming action for Player Right.
- Shift + click: force a ban.
- Ctrl + click: clear that map's pick/ban/win mark.
- Alt + left click: mark Player Left win.
- Alt + right click: mark Player Right win.
- Left click a point image: set that player to that many points.
- Right click a point image: set that player to one less than that point.
- Ctrl + click a point image: return the match score to tosu.

## During Stream Flow

1. Stay on Countdown Scene until the timer reaches 0:00.
2. Switch to Match Scene.
3. Open OBS Interact on `MATCH MAPPOOL OVERLAY`.
4. Set the first banning player based on roll choice.
5. Click maps as bans happen.
6. After bans, keep `Auto Pick` on so referee map changes mark picks automatically.
7. Let `Auto Scene` switch to gameplay, or click `Switch to Gameplay` manually.
8. After result screen, let Auto Scene return to mappool, or click `Switch to Mappool` manually.
9. Repeat until one player reaches the points needed to win.
10. Switch to Winner Scene.
11. Optional: switch to Match Schedule Scene to show recent, upcoming, and coming-up-next matches.

## Emergency Fixes

- Wrong player is about to act: click `Player Ban/Pick`.
- Wrong map was clicked: click `Undo Action`.
- A map should be cleared entirely: Ctrl + click that map.
- Auto picked the wrong side: click `Undo Action`, then click `Player Ban/Pick`, then click the correct map.
- Score/win did not mark: Alt + left/right click the map to mark the winner.
- Points are wrong: click the point images to set the visible score. Ctrl + click a point image after tosu is correct again.
- Overlay did not switch scene: click `Switch to Gameplay/Mappool`.
- Tosu is not connected: check Allowed IPs and refresh the browser source.

# Lawnmower Game — Claude Context

## Project
Pixel art top-down lawnmower game. Phaser 4.2.1, vanilla JS, no build step. Deployed to GitHub Pages via GitHub Actions on every push to main.

## Key Files
- `game.js` — all game logic (single file)
- `index.html` — canvas host + DOM UI overlay + loading screen
- `levels/level-0N.json` — level maps (T=tree, G=garden, B=bush/hedge, .=grass)
- `vendor/phaser.min.js` — Phaser 4.2.1, vendored locally (not CDN) to avoid a third-party DNS/TLS roundtrip on load. To bump the Phaser version, manually re-download and overwrite this file.

## Loading Screen
`index.html` shows a pure CSS/HTML spinner (`#loading-screen`) on first paint, with no JS dependency — it's already in the markup before any script runs. `GameScene.create()` in `game.js` hides it (`.hidden` class) as its last step, once the scene is actually playable. If you add new async setup to `create()`, keep the hide call last.

## Grid Constants
```
CELL = 16px
YARD_X = 3, YARD_Y = 3 (border offset)
YARD_COLS = 18 (fixed — matches every level's authored width)
BASE_YARD_ROWS = 12 (authored level height)
```
`YARD_ROWS` (and so `ROWS`/`H`) is **computed at load** by `computeYardRows()` — on portrait + touch devices it grows past 12 to fill available vertical space (screen height minus `CONTROL_RESERVE_PX`, ~1 inch, reserved for the D-pad), clamped to `MAX_YARD_ROWS`. Desktop and mobile landscape always get the fixed 12 rows. This is a one-time computation at page load; it does not live-recompute on resize or orientation change. `normalizeMap()` pads each authored level's map out to `YARD_ROWS` with plain grass, centering the original trees/gardens vertically — level files themselves stay a fixed 18×12 and never need to change. Only rows grow (never columns), so the mower stays a fixed single-cell size — there's no swath-widening or world-scaling here, by design (see git history around 2026-07-18 for why that combination was reverted).

## Render Layer Depths (bottom → top)
| Depth | Object |
|-------|--------|
| 0 | Background RT |
| 1 | Mowed grass RT |
| 2 | Player gfx |
| 3 | Obstacle RT (trees + gardens) |
| 4 | Squirrel, bird, deer, fox, dog gfx |
| 10 | Joystick gfx, HUD |

Player is at depth 2 so he walks visually under the tree canopy (depth 3).

## Phaser 4 Gotchas
- **RenderTexture**: must call `.render()` after all `.stamp()` calls or nothing appears
- **Full-screen RT**: always `rt.setOrigin(0, 0)` — default origin is center which offsets everything
- **Off-screen graphics**: use `this.make.graphics({ add: false })` then `.generateTexture()` then `.destroy()`
- **`pixelArt: true`** in game config — critical for crisp sprites, also sets `roundPixels`
- **Scale / DOM overlay**: use `this.scale.canvasBounds` (not `canvas.getBoundingClientRect()`) to position the DOM overlay; hook `this.scale.on('resize', ...)` to reposition on window resize
- **Depth**: all GameObjects default to depth 0 and render in creation order; use `setDepth()` to reorder
- **Multi-touch**: set `input: { activePointers: 3 }` in game config
- **Scene restart persistence**: module-level `let g_foo` survives `scene.restart()`; `this.foo` does not

## DOM Overlay Pattern
UI text lives in `#ui-canvas` (a `position:absolute` div over the canvas) to avoid the `image-rendering: pixelated` CSS blurring canvas text. `syncUIOverlay()` reads `canvasBounds` and applies a CSS `scale()` transform to match the Phaser FIT scale.

## Decorative Border
The unmowable border margin (outside `YARD_X`/`YARD_Y`) is dark wild grass (`0x1e3a12`) with denser/taller accent blades than the yard's own, small scattered wildflowers (same sampling loop as the blades, ~10% chance per sample point, random pick from a small color palette), plus a bigger, more muted `bg_tree` texture scattered around all 4 sides — purely cosmetic, baked into the depth-0 background RT in `buildBackground()`, no collision (the border was already unreachable). `bg_tree` (and `bg_pine`) are generated inline in `buildBackground()` itself rather than in `buildLevelTextures()`, since the latter runs later (from `buildObstacleLayer()`). `bg_pine` (conical, same muted palette) is staggered in alongside `bg_tree` specifically on the left/right sides only — offset half a step vertically and tucked closer to the outer edge — for a layered forest-edge look rather than a single flat row of one shape. All side-tree placements (`bg_tree` and `bg_pine`) are collected into one array and y-sorted before stamping (painter's algorithm) rather than stamped in a fixed type order — with a fixed order, whichever type stamps last always draws on top of the other wherever they touch (e.g. a pine's trunk poking out over a round tree's canopy), regardless of how tight the jitter/spacing is tuned to reduce overlap in the first place.

## Obstacle System
- `obstacleGrid[r][c]` — gardens and bushes/hedges (full block); trees don't set this
- `trunkPositions[]` — tree trunk pixel-radius collision (6px); player can enter and mow the cell but can't pass through
- `obstacleClusters[]` — gardens **and** bushes/hedges; auto-mow cells when all perimeter cells are mowed (`this.totalCells` is a plain `YARD_ROWS * YARD_COLS` — no bush-cell subtraction needed, since bushes now reach mowedCount the same way gardens do)
- `isNearGarden()` — despite the name, this is the general obstacle-edge collision check (applies to any `obstacleGrid`-blocked cell — gardens and bushes alike): it samples a small cross of points around the player (±6px, matching the mower's visual half-width) rather than just the exact center, so the mower's sprite stops right at the edge instead of visually overlapping into it before the single tracked point crosses the cell boundary
- `TREE_TYPES` (`tree_round`, `tree_evergreen`) — one is picked at random per contiguous tree cluster in `buildObstacleLayer()` (not per 2×2 sub-block), so a single clump of trees reads as one coherent species. Both keep the trunk in the same local y=18..31 footprint so the shared `ty + 8` trunk-collision offset works for either without a per-type adjustment. (A third variant, `tree_willow`, was tried and dropped — didn't read well; see git history around 2026-07-18 if revisiting.)
- Bushes/hedges (`B` in level maps) stamp the single `bush` texture **per cell** (16×16, not the 32×32 2-cell blocks trees/gardens use), since a hedge is typically a single-cell-wide row of arbitrary length rather than a 2×2-aligned cluster. They share the exact same cluster/perimeter/auto-mow code path as gardens in `buildObstacleLayer()` (`type === 'G' || type === 'B'`) — the grass underneath turns mowed once the player's fully mowed around them, just hidden under the bush texture (obstacle layer depth 3, above mowed layer depth 1) same as gardens

## Mowed Grass Rendering
Mowed grass is **blocky and grid-aligned, one full cell at a time**. `mowAt(px, py)` figures out which grid cell the player is in and, if it's not already mowed to this depth, stamps the single `mowed_H_full` (16×16, per deck height) texture at that cell's exact center via `this.mowedRT.stamp()`. There's only one texture shape — always full-cell, never a narrower mower-width variant — which is what makes this gap-free on any path (straight, diagonal, turn, parallel lanes) and impossible to bleed past the yard border: every stamp lands at exact grid coordinates already bounds-checked against `YARD_COLS`/`YARD_ROWS`.

This is a deliberate return to a simpler design after two failed attempts at matching the mower's exact sub-cell pixel width: (1) direction-dependent narrower textures (`_v`/`_h`) gapped on turns and parallel lanes since they didn't account for the player's actual sub-cell offset, and (2) a continuous stroke tracing the player's exact path frame-by-frame fixed those gaps but read as "too fluid"/not grid-aligned, and its stroke width could still creep a few px past the yard edge into the border independent of collision. Full-cell stamping sidesteps both: it's inherently blocky (matches the grid the whole game is built on) and inherently bounded (a full cell literally cannot render outside the yard).

`buildMowedTextures()` generates just this one `mowed_H_full` texture per deck height — used by both the player's own mowing and by `checkClusterCompletion()`'s garden auto-mow (which stamps whole cells instantly and is hidden under the garden's own obstacle-layer texture anyway, depth 3 above the mowed layer's depth 1).

### Alternating Stripe Levels
`buildMowedTextures()` also generates a `mowed_H_full_alt` variant per deck height — the same texture with `shadeColor()` darkening its base/stripe colors by 15%. `mowedTextureKey(h, gc)` picks between the two by grid-column parity, but only for levels with `stripedMow: true` in their level JSON (currently just `level-02.json`) — `mowAt()` and `checkClusterCompletion()` both call it instead of hardcoding `mowed_${h}_full`, so gardens/bushes auto-mow with the same column-based alternation. This mimics the light/dark banding real mowers leave from cutting adjacent passes in opposite directions — vertical bands since the alternation is per-column, not per-row.

## No Toggle-able Settings
Deck height, speed, blade, and distractions (squirrel) all used to be player-adjustable via a lever/toggle panel docked to the right border. That panel was removed — there is no in-game way to change these anymore. They're fixed at their old defaults: `this.deckHeight = 2` (set once in `create()`), `SPEED_STEP = 2` (medium), blade always on, distractions always on. If a "make it configurable again" request comes in, the lever UI code is recoverable from git history (commit `1b1fe23` and earlier had the full lever/toggle implementation).

## No Sprinklers (removed)
Sprinklers (a periodic pop-up spray animation that reverted a small mowed patch back to grass) were removed — buggy and the feel wasn't landing. The full implementation (`scheduleSprinkler`/`popSprinkler`/`findSprinklerPos`/`animateSprinkler`/`eraseMowedBlock`, plus the `activeSprinkler` collision/mow-blocking checks in `isObstacle()`/`mowAt()`) is recoverable from git history if revisiting (see commits around 2026-07-19). Squirrels are unaffected and still active.

## Mobile Layout
`#game-container` hosts the Phaser canvas (`scale.parent` in the game config); `#controls-spacer` (a sibling, sized via CSS flex) reserves room below it for the D-pad, real height only in portrait+touch (see media queries in `index.html`). `applyResponsiveLayout()` in `game.js` sets `#game-container`'s `aspect-ratio` from the computed `W`/`H` so Phaser's FIT scaling fills it with no dead space. The D-pad itself gets a slightly smaller, portrait-specific size/layout (`174px`, nested inside `#controls-spacer`) vs. its default fixed-position landscape sizing (`216px`, floating over the canvas's side dead zone) — portrait is capped tighter to comfortably fit `CONTROL_RESERVE_PX`'s ~190px reserved zone.

## HUD
No progress bar — just the level indicator (`#hud-level`, still in the canvas-scaled `#ui-canvas` overlay, with a `text-shadow` for contrast now that there's no background bar behind it) and a plain percentage readout (`#hud-pct-bottom`) docked near the D-pad, outside the canvas entirely, as a sibling of `#dpad` inside `#controls-spacer`. Default (desktop/landscape): `position: fixed` in the opposite corner from the D-pad, the same technique `#dpad` uses to float free of `#controls-spacer`'s zero-height box in that mode. Portrait: `position: absolute` pinned to the right edge of `#controls-spacer` (still `position: relative` in that mode) rather than sitting in the flex row next to the D-pad — keeps a clear gap between them instead of a small margin, and lets the D-pad center on its own.

## Intro Overlay
`#intro-overlay`/`#intro-box` mirror the win-overlay pattern (same dark rounded box style) but with an explicit `#intro-start-btn` button instead of tap-anywhere, and is visible by default in the HTML markup (not toggled by JS) so it's already up the instant the loading screen hides. Shown once — `buildIntroOverlay()` early-returns if the module-level `g_introShown` flag (persists across `scene.restart()`) is already true, and the Start button / Enter / Space handler sets it. `this.started` (gated in `update()`'s early-return alongside `this.won`) blocks all movement/mowing until Start is tapped; `create()` seeds it from `g_introShown` so every level after the first starts immediately with no modal. `scheduleSquirrel()`/`scheduleBird()`/`scheduleDeer()` are deferred to the Start handler on the very first level (rather than called unconditionally in `create()`) so their timers don't start counting down while the modal is still up.

## Birds, Deer, and Fox
Purely cosmetic, no collision, no per-level cap (unlike squirrels) — same `schedule*`/`launch*`/`update*`/`draw*` structure as the squirrel, but all are confined to the border margin and never enter the yard. Birds (`scheduleBird`/`launchBird`/`updateBird`/`drawBird`) pick one of the 4 border strips and fly straight across it (a 2-line wing-flap silhouette, light-colored — a dark one barely shows up against the similarly-dark wild grass border — alternating every ~120ms, plus a small sine-wave flutter perpendicular to travel that's purely visual and doesn't affect the tracked x/y) every 15-30s, despawning once it's well past the far edge. Deer and fox (`scheduleDeer`/`scheduleFox` etc.) peek out from the left or right border independently of each other (either, both, or neither can be active at once) on their own random interval: a 3-phase `peek`/`hold`/`retreat` state machine (`this.deer.t`/`this.fox.t` goes 0→1→0) slides a small body partway in from off-canvas, holds, then retreats — the peek depth is capped well short of the yard boundary. Deer use the same muted palette as `bg_tree`/`bg_pine`; the fox is rust-orange with a pale chest/tail-tip so the two read distinctly from each other at a glance.

## Dog
Unlike bird/deer/fox, the dog is **in the yard itself** (not the border) and present for the whole level rather than scheduled — it's initialized once in `create()` via `pickDogSpot(this.player.x, this.player.y, 80)`, which scans `this.levelData.map` for plain-grass (`'.'`) cells at least the given pixel distance from a point and returns a random match's cell-center (or `null`, falling back to the yard's bottom-right corner). It has real collision, mirroring the squirrel's exact-cell block in both `isObstacle()` and `mowAt()` (blocks only the dog's current grid cell, always, no `.active` flag needed since the dog always exists).

`updateDog(dt)`, called every frame from `update()` (no `schedule*`/timer — it reacts to proximity, not an interval), is a 2-state machine:
- **idle**: once any post-flee cooldown (`cooldownRemaining`, 1500ms) has elapsed, checks `Math.hypot()` distance to the player against `TRIGGER_DIST` (48px, ~3 cells); if within range, calls `pickDogSpot(this.player.x, this.player.y, 100)` — deliberately keyed off the *player's* position rather than the dog's own old spot, so the destination is guaranteed far enough from the player to not immediately re-trigger — and switches to `fleeing`, plus fires `playDogBark()`.
- **fleeing**: linearly interpolates (`Phaser.Math.Linear`) from the old spot to the new one, plus a small perpendicular sine wobble (fading out near the end) so it scurries rather than slides in a dead-straight line. Duration is **speed-based** (`fleeDist / FLEE_SPEED`, 55px/s, clamped 400–1400ms) rather than a fixed time, so near and far scampers both move at the same hurried-but-not-blurring pace — noticeably under the player's own 80px/s medium speed, which is what reads as a "scamper" instead of a dash. (An earlier fixed-400ms version covered any distance in the same time, so longer flees blurred past at 250px/s+ — the reported "moving fast" issue.)

`drawDog()` switches pose by state rather than using one silhouette throughout:
- **idle**: a sitting silhouette — low, wide haunches (`fillEllipse`) with the chest/head held upright above them and the tail curled in at the side, distinctly "at rest" rather than the running pose standing still.
- **fleeing**: the original low, stretched pose with dx/dy-driven head placement (same technique as the squirrel) and a 1px vertical bob, for a scampering read while actually moving.

Palette is warm brown (`FUR`/`FUR_DARK`) with a tan muzzle patch, not flat near-black — the original near-black fur plus straight-up-pointing ears read as a rabbit rather than a dog. Fixed with two changes together: floppy triangular ears (`fillTriangle`) drooping outward from the sides of the head instead of straight rects on top, and a lighter muzzle/snout patch on the head to break up the round-head silhouette.

`playDogBark()` (module-level, alongside the other audio functions below) is a two-note "arf-arf" — `square` oscillators (woofier than a raw sawtooth) each swept 400Hz→150Hz, run through a `BiquadFilterNode` lowpass that sweeps down alongside the pitch (2000Hz→500Hz) to round off the harsh top end, with a fast attack and quick exponential decay. (An earlier single-note raw-sawtooth version read as more of a buzz than a bark.)

## Audio
Procedurally synthesized via the raw Web Audio API (`AudioContext`/`OscillatorNode`/`GainNode`/`BiquadFilterNode`) rather than Phaser's sound manager (which is asset-based) or vendored audio files — no assets to source or host. Module-level (`g_audioCtx`, `g_humGain`), created once per page load by `setupAudio()`, not per `scene.restart()`. `setupAudio()` is called from the intro modal's Start button click specifically because that's a genuine user gesture, satisfying the browser's autoplay policy — calling it any earlier would leave the context stuck `suspended`.

Four sounds, all simple and gentle to match the game's low-key "mindless peacefulness" tone rather than reading as game-y sound effects (loud enough to actually register, though — an initial pass at gain 0.05 was nearly inaudible on typical speakers):
- **Mower hum**: a single continuous low-pass-filtered triangle oscillator, `start()`ed once and never stopped — oscillators can't be restarted, so movement on/off is expressed by ramping `g_humGain`'s gain (via `setHumActive()`, called every frame from `update()` with whether the player moved that frame) rather than starting/stopping the node, which also avoids audible clicks at the transition.
- **Win chime**: a short 4-note major arpeggio (`playWinChime()`, called from `showWin()`) — one short-lived oscillator+gain pair per note with a quick attack and exponential decay.
- **Bird chirp**: a quick two-note "tweet-tweet" (`playBirdChirp()`, called once from `launchBird()`), each note a fast upward pitch sweep in the 2-3kHz range — the classic chirp shape — with a very short envelope so it reads as a brief accent alongside the bird's flight, not an alert.
- **Dog bark**: a short sawtooth sweep from 340Hz down to 160Hz (`playDogBark()`, called once from `updateDog()` when the dog startles — see the Dog section above) with a fast attack and quick decay, punchy but momentary.

`setHumActive(false)` is called explicitly when the win condition triggers (in `updateHUD()`), since `update()` stops running entirely once `this.won` is true and would otherwise leave the hum wherever it last was.

## Deploying
Commit and push to `main` — GitHub Actions workflow in `.github/workflows/deploy.yml` handles the rest. Live at https://erictempleton1.github.io/lawnmower-game/

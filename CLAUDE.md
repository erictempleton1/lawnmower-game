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
| 4 | Squirrel gfx |
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
The unmowable border margin (outside `YARD_X`/`YARD_Y`) is dark wild grass (`0x1e3a12`) with denser/taller accent blades than the yard's own, small scattered wildflowers (same sampling loop as the blades, ~10% chance per sample point, random pick from a small color palette), plus a bigger, more muted `bg_tree` texture scattered around all 4 sides — purely cosmetic, baked into the depth-0 background RT in `buildBackground()`, no collision (the border was already unreachable). `bg_tree` (and `bg_pine`) are generated inline in `buildBackground()` itself rather than in `buildLevelTextures()`, since the latter runs later (from `buildObstacleLayer()`). `bg_pine` (conical, same muted palette) is staggered in alongside `bg_tree` specifically on the left/right sides only — offset half a step vertically and tucked closer to the outer edge — for a layered forest-edge look rather than a single flat row of one shape.

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

## Birds and Deer
Purely cosmetic, no collision, no per-level cap (unlike squirrels) — same `schedule*`/`launch*`/`update*`/`draw*` structure as the squirrel, but both are confined to the border margin and never enter the yard. Birds (`scheduleBird`/`launchBird`/`updateBird`/`drawBird`) pick one of the 4 border strips and fly straight across it (a 2-line wing-flap silhouette, light-colored — a dark one barely shows up against the similarly-dark wild grass border — alternating every ~120ms, plus a small sine-wave flutter perpendicular to travel that's purely visual and doesn't affect the tracked x/y) every 15-30s, despawning once it's well past the far edge. Deer (`scheduleDeer`/`launchDeer`/`updateDeer`/`drawDeer`) peek out from the left or right border every 20-40s: a 3-phase `peek`/`hold`/`retreat` state machine (`this.deer.t` goes 0→1→0) slides a small muted-palette body (same tones as `bg_tree`/`bg_pine`) partway in from off-canvas, holds, then retreats — the peek depth is capped well short of the yard boundary.

## Deploying
Commit and push to `main` — GitHub Actions workflow in `.github/workflows/deploy.yml` handles the rest. Live at https://erictempleton1.github.io/lawnmower-game/

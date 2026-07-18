# Lawnmower Game — Claude Context

## Project
Pixel art top-down lawnmower game. Phaser 4.2.1, vanilla JS, no build step. Deployed to GitHub Pages via GitHub Actions on every push to main.

## Key Files
- `game.js` — all game logic (single file)
- `index.html` — canvas host + DOM UI overlay + loading screen
- `levels/level-0N.json` — level maps (T=tree, G=garden, .=grass)
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
| 4 | Sprinkler gfx, Squirrel gfx |
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

## Obstacle System
- `obstacleGrid[r][c]` — gardens only (full block, auto-mow via `checkClusterCompletion`)
- `trunkPositions[]` — tree trunk pixel-radius collision (6px); player can enter and mow the cell but can't pass through
- `obstacleClusters[]` — gardens only; auto-mow cells when all perimeter cells are mowed
- `isNearGarden()` — garden collision samples a small cross of points around the player (±6px, matching the mower's visual half-width) rather than just the exact center, so the mower's sprite stops right at a garden's edge instead of visually overlapping into it before the single tracked point crosses the cell boundary

## Mowed Grass Rendering
Mowed grass is a **continuous stroke**, not per-cell stamps. `mowAt(px, py)` draws a line from `this.lastMowPos` (the previous frame's exact position) to the current exact position, at `MOWED_WIDTH` (12px, matching the mower's visual wheel-to-wheel span), plus a `fillCircle` cap at the new point — all via a reusable `this.mowStrokeGfx` Graphics object drawn into `this.mowedRT` (`RenderTexture.draw()`). `lastMowPos` updates every call, whether or not that call actually painted (already-mowed cells are skipped for grid bookkeeping but still advance the tracked position), so the next real stroke always starts from an unbroken point.

This replaced an earlier per-cell-texture-stamping system that centered a fixed-size texture in each grid cell regardless of the player's actual sub-cell offset — gap-free for straight passes only by accident (direction-specific texture variants), but it fundamentally gapped on turns, adjacent parallel lanes, and yard edges, since none of those track the player's real continuous path. Tracing the literal path structurally can't gap in any pattern.

`buildMowedTextures()` now only generates `mowed_H_full` (16×16, per deck height) — used solely by `checkClusterCompletion()`'s garden auto-mow, which stamps whole cells instantly and is hidden under the garden's own obstacle-layer texture anyway (depth 3, above the mowed layer's depth 1).

Sprinkler-revert no longer rebuilds the whole mowed RT from grid state — `eraseMowedBlock(gr, gc, blockCells)` punches a targeted hole via `RenderTexture.erase()` over just the affected cell block.

## No Toggle-able Settings
Deck height, speed, blade, and distractions (sprinklers/squirrel) all used to be player-adjustable via a lever/toggle panel docked to the right border. That panel was removed — there is no in-game way to change these anymore. They're fixed at their old defaults: `this.deckHeight = 2` (set once in `create()`), `SPEED_STEP = 2` (medium), blade always on, distractions always on. If a "make it configurable again" request comes in, the lever UI code is recoverable from git history (commit `1b1fe23` and earlier had the full lever/toggle implementation).

## Mobile Layout
`#game-container` hosts the Phaser canvas (`scale.parent` in the game config); `#controls-spacer` (a sibling, sized via CSS flex) reserves room below it for the D-pad, real height only in portrait+touch (see media queries in `index.html`). `applyResponsiveLayout()` in `game.js` sets `#game-container`'s `aspect-ratio` from the computed `W`/`H` so Phaser's FIT scaling fills it with no dead space. The D-pad itself gets a smaller, portrait-specific size/layout (`108px`, nested inside `#controls-spacer`) vs. its default fixed-position landscape sizing (`150px`, floating over the canvas's side dead zone).

## Deploying
Commit and push to `main` — GitHub Actions workflow in `.github/workflows/deploy.yml` handles the rest. Live at https://erictempleton1.github.io/lawnmower-game/

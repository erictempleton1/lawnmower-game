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
BASE_YARD_COLS = 18, BASE_YARD_ROWS = 12 (authored level size, levels/level-0N.json)
```
`YARD_COLS`/`YARD_ROWS` (and so `COLS`/`ROWS`/`W`/`H`) are **computed at load** by `computeYardSize()`, not fixed — they grow past the base 18×12 so the yard's aspect ratio matches the device's viewport (columns grow for wide/landscape screens, rows grow for tall/portrait ones), clamped to `MAX_YARD_COLS`/`MAX_YARD_ROWS` as a safety ceiling. This is a one-time computation at page load; it does not live-recompute on resize or orientation change. `normalizeMap()` pads each authored level's map out to the computed size with plain grass, centering the original trees/gardens — level files themselves stay a fixed 18×12 and never need to change.

Anything that docks to the right border strip (lever panel, BLADE/DIST toggles) is positioned from `LEVER_X`/`SPD_LEVER_X`/`LEVER_PNL.x`, which are derived from `YARD_COLS` — so it shifts automatically when the yard grows wider. The matching DOM labels in `index.html` get their `left` set by `applyResponsiveLayout()` in `game.js` (their CSS values are just an 18-column fallback).

A wider/taller yard means more grass at a fixed mow rate, so `GROWTH_FACTOR` (how much bigger than the base 18×12 the yard got) drives `SWATH_CELLS`/`MOW_LOOP_RADIUS`, widening `mowAt()`'s mow footprint from a single cell to a `(2*MOW_LOOP_RADIUS+1)`-wide square block — moving in a line, that cuts a continuous strip of that width, keeping total mow time roughly constant across devices. `WORLD_SCALE` (equal to `SWATH_CELLS`, so the cut is never visually wider than what's cutting it) scales the player sprite, trees/gardens, the squirrel, the sprinkler, and the tree-trunk collision radius to match — otherwise a bigger mower would visually dwarf everything else in a heavily-grown yard. The player and squirrel use `setScale()` on their Graphics object (not baked-in draw coordinates — `drawPlayer()`/`drawSquirrel()` draw at local `(0,0)` and move via `setPosition()`); trees/gardens are stamped onto the obstacle RenderTexture with `{ scale: WORLD_SCALE }`; the sprinkler's Graphics gets `setScale()` once at creation and `setPosition()` once per activation (fixed for that animation's duration). `GROWTH_FACTOR` of 1 (already-4:3 screens) reproduces the original single-cell mower and unscaled world exactly — no behavior change there.

## Render Layer Depths (bottom → top)
| Depth | Object |
|-------|--------|
| 0 | Background RT |
| 1 | Mowed grass RT |
| 2 | Player gfx |
| 3 | Obstacle RT (trees + gardens) |
| 4 | Sprinkler gfx, Squirrel gfx |
| 10 | Joystick gfx, Lever gfx, HUD |

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

## Persistence Globals
```js
let g_distractionsEnabled = true;  // sprinklers + squirrel toggle
let g_speedStep = 2;               // 1=turtle, 2=medium, 3=rabbit
```

## Deploying
Commit and push to `main` — GitHub Actions workflow in `.github/workflows/deploy.yml` handles the rest. Live at https://erictempleton1.github.io/lawnmower-game/

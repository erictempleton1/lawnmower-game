# Lawnmower Game

A pixel art top-down lawnmower game built with Phaser 4. Mow the yard, dodge the sprinklers, watch out for squirrels.

**[Play it here](https://erictempleton1.github.io/lawnmower-game/)**

---

## How to Play

Mow 100% of the yard to complete each level. Navigate around trees and garden beds, and deal with the occasional sprinkler or squirrel if distractions are on.

### Controls

| Input | Action |
|-------|--------|
| Arrow keys / WASD | Move |
| Touch (left side of screen) | Virtual joystick |
| Touch (right strip) | Lever & toggle taps |

### Settings

- **DECK** — Deck height lever (1–3). Controls the mow stripe color. Lower deck = darker cut.
- **SPD** — Speed lever. Turtle is slow and steady; rabbit is fast but sprinklers pop up sooner.
- **BLADE** — Toggle the mower blade off so you can reposition without cutting.
- **DIST** — Toggle distractions (sprinklers + squirrel) on or off. Persists between levels.

### Obstacles

- **Trees** — You can mow and walk under the canopy. The trunk post blocks you from passing through.
- **Garden beds** — Fully blocked. Mow everything around them and the garden auto-fills.

### Distractions

- **Sprinklers** — Pop up on fully-mowed sections and revert the grass when they spray. More sprinklers per level.
- **Squirrel** — Runs across the yard. Blocks movement and mowing while in the way.

---

## Levels

| Level | Trees | Gardens | Sprinklers | Squirrels |
|-------|-------|---------|------------|-----------|
| 1 | 2 | 1 | 1 | 1 |
| 2 | 2 | 2 | 2 | 2 |
| 3 | 3 | 2 | 3 | 3 |

---

## Development

Built entirely through a conversational session with [Claude Code](https://claude.ai/code) — an AI coding assistant from Anthropic. The game was designed, iterated, and debugged interactively: describing a feature, seeing it in the browser, tweaking the feel, and repeating.

### Stack

- **[Phaser 4.2.1](https://phaser.io/)** — game framework (canvas rendering, input, scene management, scale)
- **Vanilla JS** — no build step, no bundler
- **HTML/CSS DOM overlay** — UI text lives outside the canvas to avoid pixel-art font blurring
- **GitHub Pages** — static hosting, deployed via GitHub Actions on every push

### Architecture Notes

- **RenderTextures** for the background, mowed grass layer, and obstacle layer — stamping pre-generated 16×32px textures rather than redrawing each frame
- **Layered depth system** — background (0) → mowed grass (1) → player (2) → trees/gardens (3) → sprinkler/squirrel (4) → HUD/levers (10), so the player visually walks under tree canopies
- **Grid-based mowing** — 2D `Uint8Array` tracks mow state per cell; obstacle grid handles gardens; tree trunks use pixel-radius collision so the mower enters and mows the cell but can't pass through
- **Module-level globals** for settings that persist across `scene.restart()` (speed, distractions toggle)
- **Virtual joystick** on the left 65% of the screen for touch; right strip routes to lever and toggle taps

### Running Locally

```bash
npx serve .
```

Then open `http://localhost:3000`.

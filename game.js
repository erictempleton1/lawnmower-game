// ─── Constants ───────────────────────────────────────────────────────────────
const CELL = 16;
const YARD_X = 3;
const YARD_Y = 3;
const YARD_COLS      = 18;  // fixed — matches every level's authored width
const BASE_YARD_ROWS = 12;  // authored level height
const MAX_YARD_ROWS  = 60;  // safety ceiling — tall phones can genuinely need ~35-40 rows to fill the screen

// Reserves room for the mobile D-pad below the canvas in portrait — must
// stay in sync with #controls-spacer's real height in index.html.
const CONTROL_RESERVE_PX = 190;

// On tall/narrow phone screens (portrait + touch), grow the yard's row
// count so the grass fills available vertical space instead of the fixed
// 18x12 shape leaving big empty margins above/below. Landscape and desktop
// are left untouched.
function computeYardRows() {
  const isPortraitTouch = window.matchMedia(
    '(hover: none) and (pointer: coarse) and (orientation: portrait)'
  ).matches;
  if (!isPortraitTouch) return BASE_YARD_ROWS;

  const availW = window.innerWidth;
  const availH = window.innerHeight - CONTROL_RESERVE_PX;
  const targetAspect = availW / Math.max(availH, 1);
  const idealRows = Math.round((YARD_COLS + YARD_X * 2) / targetAspect) - YARD_Y * 2;
  return Phaser.Math.Clamp(idealRows, BASE_YARD_ROWS, MAX_YARD_ROWS);
}

const YARD_ROWS = computeYardRows();
const COLS = YARD_COLS + YARD_X * 2;
const ROWS = YARD_ROWS + YARD_Y * 2;
const W = COLS * CELL;
const H = ROWS * CELL;
const WIN_PCT   = 100;
const SPEED_VALS = [45, 80, 130]; // turtle / medium / rabbit
const SPEED_STEP = 2;              // fixed at medium — no speed toggle

// Squirrels per level used to cap at (currentLevel + 1) — just 1 on level
// 1 — which reads as barely-there now that denser level layouts make a
// full mow take a lot longer. A flat, higher cap keeps them showing up at
// a similar pace regardless of level number or how long a level takes.
const DISTRACTIONS_PER_LEVEL = 4;

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg:         0x2d5a1b,
  border:     0x8b6914,
  player:     0xffe0b0,
  shirt:      0x2255cc,
  pants:      0x334466,
  mowerBody:  0xcc3333,
  mowerWheel: 0x222222,
};

// Deck height colours (index = deckHeight - 1)
const DECK = [
  { base: 0x5a8a3a, stripe: 0x6a9a45 }, // 1 — shortest / brightest
  { base: 0x447830, stripe: 0x548840 }, // 2 — medium
  { base: 0x2e5c1e, stripe: 0x3a6e2a }, // 3 — tallest / darkest
];

// Tree texture variants (see buildLevelTextures()) — one is picked at
// random per contiguous tree cluster in buildObstacleLayer().
const TREE_TYPES = ['tree_round', 'tree_evergreen'];

// Module-level so it survives scene.restart() — the intro modal is shown
// once, before the very first level, not again on every level transition.
let g_introShown = false;

// ─── Audio ────────────────────────────────────────────────────────────────────
// Procedurally synthesized (no audio files to vendor) via the raw Web
// Audio API rather than Phaser's sound manager, which is asset-based.
// Module-level and created once per page load (not per scene.restart()) —
// setupAudio() is called from the intro modal's Start button, a genuine
// user gesture, satisfying the browser's autoplay policy; every level
// after the first reuses the same context and nodes.
let g_audioCtx  = null;
let g_humGain   = null;

function setupAudio() {
  if (g_audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  g_audioCtx = new Ctx();

  // Mower hum: a single continuous low tone whose gain is modulated by
  // movement state (see setHumActive()) rather than started/stopped each
  // time the player moves — oscillators can only be started once, and
  // ramping gain avoids audible clicks at the transition. Low-pass
  // filtered and tonally soft so it reads as a background hum rather
  // than a game-y sound effect, matching the peaceful/not-busy goal —
  // but still loud enough to actually be heard (95Hz/gain 0.05 was
  // nearly inaudible on typical laptop/phone speakers).
  const osc = g_audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 115;
  const filter = g_audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  g_humGain = g_audioCtx.createGain();
  g_humGain.gain.value = 0;
  osc.connect(filter);
  filter.connect(g_humGain);
  g_humGain.connect(g_audioCtx.destination);
  osc.start();
}

function setHumActive(active) {
  if (!g_audioCtx || !g_humGain) return;
  g_humGain.gain.linearRampToValueAtTime(active ? 0.16 : 0, g_audioCtx.currentTime + 0.15);
}

// A soft 4-note major arpeggio, low volume with a quick attack and gentle
// decay — a small acknowledgment, not a fanfare, matching the rest of the
// game's low-key tone.
function playWinChime() {
  if (!g_audioCtx) return;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const t    = g_audioCtx.currentTime + i * 0.12;
    const osc  = g_audioCtx.createOscillator();
    const gain = g_audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain);
    gain.connect(g_audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

// A quick two-note "tweet-tweet", each note a fast upward pitch sweep —
// the classic chirp shape — triggered once when a bird launches (see
// launchBird()). High-pitched like a real bird call but very short and
// low volume so it registers as a brief accent, not an alert sound.
function playBirdChirp() {
  if (!g_audioCtx) return;
  for (let i = 0; i < 2; i++) {
    const t    = g_audioCtx.currentTime + i * 0.16;
    const osc  = g_audioCtx.createOscillator();
    const gain = g_audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2200, t);
    osc.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(2400, t + 0.11);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(gain);
    gain.connect(g_audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }
}

// A short two-note "arf-arf" — triggered once when the dog startles and
// scampers off (see updateDog()). A square oscillator gives a woofier body
// than a raw sawtooth, and a lowpass filter that sweeps down alongside the
// pitch drop rounds off the harsh top end so it reads as a soft bark
// rather than a buzz.
function playDogBark() {
  if (!g_audioCtx) return;
  for (let i = 0; i < 2; i++) {
    const t      = g_audioCtx.currentTime + i * 0.15;
    const osc    = g_audioCtx.createOscillator();
    const filter = g_audioCtx.createBiquadFilter();
    const gain   = g_audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.09);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(g_audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

// Pads an authored level map out to YARD_ROWS×YARD_COLS with plain grass,
// centering the original layout. A no-op once a map is already the right
// size, so it's safe to call again on scene.restart (which reuses the same
// already-normalized level objects).
function normalizeMap(map) {
  if (map.length === YARD_ROWS && map[0].length === YARD_COLS) return map;
  const baseRows = map.length, baseCols = map[0].length;
  const padTop  = Math.floor((YARD_ROWS - baseRows) / 2);
  const padLeft = Math.floor((YARD_COLS - baseCols) / 2);
  const out = [];
  for (let r = 0; r < YARD_ROWS; r++) {
    let row = '';
    for (let c = 0; c < YARD_COLS; c++) {
      const sr = r - padTop, sc = c - padLeft;
      row += (sr >= 0 && sr < baseRows && sc >= 0 && sc < baseCols) ? map[sr][sc] : '.';
    }
    out.push(row);
  }
  return out;
}

// ─── Boot scene ───────────────────────────────────────────────────────────────
// Loads levels/index.json then each level file, then starts GameScene.
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    this.load.json('level-index', 'levels/index.json');
  }

  create() {
    const index = this.cache.json.get('level-index');
    index.levels.forEach(file => this.load.json(file, `levels/${file}`));
    this.load.once('complete', () => {
      const levels = index.levels.map(file => this.cache.json.get(file));
      this.scene.start('Game', { levels, level: 0 });
    });
    this.load.start();
  }
}

// ─── GameScene ────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.allLevels    = (data?.levels ?? []).map(lvl => ({ ...lvl, map: normalizeMap(lvl.map) }));
    this.currentLevel = data?.level  ?? 0;
  }

  get levelData() { return this.allLevels[this.currentLevel]; }

  create() {
    this.grid           = Array.from({ length: YARD_ROWS }, () => new Uint8Array(YARD_COLS));
    this.mowedCount     = 0;
    this.won            = false;
    this.deckHeight     = 2;
    this.speedStep      = SPEED_STEP;
    this.squirrel       = { active: false };
    this.squirrelCount  = 0;
    this.bird           = { active: false };
    this.deer           = { active: false };
    this.fox            = { active: false };
    // Gated on the intro modal for the very first level only — see
    // buildIntroOverlay(). Already-dismissed (g_introShown) on every
    // level after that, so play starts immediately without re-showing it.
    this.started        = g_introShown;

    this.buildMowedTextures();
    this.buildBackground();
    this.buildMowedLayer();
    this.buildObstacleLayer();

    this.totalCells = YARD_ROWS * YARD_COLS;

    this.setupPlayer();
    this.setupInput();

    // Dog: sits somewhere away from the player's start cell for the whole
    // level, reacting to proximity every frame rather than on a timer (see
    // updateDog()) — always present, unlike the scheduled wildlife below.
    const dogSpot = this.pickDogSpot(this.player.x, this.player.y, 80)
      ?? { x: (YARD_X + YARD_COLS - 1) * CELL + CELL / 2, y: (YARD_Y + YARD_ROWS - 1) * CELL + CELL / 2 };
    this.dog = { x: dogSpot.x, y: dogSpot.y, state: 'idle', cooldownRemaining: 0 };

    this.buildHUD();
    this.buildWinOverlay();
    this.buildIntroOverlay();
    this.syncUIOverlay();
    this.scale.on('resize', this.syncUIOverlay, this);

    this.squirrelGfx = this.add.graphics();
    this.squirrelGfx.setDepth(4);
    this.birdGfx = this.add.graphics();
    this.birdGfx.setDepth(4);
    this.deerGfx = this.add.graphics();
    this.deerGfx.setDepth(4);
    this.foxGfx = this.add.graphics();
    this.foxGfx.setDepth(4);
    this.dogGfx = this.add.graphics();
    this.dogGfx.setDepth(4);
    this.drawDog();

    this.mowAt(this.player.x, this.player.y);
    if (g_introShown) {
      this.scheduleSquirrel();
      this.scheduleBird();
      this.scheduleDeer();
      this.scheduleFox();
    }

    document.getElementById('loading-screen')?.classList.add('hidden');
  }

  // ── Textures ─────────────────────────────────────────────────────────────

  buildMowedTextures() {
    // One full-cell (16×16) texture per deck height — used both for the
    // player's own mowing (mowAt()) and gardens' instant auto-mow
    // (checkClusterCompletion()). A single always-full-cell shape (no
    // narrower travel-direction variants) is what keeps mowed cells
    // grid-aligned and gap-free on any path: full cells always tile
    // perfectly with their neighbors, and since they're stamped at exact
    // grid-cell coordinates they can never render outside the yard.
    for (let h = 1; h <= 3; h++) {
      const { base, stripe } = DECK[h - 1];
      const gf = this.make.graphics({ add: false });
      gf.fillStyle(base);
      gf.fillRect(0, 0, CELL, CELL);
      gf.fillStyle(stripe, 0.5);
      gf.fillRect(2, 0, 3, CELL);
      gf.fillRect(10, 0, 2, CELL);
      gf.lineStyle(1, 0x000000, 0.05);
      gf.strokeRect(0, 0, CELL, CELL);
      gf.generateTexture(`mowed_${h}_full`, CELL, CELL);
      gf.destroy();
    }
  }

  buildLevelTextures() {
    const S = CELL * 2; // 32px — fits a 2×2 cell block

    // Round / deciduous tree — 32×32 pixel art. Both tree variants below
    // keep the trunk in the same y=18..31 footprint so the shared
    // trunk-collision offset in buildObstacleLayer() (ty + 8) lines up
    // with either without needing a per-type adjustment.
    const tg = this.make.graphics({ add: false });
    tg.fillStyle(0x000000, 0.2);
    tg.fillEllipse(16, 29, 24, 6);          // ground shadow
    tg.fillStyle(0x6b3a17);
    tg.fillRect(12, 18, 8, 13);             // trunk
    tg.fillStyle(0x8b5a2a, 0.4);
    tg.fillRect(13, 18, 3, 13);             // trunk highlight
    tg.fillStyle(0x1a4a0a);
    tg.fillCircle(16, 14, 13);              // canopy outer
    tg.fillStyle(0x2a6a10);
    tg.fillCircle(16, 13, 11);
    tg.fillStyle(0x3a8818);
    tg.fillCircle(15, 11, 9);
    tg.fillStyle(0x4aaa22, 0.8);
    tg.fillCircle(14, 9, 6);
    tg.fillStyle(0x5ac030, 0.5);
    tg.fillCircle(13, 7, 4);               // canopy highlight
    // Darker lobe-breaks around the rim so the silhouette doesn't read as
    // a perfect circle.
    tg.fillStyle(0x1a4a0a, 0.55);
    tg.fillCircle(6, 16, 4);
    tg.fillCircle(25, 17, 4);
    tg.fillCircle(20, 4, 3);
    tg.generateTexture('tree_round', S, S);
    tg.destroy();

    // Evergreen / pine — three stacked triangle tiers, dark and pointed.
    // Kept to roughly the same footprint as tree_round's ~26px canopy
    // (not spanning the full 32×32 tile) so it doesn't read as oversized
    // next to it.
    const te = this.make.graphics({ add: false });
    te.fillStyle(0x000000, 0.2);
    te.fillEllipse(16, 29, 20, 5);
    te.fillStyle(0x5a3a1a);
    te.fillRect(14, 18, 4, 13);             // trunk (same footprint as tree_round)
    te.fillStyle(0x123a10);
    te.fillTriangle(16, 10, 6, 24, 26, 24); // bottom tier — widest, darkest
    te.fillStyle(0x1e5c18);
    te.fillTriangle(16, 5, 9, 18, 23, 18);  // middle tier
    te.fillStyle(0x2f7a22);
    te.fillTriangle(16, 1, 11, 12, 21, 12); // top tier — smallest, brightest
    te.fillStyle(0x4a9a33, 0.5);
    te.fillTriangle(16, 1, 16, 20, 21, 12); // highlight sliver down one side
    te.generateTexture('tree_evergreen', S, S);
    te.destroy();

    // Bush / hedge — 16×16, one per grid cell (not a 32×32 2-cell block
    // like trees/gardens), since hedges are laid out as irregular
    // single-cell-wide rows in level data and need that finer granularity.
    const tb = this.make.graphics({ add: false });
    tb.fillStyle(0x000000, 0.15);
    tb.fillEllipse(8, 14, 12, 3);           // ground shadow
    tb.fillStyle(0x2a4a18);
    tb.fillCircle(8, 9, 7);                 // base lump
    tb.fillStyle(0x3a6a22);
    tb.fillCircle(5, 7, 5);
    tb.fillCircle(11, 8, 5);
    tb.fillStyle(0x4a8a2a);
    tb.fillCircle(8, 6, 4);
    tb.fillStyle(0x5aa034, 0.7);
    tb.fillCircle(6, 4, 2.5);               // highlight
    tb.generateTexture('bush', CELL, CELL);
    tb.destroy();

    // Garden bed — 32×32 pixel art
    const gg = this.make.graphics({ add: false });
    gg.fillStyle(0x4a2008);
    gg.fillRect(0, 0, S, S);               // outer border/planks
    gg.fillStyle(0x7a4a1a);
    gg.fillRect(4, 4, S - 8, S - 8);      // soil
    gg.fillStyle(0x8b5a22, 0.4);
    gg.fillRect(5, 5, 10, 8);              // soil variation
    gg.lineStyle(1, 0x3a1a00, 0.5);       // plank lines
    gg.lineBetween(0, 11, S, 11);
    gg.lineBetween(0, 22, S, 22);
    gg.lineBetween(11, 0, 11, S);
    gg.lineBetween(22, 0, 22, S);
    const flowers = [                       // flowers [x, y, color]
      [8,  8,  0xff5555],
      [20, 8,  0xffdd44],
      [8,  20, 0xcc55ff],
      [20, 20, 0xff8844],
      [14, 14, 0x55ccff],
    ];
    for (const [fx, fy, fc] of flowers) {
      gg.fillStyle(0x336622);
      gg.fillRect(fx, fy + 3, 2, 6);      // stem
      gg.fillStyle(0x44aa33, 0.6);
      gg.fillRect(fx - 3, fy + 5, 8, 3);  // leaves
      gg.fillStyle(fc, 0.95);
      gg.fillRect(fx - 2, fy, 6, 5);      // bloom
      gg.fillStyle(0xffff99, 0.8);
      gg.fillRect(fx - 1, fy + 1, 4, 3);  // bloom center
    }
    gg.lineStyle(1, 0x7a4a10, 0.5);
    gg.strokeRect(1, 1, S - 2, S - 2);
    gg.generateTexture('garden', S, S);
    gg.destroy();
  }

  buildBackground() {
    // Self-contained (not in buildLevelTextures()) since this runs before
    // that does — the unmowable border gets its own bigger, more muted
    // decorative tree, scattered purely for atmosphere with no collision.
    const BG_S = 44;
    const bt = this.make.graphics({ add: false });
    bt.fillStyle(0x000000, 0.25);
    bt.fillEllipse(BG_S / 2, BG_S - 6, BG_S * 0.7, 7);
    bt.fillStyle(0x4a3018);
    bt.fillRect(BG_S / 2 - 4, BG_S - 18, 8, 15);
    bt.fillStyle(0x16300f);
    bt.fillCircle(BG_S / 2, BG_S / 2 - 4, BG_S * 0.42);
    bt.fillStyle(0x1f4014);
    bt.fillCircle(BG_S / 2 - 2, BG_S / 2 - 6, BG_S * 0.34);
    bt.fillStyle(0x2a5019);
    bt.fillCircle(BG_S / 2 - 4, BG_S / 2 - 9, BG_S * 0.24);
    bt.generateTexture('bg_tree', BG_S, BG_S);
    bt.destroy();

    // Background pine — same muted palette as bg_tree, conical instead of
    // round, staggered in alongside it on the left/right sides for a more
    // layered forest-edge look.
    const BG_PINE_S = 40;
    const bp = this.make.graphics({ add: false });
    bp.fillStyle(0x000000, 0.25);
    bp.fillEllipse(BG_PINE_S / 2, BG_PINE_S - 5, BG_PINE_S * 0.6, 6);
    bp.fillStyle(0x3a2810);
    bp.fillRect(BG_PINE_S / 2 - 3, BG_PINE_S - 15, 6, 12);
    bp.fillStyle(0x12280d);
    bp.fillTriangle(BG_PINE_S / 2, 4, BG_PINE_S * 0.1, BG_PINE_S * 0.75, BG_PINE_S * 0.9, BG_PINE_S * 0.75);
    bp.fillStyle(0x1a3812);
    bp.fillTriangle(BG_PINE_S / 2, 10, BG_PINE_S * 0.2, BG_PINE_S * 0.55, BG_PINE_S * 0.8, BG_PINE_S * 0.55);
    bp.fillStyle(0x234a18);
    bp.fillTriangle(BG_PINE_S / 2, 16, BG_PINE_S * 0.3, BG_PINE_S * 0.35, BG_PINE_S * 0.7, BG_PINE_S * 0.35);
    bp.generateTexture('bg_pine', BG_PINE_S, BG_PINE_S);
    bp.destroy();

    const g = this.make.graphics({ add: false });

    // Border: a darker, wilder green (unmown) instead of flat dirt, so it
    // reads as untamed nature framing the tidy yard rather than dead space.
    g.fillStyle(0x1e3a12);
    g.fillRect(0, 0, W, H);
    g.fillStyle(C.bg);
    g.fillRect(YARD_X * CELL, YARD_Y * CELL, YARD_COLS * CELL, YARD_ROWS * CELL);

    g.lineStyle(1, 0x000000, 0.05);
    for (let c = 0; c <= YARD_COLS; c++)
      g.lineBetween((YARD_X + c) * CELL, YARD_Y * CELL,
                    (YARD_X + c) * CELL, (YARD_Y + YARD_ROWS) * CELL);
    for (let r = 0; r <= YARD_ROWS; r++)
      g.lineBetween(YARD_X * CELL, (YARD_Y + r) * CELL,
                    (YARD_X + YARD_COLS) * CELL, (YARD_Y + r) * CELL);

    // Tall grass blades on ~35% of cells
    for (let r = 0; r < YARD_ROWS; r++) {
      for (let c = 0; c < YARD_COLS; c++) {
        if (Math.random() > 0.35) continue;
        const cx = (YARD_X + c) * CELL;
        const cy = (YARD_Y + r) * CELL;
        const blades = 2 + Math.floor(Math.random() * 2);
        for (let b = 0; b < blades; b++) {
          const bx    = cx + 2 + Math.floor(Math.random() * (CELL - 4));
          const bh    = 4 + Math.floor(Math.random() * 5);
          const alpha = 0.35 + Math.random() * 0.25;
          g.fillStyle(0x1a4010, alpha);
          g.fillRect(bx, cy + CELL - bh - 1, 1, bh);
        }
      }
    }

    // Wild grass blades across the whole border margin — denser and
    // taller than the yard's own accent blades, to read as unmown — plus
    // scattered wildflowers as small colorful accents among them.
    const yardL = YARD_X * CELL, yardT = YARD_Y * CELL;
    const yardR = (YARD_X + YARD_COLS) * CELL, yardB = (YARD_Y + YARD_ROWS) * CELL;
    const wildflowerColors = [0xff5555, 0xffdd44, 0xcc55ff, 0xff8844, 0x55ccff, 0xffffff];
    for (let y = 4; y < H; y += 7) {
      for (let x = 4; x < W; x += 7) {
        if (x > yardL && x < yardR && y > yardT && y < yardB) continue;
        if (Math.random() <= 0.55) {
          const bh    = 5 + Math.floor(Math.random() * 8);
          const alpha = 0.4 + Math.random() * 0.3;
          g.fillStyle(0x0f2408, alpha);
          g.fillRect(x + Phaser.Math.Between(-2, 2), y - bh, 1, bh);
        }
        if (Math.random() <= 0.1) {
          const fx = x + Phaser.Math.Between(-2, 2);
          const fy = y + Phaser.Math.Between(-2, 2);
          const fc = wildflowerColors[Phaser.Math.Between(0, wildflowerColors.length - 1)];
          g.fillStyle(0x2a5a1a, 0.85);
          g.fillRect(fx, fy, 1, 3);          // stem
          g.fillStyle(fc, 0.95);
          g.fillRect(fx - 1, fy - 2, 3, 3);  // bloom
          g.fillStyle(0xffffff, 0.6);
          g.fillRect(fx, fy - 1, 1, 1);      // center highlight
        }
      }
    }

    const rt = this.add.renderTexture(0, 0, W, H);
    rt.setOrigin(0, 0);
    rt.draw(g, 0, 0);

    // Scattered taller background trees around the border, purely
    // cosmetic (no collision — the border is already unreachable).
    // Collected and y-sorted before stamping (painter's algorithm) rather
    // than stamped in fixed type order (all bg_tree, then all bg_pine) —
    // with a fixed order, whichever type stamps last always draws on top
    // of the other wherever they touch, so a pine's trunk could poke out
    // over a round tree's canopy even after tightening the jitter/spacing
    // to reduce how often they touch at all. Sorting by y so whichever
    // tree sits lower (closer, in the implied top-down depth) always
    // correctly occludes the one above it fixes this regardless of type
    // or any residual overlap.
    const margin = 20;
    const bgTrees = [];
    for (let x = margin; x < W - margin; x += 66)
      bgTrees.push({ key: 'bg_tree', x: x + Phaser.Math.Between(-4, 4), y: margin });
    for (let x = margin; x < W - margin; x += 66)
      bgTrees.push({ key: 'bg_tree', x: x + Phaser.Math.Between(-4, 4), y: H - margin });
    for (let y = yardT + margin; y < yardB - margin; y += 66)
      bgTrees.push({ key: 'bg_tree', x: margin, y: y + Phaser.Math.Between(-4, 4) });
    for (let y = yardT + margin; y < yardB - margin; y += 66)
      bgTrees.push({ key: 'bg_tree', x: W - margin, y: y + Phaser.Math.Between(-4, 4) });
    // Pine trees staggered in alongside the side bg_trees — offset half a
    // step vertically and tucked further out toward the outer edge, so
    // the two rows interleave into a layered tree line.
    for (let y = yardT + margin + 33; y < yardB - margin; y += 66)
      bgTrees.push({ key: 'bg_pine', x: margin - 18, y: y + Phaser.Math.Between(-4, 4) });
    for (let y = yardT + margin + 33; y < yardB - margin; y += 66)
      bgTrees.push({ key: 'bg_pine', x: W - margin + 18, y: y + Phaser.Math.Between(-4, 4) });

    bgTrees.sort((a, b) => a.y - b.y);
    for (const { key, x, y } of bgTrees) rt.stamp(key, null, x, y);

    rt.render();
    g.destroy();
  }

  buildMowedLayer() {
    this.mowedRT = this.add.renderTexture(0, 0, W, H);
    this.mowedRT.setOrigin(0, 0);
    this.mowedRT.setDepth(1);
    this.mowedRT.clear();
    this.mowedRT.render();
  }

  buildObstacleLayer() {
    this.buildLevelTextures();

    const map = this.levelData.map;
    this.obstacleGrid = Array.from({ length: YARD_ROWS }, () => new Uint8Array(YARD_COLS));
    this.obstacleClusters = [];

    // Gardens and bushes/hedges: all cells grid-blocked (isNearGarden()'s
    // edge-collision check applies to any obstacleGrid cell, not just
    // gardens specifically). Trees: no grid blocking — trunk uses
    // pixel-radius collision so the mower can enter and mow the cell but
    // can't pass through the trunk post.
    for (let r = 0; r < YARD_ROWS; r++)
      for (let c = 0; c < YARD_COLS; c++)
        if (map[r][c] === 'G' || map[r][c] === 'B') this.obstacleGrid[r][c] = 1;

    this.trunkPositions = [];

    this.obstacleRT = this.add.renderTexture(0, 0, W, H);
    this.obstacleRT.setOrigin(0, 0);
    this.obstacleRT.setDepth(3);

    for (let r = 0; r < YARD_ROWS; r++) {
      for (let c = 0; c < YARD_COLS; c++) {
        const type = map[r][c];
        if (type !== 'T' && type !== 'G' && type !== 'B') continue;

        // Only process from the top-left corner of each contiguous cluster
        const aboveSame = r > 0 && map[r - 1][c] === type;
        const leftSame  = c > 0 && map[r][c - 1] === type;
        if (aboveSame || leftSame) continue;

        // Measure cluster width and height
        let cw = 1, cH = 1;
        while (c + cw < YARD_COLS && map[r][c + cw] === type) cw++;
        while (r + cH < YARD_ROWS && map[r + cH] && map[r + cH][c] === type) cH++;

        if (type === 'G' || type === 'B') {
          // Gardens and bushes/hedges: auto-mow when all perimeter cells
          // are mowed. Hidden under their own obstacle-layer texture
          // anyway (depth 3, above the mowed layer's depth 1), so it's
          // invisible until the whole cluster is cleared.
          const cells = [];
          for (let dr = 0; dr < cH; dr++)
            for (let dc = 0; dc < cw; dc++)
              cells.push([r + dr, c + dc]);

          const perimSet = new Set();
          for (const [cr, cc] of cells) {
            for (const [nr, nc] of [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]]) {
              if (nr >= 0 && nr < YARD_ROWS && nc >= 0 && nc < YARD_COLS && !this.obstacleGrid[nr][nc])
                perimSet.add(nr * YARD_COLS + nc);
            }
          }
          const perimeter = [...perimSet].map(i => [Math.floor(i / YARD_COLS), i % YARD_COLS]);
          this.obstacleClusters.push({ cells, perimeter, done: false });
        } else {
          // Trees: record trunk center for each 2×2 sub-block (used by isObstacle)
          for (let dr = 0; dr < cH; dr += 2) {
            for (let dc = 0; dc < cw; dc += 2) {
              const tx = (YARD_X + c + dc) * CELL + CELL; // stamp center x
              const ty = (YARD_Y + r + dr) * CELL + CELL; // stamp center y
              // Trunk center is 8px below the sprite center (matches the drawn trunk)
              this.trunkPositions.push({ wx: tx, wy: ty + 8 });
            }
          }
        }

        if (type === 'B') {
          // Bushes: one 16×16 texture per single cell (not a 32×32 2-cell
          // block like trees/gardens use), since a hedge is often a
          // single-cell-wide row of arbitrary length.
          for (let dr = 0; dr < cH; dr++) {
            for (let dc = 0; dc < cw; dc++) {
              const bx = (YARD_X + c + dc) * CELL + CELL / 2;
              const by = (YARD_Y + r + dr) * CELL + CELL / 2;
              this.obstacleRT.stamp('bush', null, bx, by);
            }
          }
        } else {
          // Stamp one 32×32 texture per 2×2 sub-block within the cluster.
          // Trees pick one of a few variants per cluster (not per
          // sub-block) so a single clump of trees reads as one coherent
          // type instead of a mix of species crammed together.
          const key = type === 'T'
            ? TREE_TYPES[Phaser.Math.Between(0, TREE_TYPES.length - 1)]
            : 'garden';
          for (let dr = 0; dr < cH; dr += 2) {
            for (let dc = 0; dc < cw; dc += 2) {
              const tx = (YARD_X + c + dc) * CELL + CELL;
              const ty = (YARD_Y + r + dr) * CELL + CELL;
              this.obstacleRT.stamp(key, null, tx, ty);
            }
          }
        }
      }
    }

    this.obstacleRT.render();
  }

  // ── Player ───────────────────────────────────────────────────────────────

  setupPlayer() {
    this.player = {
      x: YARD_X * CELL + CELL / 2,
      y: YARD_Y * CELL + CELL / 2,
      dir: 'down',
      gfx: this.add.graphics(),
    };
    this.player.gfx.setDepth(2);
    this.drawPlayer();
  }

  drawPlayer() {
    const g   = this.player.gfx;
    g.clear();
    const px  = Math.round(this.player.x);
    const py  = Math.round(this.player.y);
    const dir = this.player.dir;
    const mox = dir === 'left' ? -10 : dir === 'right' ? 10 : 0;
    const moy = dir === 'up'   ? -10 : dir === 'down'  ? 10 : 0;

    g.fillStyle(C.mowerBody);
    g.fillRect(px + mox - 5, py + moy - 4, 10, 8);
    g.fillStyle(C.mowerWheel);
    g.fillRect(px + mox - 6, py + moy - 5, 3, 3);
    g.fillRect(px + mox + 3, py + moy - 5, 3, 3);
    g.fillRect(px + mox - 6, py + moy + 2, 3, 3);
    g.fillRect(px + mox + 3, py + moy + 2, 3, 3);
    g.lineStyle(2, 0x884400);
    g.lineBetween(px, py, px + mox * 0.55, py + moy * 0.55);
    g.fillStyle(C.pants);
    g.fillRect(px - 3, py + 1, 6, 5);
    g.fillStyle(C.shirt);
    g.fillRect(px - 3, py - 4, 6, 6);
    g.fillStyle(C.player);
    g.fillRect(px - 2, py - 8, 5, 5);
    g.fillStyle(0x226611);
    g.fillRect(px - 3, py - 10, 7, 3);
    g.fillRect(px - 2, py - 12, 5, 3);
  }

  // ── Obstacle collision ────────────────────────────────────────────────────

  isObstacle(px, py) {
    const gc = Math.floor((px - YARD_X * CELL) / CELL);
    const gr = Math.floor((py - YARD_Y * CELL) / CELL);
    if (gc < 0 || gc >= YARD_COLS || gr < 0 || gr >= YARD_ROWS) return false;
    if (this.isNearGarden(px, py)) return true;
    for (const { wx, wy } of this.trunkPositions) {
      const ddx = px - wx, ddy = py - wy;
      if (ddx * ddx + ddy * ddy < 36) return true; // 6px radius around trunk
    }
    if (this.squirrel.active) {
      const sqc = Math.floor((this.squirrel.x - YARD_X * CELL) / CELL);
      const sqr = Math.floor((this.squirrel.y - YARD_Y * CELL) / CELL);
      if (gc === sqc && gr === sqr) return true;
    }
    const dgc = Math.floor((this.dog.x - YARD_X * CELL) / CELL);
    const dgr = Math.floor((this.dog.y - YARD_Y * CELL) / CELL);
    if (gc === dgc && gr === dgr) return true;
    return false;
  }

  isNearGarden(px, py) {
    // Checking only the exact center point let the mower's ~12px-wide
    // visual footprint overlap into a garden bed before the point itself
    // crossed the cell boundary. Sampling a small cross of points around
    // it (matching the mower's rough half-width) stops it right at the edge.
    const MARGIN = 6;
    const offsets = [[0, 0], [-MARGIN, 0], [MARGIN, 0], [0, -MARGIN], [0, MARGIN]];
    for (const [dx, dy] of offsets) {
      const gc = Math.floor((px + dx - YARD_X * CELL) / CELL);
      const gr = Math.floor((py + dy - YARD_Y * CELL) / CELL);
      if (gc < 0 || gc >= YARD_COLS || gr < 0 || gr >= YARD_ROWS) continue;
      if (this.obstacleGrid[gr][gc] === 1) return true;
    }
    return false;
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd    = this.input.keyboard.addKeys('W,A,S,D');
    this.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT');

    // Touch-primary devices (phones/tablets) get the on-screen D-pad instead
    // of the drag joystick — matches the CSS media query that shows #dpad.
    this.isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    this.joystick    = { active: false, baseX: 0, baseY: 0, stickX: 0, stickY: 0, dx: 0, dy: 0, pointerId: null };
    this.joystickGfx = this.add.graphics();
    this.joystickGfx.setDepth(10);

    this.dpad = { up: false, down: false, left: false, right: false };
    this.setupDpad();

    this.input.on('pointerdown', (p) => {
      if (this.won) {
        this.advanceLevel();
        return;
      }
      if (!this.isTouchDevice && p.x < W * 0.65) {
        this.joystick.active    = true;
        this.joystick.baseX     = p.x;
        this.joystick.baseY     = p.y;
        this.joystick.stickX    = p.x;
        this.joystick.stickY    = p.y;
        this.joystick.pointerId = p.id;
        this.joystick.dx        = 0;
        this.joystick.dy        = 0;
      }
    });

    this.input.on('pointermove', (p) => {
      if (!this.joystick.active || p.id !== this.joystick.pointerId) return;
      const dx   = p.x - this.joystick.baseX;
      const dy   = p.y - this.joystick.baseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxR = 36;
      const s    = dist > maxR ? maxR / dist : 1;
      this.joystick.stickX = this.joystick.baseX + dx * s;
      this.joystick.stickY = this.joystick.baseY + dy * s;
      this.joystick.dx     = dx / Math.max(dist, maxR);
      this.joystick.dy     = dy / Math.max(dist, maxR);
    });

    const endJoy = (p) => {
      if (p.id !== this.joystick.pointerId) return;
      this.joystick.active = false;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.joystickGfx.clear();
    };
    this.input.on('pointerup', endJoy);
    this.input.on('pointerupoutside', endJoy);

    this.input.keyboard.on('keydown-R', () => {
      if (this.won) this.advanceLevel();
    });
  }

  setupDpad() {
    const dirs = { 'dpad-up': 'up', 'dpad-down': 'down', 'dpad-left': 'left', 'dpad-right': 'right' };
    for (const [id, dir] of Object.entries(dirs)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const press = (e) => {
        e.preventDefault();
        this.dpad[dir] = true;
        el.classList.add('active');
      };
      const release = (e) => {
        e.preventDefault();
        this.dpad[dir] = false;
        el.classList.remove('active');
      };
      // Assign directly (not addEventListener) — these DOM buttons live
      // outside the canvas and persist across scene.restart(), so repeated
      // create() calls would otherwise stack handlers bound to stale scenes.
      el.onpointerdown  = press;
      el.onpointerup    = release;
      el.onpointerleave = release;
      el.onpointercancel = release;
    }
  }

  drawJoystick() {
    const jg = this.joystickGfx;
    jg.clear();
    if (!this.joystick.active) return;
    const { baseX, baseY, stickX, stickY } = this.joystick;
    jg.lineStyle(2, 0xffffff, 0.3);
    jg.strokeCircle(baseX, baseY, 36);
    jg.fillStyle(0xffffff, 0.25);
    jg.fillCircle(stickX, stickY, 18);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  buildHUD() {
    // No progress bar — just the level indicator (in the canvas overlay)
    // and a plain percentage readout docked near the D-pad, outside the
    // canvas entirely (see #hud-pct-bottom in index.html).
    document.getElementById('hud-level').textContent = `L${this.currentLevel + 1}`;
    this.pctEl = document.getElementById('hud-pct-bottom');
    this.pctEl.textContent = '0%';
  }

  syncUIOverlay() {
    // Position the UI overlay div to sit exactly over the Phaser canvas.
    // canvasBounds gives the canvas rect in page coordinates after FIT scaling.
    const b  = this.scale.canvasBounds;
    const el = document.getElementById('ui-canvas');
    const s  = b.width / W;
    el.style.left      = b.x + 'px';
    el.style.top       = b.y + 'px';
    el.style.transform = `scale(${s})`;
  }

  buildWinOverlay() {
    this.winEl       = document.getElementById('win-overlay');
    this.winNextEl   = document.getElementById('win-next');
    this.winActionEl = document.getElementById('win-action');
    // #win-overlay is a DOM element layered on top of the canvas, so once
    // it's visible (pointer-events: auto) it — not the canvas — receives
    // any tap. Phaser's own `pointerdown` listener is bound to the canvas
    // element specifically and can never fire while this overlay is up, so
    // "tap to continue" has to be wired here directly. Assigned (not
    // addEventListener) since this element persists across scene.restart().
    this.winEl.onpointerdown = () => {
      if (this.won) this.advanceLevel();
    };
    this.events.on('shutdown', () => {
      this.hideWin();
      this.scale.off('resize', this.syncUIOverlay, this);
      if (this.squirrelTimer) this.squirrelTimer.remove();
      if (this.birdTimer)     this.birdTimer.remove();
      if (this.deerTimer)     this.deerTimer.remove();
      if (this.foxTimer)      this.foxTimer.remove();
      this.squirrelGfx?.clear();
      this.birdGfx?.clear();
      this.deerGfx?.clear();
      this.foxGfx?.clear();
      this.dogGfx?.clear();
    });
  }

  // Shown once, before the very first level — blocks movement/mowing
  // (see update()'s this.started check) until the player taps Start.
  // Skipped entirely (including re-wiring the button) once g_introShown,
  // since it's never shown again for the rest of the session.
  buildIntroOverlay() {
    if (g_introShown) return;
    const introEl  = document.getElementById('intro-overlay');
    const startBtn = document.getElementById('intro-start-btn');
    const begin = () => {
      g_introShown  = true;
      this.started  = true;
      introEl.classList.remove('visible');
      setupAudio();
      this.scheduleSquirrel();
      this.scheduleBird();
      this.scheduleDeer();
      this.scheduleFox();
    };
    // Assigned (not addEventListener) since this button persists across
    // scene.restart(), matching the win-overlay/dpad pattern elsewhere.
    startBtn.onclick = begin;
    this.input.keyboard.once('keydown-ENTER', begin);
    this.input.keyboard.once('keydown-SPACE', begin);
  }

  advanceLevel() {
    const next = (this.currentLevel + 1) % this.allLevels.length;
    this.hideWin();
    this.scene.restart({ levels: this.allLevels, level: next });
  }

  showWin() {
    const isLast = this.currentLevel >= this.allLevels.length - 1;
    this.winNextEl.textContent   = isLast ? 'All levels complete!' : `Up next: ${this.allLevels[this.currentLevel + 1].name}`;
    this.winActionEl.textContent = isLast ? 'Tap or press R to restart from L1' : 'Tap or press R for next level';
    this.winEl.classList.add('visible');
    playWinChime();
  }

  hideWin() {
    this.winEl.classList.remove('visible');
  }

  // ── Mowing ────────────────────────────────────────────────────────────────

  mowAt(px, py) {
    const gc = Math.floor((px - YARD_X * CELL) / CELL);
    const gr = Math.floor((py - YARD_Y * CELL) / CELL);
    if (gc < 0 || gc >= YARD_COLS || gr < 0 || gr >= YARD_ROWS) return;
    if (this.obstacleGrid[gr][gc]) return;
    if (this.squirrel.active) {
      const sqc = Math.floor((this.squirrel.x - YARD_X * CELL) / CELL);
      const sqr = Math.floor((this.squirrel.y - YARD_Y * CELL) / CELL);
      if (gc === sqc && gr === sqr) return;
    }
    const dgc = Math.floor((this.dog.x - YARD_X * CELL) / CELL);
    const dgr = Math.floor((this.dog.y - YARD_Y * CELL) / CELL);
    if (gc === dgc && gr === dgr) return;

    const cellH = this.grid[gr][gc];
    if (cellH !== 0 && this.deckHeight >= cellH) return;

    // Stamp the whole grid cell, always the same full-size texture
    // regardless of travel direction. A mower-width sub-cell stroke reads
    // as smoother, but it isn't grid-aligned — it can creep toward the
    // yard border independent of collision, and it stops looking like a
    // blocky, cell-by-cell mow. A full-cell stamp is always exactly one
    // grid cell, so it can never render outside the yard (cells are
    // always within YARD_COLS×YARD_ROWS by construction) and always tiles
    // perfectly with its neighbors on any path — straight, diagonal, or a
    // turn — since there's only one shape and it always fills the cell.
    const firstMow = cellH === 0;
    this.grid[gr][gc] = this.deckHeight;
    if (firstMow) this.mowedCount++;

    const cx = (YARD_X + gc) * CELL + CELL / 2;
    const cy = (YARD_Y + gr) * CELL + CELL / 2;
    this.mowedRT.stamp(`mowed_${this.deckHeight}_full`, null, cx, cy);
    this.mowedRT.render();

    if (firstMow) {
      this.checkClusterCompletion();
      this.updateHUD();
    }
  }

  checkClusterCompletion() {
    for (const cluster of this.obstacleClusters) {
      if (cluster.done || cluster.perimeter.length === 0) continue;
      if (!cluster.perimeter.every(([r, c]) => this.grid[r][c] !== 0)) continue;
      cluster.done = true;
      for (const [r, c] of cluster.cells) {
        if (this.grid[r][c] !== 0) continue;
        this.grid[r][c] = 2;
        this.mowedCount++;
        const cx = (YARD_X + c) * CELL + CELL / 2;
        const cy = (YARD_Y + r) * CELL + CELL / 2;
        // Full-size — this is hidden under the garden's own texture anyway
        // (obstacle layer renders above the mowed layer), so shape is moot.
        this.mowedRT.stamp('mowed_2_full', null, cx, cy);
      }
      this.mowedRT.render();
    }
  }

  // ── Squirrel ──────────────────────────────────────────────────────────────

  scheduleSquirrel() {
    if (this.won || this.squirrelCount >= DISTRACTIONS_PER_LEVEL) return;
    this.squirrelTimer = this.time.delayedCall(
      Phaser.Math.Between(6000, 14000), this.launchSquirrel, [], this);
  }

  launchSquirrel() {
    if (this.won) return;
    this.squirrelCount++;
    const edge = Phaser.Math.Between(0, 3);
    const yL = YARD_X * CELL, yR = (YARD_X + YARD_COLS) * CELL;
    const yT = YARD_Y * CELL, yB = (YARD_Y + YARD_ROWS) * CELL;
    let x, y, dx, dy;
    if (edge === 0) { x = yL;  y = Phaser.Math.Between(yT + CELL, yB - CELL); dx =  1; dy =  0; }
    else if (edge === 1) { x = yR;  y = Phaser.Math.Between(yT + CELL, yB - CELL); dx = -1; dy =  0; }
    else if (edge === 2) { x = Phaser.Math.Between(yL + CELL, yR - CELL); y = yT;  dx =  0; dy =  1; }
    else                 { x = Phaser.Math.Between(yL + CELL, yR - CELL); y = yB;  dx =  0; dy = -1; }
    this.squirrel = { active: true, x, y, dx, dy };
  }

  updateSquirrel(dt) {
    if (!this.squirrel.active) return;
    const SQUIRREL_SPEED = 60;
    this.squirrel.x += this.squirrel.dx * SQUIRREL_SPEED * dt;
    this.squirrel.y += this.squirrel.dy * SQUIRREL_SPEED * dt;
    const yL = YARD_X * CELL - CELL * 2, yR = (YARD_X + YARD_COLS) * CELL + CELL * 2;
    const yT = YARD_Y * CELL - CELL * 2, yB = (YARD_Y + YARD_ROWS) * CELL + CELL * 2;
    if (this.squirrel.x < yL || this.squirrel.x > yR ||
        this.squirrel.y < yT || this.squirrel.y > yB) {
      this.squirrel.active = false;
      this.squirrelGfx.clear();
      this.scheduleSquirrel();
      return;
    }
    this.drawSquirrel();
  }

  drawSquirrel() {
    const g = this.squirrelGfx;
    g.clear();
    const { x, y, dx, dy } = this.squirrel;
    const bob = Math.floor(Date.now() / 80) % 2;
    const by  = y + bob;

    // Tail — opposite end from head, curls upward
    g.fillStyle(0xb36a30);
    if (dx > 0)       { g.fillRect(x-6, by-2, 4, 2); g.fillRect(x-6, by-5, 2, 4); g.fillRect(x-5, by-7, 3, 2); }
    else if (dx < 0)  { g.fillRect(x+2, by-2, 4, 2); g.fillRect(x+4, by-5, 2, 4); g.fillRect(x+2, by-7, 3, 2); }
    else if (dy > 0)  { g.fillRect(x+2, by-4, 2, 4); g.fillRect(x+3, by-6, 3, 2); g.fillRect(x+5, by-5, 2, 3); }
    else              { g.fillRect(x+2, by+1, 2, 4); g.fillRect(x+3, by+3, 3, 2); g.fillRect(x+5, by+1, 2, 3); }

    // Body
    g.fillStyle(0x7a4422);
    g.fillRect(x-3, by-2, 7, 4);

    // Head — in direction of travel
    g.fillStyle(0x9a6040);
    if (dx > 0)       g.fillRect(x+3,  by-4, 5, 4);
    else if (dx < 0)  g.fillRect(x-8,  by-4, 5, 4);
    else if (dy > 0)  g.fillRect(x-2,  by+2, 4, 5);
    else              g.fillRect(x-2,  by-7, 4, 5);

    // Ear
    g.fillStyle(0x5a3010);
    if (dx > 0)       g.fillRect(x+5,  by-6, 2, 2);
    else if (dx < 0)  g.fillRect(x-7,  by-6, 2, 2);
    else if (dy > 0)  g.fillRect(x-1,  by+6, 2, 2);
    else              g.fillRect(x-1,  by-9, 2, 2);

    // Eye
    g.fillStyle(0x111111);
    if (dx > 0)       g.fillRect(x+6,  by-3, 1, 1);
    else if (dx < 0)  g.fillRect(x-5,  by-3, 1, 1);
    else if (dy > 0)  g.fillRect(x+1,  by+5, 1, 1);
    else              g.fillRect(x+1,  by-6, 1, 1);
  }

  // ── Birds ─────────────────────────────────────────────────────────────────
  // Purely cosmetic, confined to the border margin (never cross into the
  // yard) — a small silhouette drifting along one edge every once in a
  // while, no collision, no per-level cap (unlike squirrels/former
  // sprinklers, these never interact with mowing at all).

  scheduleBird() {
    if (this.won) return;
    this.birdTimer = this.time.delayedCall(
      Phaser.Math.Between(15000, 30000), this.launchBird, [], this);
  }

  launchBird() {
    if (this.won) return;
    const marginX = YARD_X * CELL, marginY = YARD_Y * CELL;
    const strip = Phaser.Math.Between(0, 3); // 0=top, 1=bottom, 2=left, 3=right
    const forward = Phaser.Math.Between(0, 1) === 0;
    let x, y, dx, dy;
    if (strip === 0 || strip === 1) {
      y = strip === 0
        ? Phaser.Math.Between(6, marginY - 6)
        : Phaser.Math.Between(H - marginY + 6, H - 6);
      x  = forward ? -12 : W + 12;
      dx = forward ? 1 : -1;
      dy = 0;
    } else {
      x = strip === 2
        ? Phaser.Math.Between(6, marginX - 6)
        : Phaser.Math.Between(W - marginX + 6, W - 6);
      y  = forward ? -12 : H + 12;
      dy = forward ? 1 : -1;
      dx = 0;
    }
    this.bird = { active: true, x, y, dx, dy };
    playBirdChirp();
  }

  updateBird(dt) {
    if (!this.bird.active) return;
    const BIRD_SPEED = 70;
    this.bird.x += this.bird.dx * BIRD_SPEED * dt;
    this.bird.y += this.bird.dy * BIRD_SPEED * dt;
    if (this.bird.x < -20 || this.bird.x > W + 20 || this.bird.y < -20 || this.bird.y > H + 20) {
      this.bird.active = false;
      this.birdGfx.clear();
      this.scheduleBird();
      return;
    }
    this.drawBird();
  }

  drawBird() {
    const g = this.birdGfx;
    g.clear();
    const { x, y, dx, dy } = this.bird;
    // A gentle perpendicular flutter so the flight path isn't perfectly
    // straight, purely visual (doesn't affect the tracked x/y).
    const flutter = Math.sin(Date.now() / 200) * 3;
    const bx = x + (dy !== 0 ? flutter : 0);
    const by = y + (dx !== 0 ? flutter : 0);
    // Two-frame wing flap — a small silhouette, same shape regardless of
    // travel direction (a bird's wing-flap silhouette reads the same from
    // below no matter which way it's flying). Light color, not dark — a
    // dark silhouette barely shows up against the similarly-dark wild
    // grass border.
    const flapUp = Math.floor(Date.now() / 120) % 2 === 0;
    g.lineStyle(2, 0xf0f0e8, 0.95);
    if (flapUp) {
      g.lineBetween(bx - 5, by - 3, bx, by);
      g.lineBetween(bx, by, bx + 5, by - 3);
    } else {
      g.lineBetween(bx - 5, by + 1, bx, by);
      g.lineBetween(bx, by, bx + 5, by + 1);
    }
  }

  // ── Deer ──────────────────────────────────────────────────────────────────
  // Peeks partway out from the border trees on the left/right side, holds
  // for a moment, then retreats back out of view. Purely cosmetic, stays
  // within the border margin the whole time.

  scheduleDeer() {
    if (this.won) return;
    this.deerTimer = this.time.delayedCall(
      Phaser.Math.Between(20000, 40000), this.launchDeer, [], this);
  }

  launchDeer() {
    if (this.won) return;
    const onLeft = Phaser.Math.Between(0, 1) === 0;
    const y = Phaser.Math.Between(YARD_Y * CELL + 20, (YARD_Y + YARD_ROWS) * CELL - 20);
    this.deer = { active: true, onLeft, y, phase: 'peek', elapsed: 0, t: 0 };
  }

  updateDeer(dt) {
    if (!this.deer.active) return;
    const PEEK_MS = 900, HOLD_MS = 2200, RETREAT_MS = 900;
    this.deer.elapsed += dt * 1000;
    if (this.deer.phase === 'peek') {
      this.deer.t = Math.min(1, this.deer.elapsed / PEEK_MS);
      if (this.deer.elapsed >= PEEK_MS) { this.deer.phase = 'hold'; this.deer.elapsed = 0; }
    } else if (this.deer.phase === 'hold') {
      this.deer.t = 1;
      if (this.deer.elapsed >= HOLD_MS) { this.deer.phase = 'retreat'; this.deer.elapsed = 0; }
    } else {
      this.deer.t = Math.max(0, 1 - this.deer.elapsed / RETREAT_MS);
      if (this.deer.elapsed >= RETREAT_MS) {
        this.deer.active = false;
        this.deerGfx.clear();
        this.scheduleDeer();
        return;
      }
    }
    this.drawDeer();
  }

  drawDeer() {
    const g = this.deerGfx;
    g.clear();
    const { onLeft, y, t } = this.deer;
    // t=0 fully hidden off the canvas edge, t=1 peeking partway into the
    // border margin — never far enough to reach the yard itself.
    const peekDepth = 20;
    const baseX = onLeft ? -14 : W + 14;
    const x     = onLeft ? baseX + peekDepth * t : baseX - peekDepth * t;
    const headX = onLeft ? x + 6 : x - 6;

    // Same muted, background-scenery palette as bg_tree/bg_pine.
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(x, y + 10, 16, 4);
    g.fillStyle(0x4a3823);
    g.fillRect(x - 6, y - 4, 12, 10);
    g.fillStyle(0x5a4830);
    g.fillRect(headX - 3, y - 9, 7, 7);
    g.fillStyle(0x3a2c1a);
    g.fillRect(headX - 2, y - 11, 2, 3);
    g.fillRect(headX + 3, y - 11, 2, 3);
  }

  // ── Fox ───────────────────────────────────────────────────────────────────
  // Same peek/hold/retreat mechanic as the deer, independent timer, so
  // either or both can show up during a level. Rust-orange with a pale
  // tail tip to read distinctly from the deer's muted brown at a glance.

  scheduleFox() {
    if (this.won) return;
    this.foxTimer = this.time.delayedCall(
      Phaser.Math.Between(18000, 35000), this.launchFox, [], this);
  }

  launchFox() {
    if (this.won) return;
    const onLeft = Phaser.Math.Between(0, 1) === 0;
    const y = Phaser.Math.Between(YARD_Y * CELL + 20, (YARD_Y + YARD_ROWS) * CELL - 20);
    this.fox = { active: true, onLeft, y, phase: 'peek', elapsed: 0, t: 0 };
  }

  updateFox(dt) {
    if (!this.fox.active) return;
    const PEEK_MS = 800, HOLD_MS = 1800, RETREAT_MS = 800;
    this.fox.elapsed += dt * 1000;
    if (this.fox.phase === 'peek') {
      this.fox.t = Math.min(1, this.fox.elapsed / PEEK_MS);
      if (this.fox.elapsed >= PEEK_MS) { this.fox.phase = 'hold'; this.fox.elapsed = 0; }
    } else if (this.fox.phase === 'hold') {
      this.fox.t = 1;
      if (this.fox.elapsed >= HOLD_MS) { this.fox.phase = 'retreat'; this.fox.elapsed = 0; }
    } else {
      this.fox.t = Math.max(0, 1 - this.fox.elapsed / RETREAT_MS);
      if (this.fox.elapsed >= RETREAT_MS) {
        this.fox.active = false;
        this.foxGfx.clear();
        this.scheduleFox();
        return;
      }
    }
    this.drawFox();
  }

  drawFox() {
    const g = this.foxGfx;
    g.clear();
    const { onLeft, y, t } = this.fox;
    const peekDepth = 20;
    const baseX = onLeft ? -14 : W + 14;
    const x      = onLeft ? baseX + peekDepth * t : baseX - peekDepth * t;
    const headX  = onLeft ? x + 6 : x - 6;
    const tailX  = onLeft ? x - 7 : x + 7; // opposite end from head

    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(x, y + 9, 16, 4);
    // Bushy tail, opposite end from the head, with a pale tip
    g.fillStyle(0x9a5030);
    g.fillRect(tailX - 2, y - 2, 5, 6);
    g.fillStyle(0xe8ddc0);
    g.fillRect(tailX - 2, y - 4, 3, 3);
    // Body
    g.fillStyle(0xb3611f);
    g.fillRect(x - 6, y - 4, 12, 9);
    // Cream chest
    g.fillStyle(0xe8ddc0);
    g.fillRect(x - 2, y, 5, 5);
    // Head
    g.fillStyle(0xb3611f);
    g.fillRect(headX - 3, y - 9, 7, 7);
    // Ears, dark tips
    g.fillStyle(0x2a1810);
    g.fillRect(headX - 2, y - 12, 2, 3);
    g.fillRect(headX + 3, y - 12, 2, 3);
  }

  // ── Dog ───────────────────────────────────────────────────────────────────
  // Sits in the yard (not the border, unlike bird/deer/fox) for the whole
  // level. Reacts to proximity every frame rather than a scheduled timer:
  // when the player gets within TRIGGER_DIST it barks and scampers — a
  // short linear slide, not a teleport — to a spot picked away from the
  // player, then waits out a cooldown before it can be startled again.

  // Scans the level's plain-grass ('.') cells for ones at least minDistPx
  // from (avoidX, avoidY), in world pixel coordinates; returns a random
  // match's cell-center, or null if none qualify (used both for the dog's
  // initial spawn spot and each scamper destination).
  pickDogSpot(avoidX, avoidY, minDistPx) {
    const map = this.levelData.map;
    const candidates = [];
    for (let r = 0; r < YARD_ROWS; r++) {
      for (let c = 0; c < YARD_COLS; c++) {
        if (map[r][c] !== '.') continue;
        const x = (YARD_X + c) * CELL + CELL / 2;
        const y = (YARD_Y + r) * CELL + CELL / 2;
        if (Math.hypot(x - avoidX, y - avoidY) < minDistPx) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Phaser.Math.Between(0, candidates.length - 1)];
  }

  updateDog(dt) {
    // Speed-based (not a fixed duration) so a scamper to a near spot and a
    // far one both move at the same hurried-but-not-blurring pace — well
    // under the player's own 80px/s medium speed, so it reads as a quick
    // trot rather than a dash.
    const TRIGGER_DIST = 48, FLEE_SPEED = 55, COOLDOWN_MS = 1500;
    if (this.dog.state === 'idle') {
      if (this.dog.cooldownRemaining > 0) {
        this.dog.cooldownRemaining -= dt * 1000;
      } else {
        const dist = Math.hypot(this.player.x - this.dog.x, this.player.y - this.dog.y);
        if (dist < TRIGGER_DIST) {
          // Picked away from the player (not just the dog's own old spot)
          // so the new resting place can't immediately re-trigger a flee.
          const spot = this.pickDogSpot(this.player.x, this.player.y, 100);
          if (spot) {
            const fleeDist = Math.hypot(spot.x - this.dog.x, spot.y - this.dog.y);
            this.dog.state       = 'fleeing';
            this.dog.fleeFromX   = this.dog.x;
            this.dog.fleeFromY   = this.dog.y;
            this.dog.fleeToX     = spot.x;
            this.dog.fleeToY     = spot.y;
            this.dog.fleeElapsed = 0;
            this.dog.fleeMs      = Phaser.Math.Clamp(fleeDist / FLEE_SPEED * 1000, 400, 1400);
            playDogBark();
          }
        }
      }
    } else {
      this.dog.fleeElapsed += dt * 1000;
      const t = Math.min(1, this.dog.fleeElapsed / this.dog.fleeMs);
      const dx = this.dog.fleeToX - this.dog.fleeFromX;
      const dy = this.dog.fleeToY - this.dog.fleeFromY;
      const len = Math.hypot(dx, dy) || 1;
      // Small side-to-side wobble (perpendicular to the travel line, fading
      // out near the end) so the scamper reads as scurrying rather than a
      // dead-straight slide.
      const perpX  = -dy / len, perpY = dx / len;
      const wobble = Math.sin(t * Math.PI * 5) * 2 * (1 - t);
      this.dog.x = Phaser.Math.Linear(this.dog.fleeFromX, this.dog.fleeToX, t) + perpX * wobble;
      this.dog.y = Phaser.Math.Linear(this.dog.fleeFromY, this.dog.fleeToY, t) + perpY * wobble;
      if (t >= 1) {
        this.dog.state             = 'idle';
        this.dog.cooldownRemaining = COOLDOWN_MS;
      }
    }
    this.drawDog();
  }

  drawDog() {
    const g = this.dogGfx;
    g.clear();
    const x = Math.round(this.dog.x);
    const y = Math.round(this.dog.y);

    // Warm brown fur with a tan muzzle patch and dark ears/nose — a flat
    // near-black palette plus straight-up ears (the original look) read as
    // a rabbit rather than a dog, so the fix leans on color and floppy,
    // outward-drooping ears together rather than either alone.
    const FUR      = 0x6b4423;
    const FUR_DARK = 0x4a2f18;
    const MUZZLE   = 0xc79a5e;

    if (this.dog.state !== 'fleeing') {
      // Sitting: low, wide haunches with the chest/head held upright and
      // the tail curled in at the side — a distinctly "at rest" silhouette
      // rather than just the running pose standing still.
      g.fillStyle(0x000000, 0.25);
      g.fillEllipse(x, y + 6, 12, 3);
      g.fillStyle(FUR);
      g.fillEllipse(x, y + 2, 11, 8);  // haunches, low and wide
      g.fillRect(x - 3, y - 6, 6, 7);  // upright chest
      // Floppy ears drooping down from the sides of the head, angled
      // outward — the stick-straight-up rects this replaced were the main
      // "bunny ear" culprit.
      g.fillStyle(FUR_DARK);
      g.fillTriangle(x - 3, y - 10, x - 6, y - 5, x - 1, y - 7);
      g.fillTriangle(x + 2, y - 10, x + 5, y - 5, x + 0, y - 7);
      g.fillStyle(FUR);
      g.fillRect(x - 3, y - 10, 5, 5); // head, held up
      g.fillStyle(MUZZLE);
      g.fillRect(x - 2, y - 7, 3, 2);  // muzzle patch — breaks up the round
                                       // rabbit-head silhouette with a snout
      g.fillStyle(FUR_DARK);
      g.fillRect(x + 5, y + 3, 3, 3);  // tail, curled in at the side
      g.fillStyle(0x1a1208);
      g.fillRect(x - 1, y - 6, 1, 1);  // nose
      g.fillRect(x - 2, y - 9, 1, 1);  // eye
      return;
    }

    // Fleeing: low, stretched scamper pose facing the direction of travel
    // (same dx/dy-driven head placement the squirrel uses), with a quick
    // bob for a scurrying read.
    const dx  = this.dog.fleeToX - this.dog.fleeFromX;
    const dy  = this.dog.fleeToY - this.dog.fleeFromY;
    const bob = Math.floor(Date.now() / 70) % 2 === 1 ? -1 : 0;
    let hx, hy;
    if (Math.abs(dx) >= Math.abs(dy)) { hx = dx > 0 ? 5 : -5; hy = 0; }
    else                              { hx = 0; hy = dy > 0 ? 5 : -5; }

    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(x, y + 6, 12, 3);
    g.fillStyle(FUR);
    g.fillRect(x - 5, y - 2 + bob, 10, 6);              // stretched body
    g.fillRect(x + hx - 2, y + hy - 2 + bob, 5, 5);      // head, out front
    g.fillStyle(MUZZLE);
    // Muzzle patch offset toward the head's leading edge, direction-dependent
    if (Math.abs(dx) >= Math.abs(dy)) g.fillRect(x + hx + (dx > 0 ? 0 : -3), y + hy - 1 + bob, 3, 2);
    else                              g.fillRect(x + hx - 1, y + hy + (dy > 0 ? 0 : -3) + bob, 2, 3);
    g.fillStyle(FUR_DARK);
    g.fillRect(x - hx - 1, y - hy - 1 + bob, 3, 2);      // tail, trailing behind
    g.fillStyle(0x1a1208);
    g.fillRect(x + hx - 1, y + hy - 1 + bob, 1, 1);      // eye
  }

  updateHUD() {
    const pct = this.mowedCount / this.totalCells;
    this.pctEl.textContent = Math.floor(pct * 100) + '%';
    if (pct * 100 >= WIN_PCT && !this.won) {
      this.won = true;
      setHumActive(false);
      this.showWin();
    }
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_, delta) {
    if (this.won || !this.started) return;

    const dt = delta / 1000;
    const c  = this.cursors;
    const w  = this.wasd;

    let dx = 0, dy = 0;
    if (c.left.isDown  || w.A.isDown) dx -= 1;
    if (c.right.isDown || w.D.isDown) dx += 1;
    if (c.up.isDown    || w.W.isDown) dy -= 1;
    if (c.down.isDown  || w.S.isDown) dy += 1;
    if (this.joystick.active) { dx += this.joystick.dx; dy += this.joystick.dy; }
    if (this.dpad.left)  dx -= 1;
    if (this.dpad.right) dx += 1;
    if (this.dpad.up)    dy -= 1;
    if (this.dpad.down)  dy += 1;

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) { dx /= len; dy /= len; }

    const minX = YARD_X * CELL + 1;
    const maxX = (YARD_X + YARD_COLS) * CELL - 2;
    const minY = YARD_Y * CELL + 1;
    const maxY = (YARD_Y + YARD_ROWS) * CELL - 2;

    const spd = SPEED_VALS[this.speedStep - 1];
    const nx = Phaser.Math.Clamp(this.player.x + dx * spd * dt, minX, maxX);
    const ny = Phaser.Math.Clamp(this.player.y + dy * spd * dt, minY, maxY);

    if (!this.isObstacle(nx, ny)) {
      this.player.x = nx;
      this.player.y = ny;
    } else if (!this.isObstacle(nx, this.player.y)) {
      this.player.x = nx;
    } else if (!this.isObstacle(this.player.x, ny)) {
      this.player.y = ny;
    }

    const isMoving = Math.abs(dx) > 0 || Math.abs(dy) > 0;
    if (isMoving) {
      if (Math.abs(dx) >= Math.abs(dy))
        this.player.dir = dx > 0 ? 'right' : 'left';
      else
        this.player.dir = dy > 0 ? 'down' : 'up';
    }
    setHumActive(isMoving);

    this.mowAt(this.player.x, this.player.y);
    this.drawPlayer();
    this.updateSquirrel(dt);
    this.updateBird(dt);
    this.updateDeer(dt);
    this.updateFox(dt);
    this.updateDog(dt);
    this.drawJoystick();
  }
}

// ─── Responsive layout (portrait mobile only) ─────────────────────────────────
// #game-container needs an explicit height matching the grown canvas (see
// computeYardRows) so it doesn't just stretch to fill the whole body —
// that's what #controls-spacer in index.html reserves room for the D-pad.
// Runs once at load; the grid size doesn't live-recompute on resize/rotate.
function applyResponsiveLayout() {
  const isPortraitTouch = window.matchMedia(
    '(hover: none) and (pointer: coarse) and (orientation: portrait)'
  ).matches;
  if (isPortraitTouch) {
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) gameContainer.style.aspectRatio = `${W} / ${H}`;
  }

  const uiCanvas = document.getElementById('ui-canvas');
  if (uiCanvas) {
    uiCanvas.style.width  = W + 'px';
    uiCanvas.style.height = H + 'px';
  }
}
applyResponsiveLayout();

// ─── Boot ────────────────────────────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  pixelArt: true,
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    // Horizontal-only centering: when #game-container has vertical slack
    // (mobile portrait, after #controls-spacer eats into it), this pins the
    // canvas to the top instead of splitting the gap above and below it —
    // one contiguous control area at the bottom beats two dead strips.
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
    parent: 'game-container',
  },
  input: { activePointers: 3 },
  scene: [BootScene, GameScene],
});

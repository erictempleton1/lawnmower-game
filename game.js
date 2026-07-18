// ─── Constants ───────────────────────────────────────────────────────────────
const CELL = 16;
const YARD_X = 3;
const YARD_Y = 3;
const BASE_YARD_COLS = 18;   // authored level width  (levels/level-0N.json)
const BASE_YARD_ROWS = 12;   // authored level height
const MAX_YARD_COLS  = 40;   // safety ceiling — not expected to bind on any real device
const MAX_YARD_ROWS  = 30;

// Estimated height reserved for the mobile D-pad below the canvas in
// portrait mode (see #controls-spacer in index.html, sized dynamically via
// flexbox) — used here only to pick a good yard aspect ratio up front.
const CONTROL_RESERVE_PX = 210;

// The yard is authored as an 18×12 (~4:3) grid, which doesn't match most
// phone screens. Rather than always letterboxing that fixed shape, grow
// whichever dimension (columns for wide screens, rows for tall ones) makes
// the yard's aspect ratio match the actual viewport — the extra space is
// plain grass padded around the level's authored layout (see normalizeMap),
// so trees/gardens keep their original relative position, just with more
// lawn to mow around them.
function computeYardSize() {
  const isPortraitTouch = window.matchMedia(
    '(hover: none) and (pointer: coarse) and (orientation: portrait)'
  ).matches;
  const availW = window.innerWidth;
  const availH = isPortraitTouch
    ? window.innerHeight - CONTROL_RESERVE_PX
    : window.innerHeight;

  const baseAspect  = (BASE_YARD_COLS + YARD_X * 2) / (BASE_YARD_ROWS + YARD_Y * 2);
  const availAspect = availW / Math.max(availH, 1);

  let yardCols = BASE_YARD_COLS;
  let yardRows = BASE_YARD_ROWS;
  if (availAspect > baseAspect) {
    yardCols = Math.round(availAspect * (BASE_YARD_ROWS + YARD_Y * 2)) - YARD_X * 2;
  } else {
    yardRows = Math.round((BASE_YARD_COLS + YARD_X * 2) / availAspect) - YARD_Y * 2;
  }
  return {
    yardCols: Phaser.Math.Clamp(yardCols, BASE_YARD_COLS, MAX_YARD_COLS),
    yardRows: Phaser.Math.Clamp(yardRows, BASE_YARD_ROWS, MAX_YARD_ROWS),
  };
}

const { yardCols: YARD_COLS, yardRows: YARD_ROWS } = computeYardSize();
const COLS = YARD_COLS + YARD_X * 2;
const ROWS = YARD_ROWS + YARD_Y * 2;
const W = COLS * CELL;
const H = ROWS * CELL;
const WIN_PCT   = 100;
const SPEED_VALS = [45, 80, 130]; // turtle / medium / rabbit

// Lever layout — right border strip
const LEVER_X     = (YARD_X + YARD_COLS) * CELL + 30; // deck lever
const SPD_LEVER_X = (YARD_X + YARD_COLS) * CELL + 10; // speed lever
const LEVER_PNL   = { x: (YARD_X + YARD_COLS) * CELL + 4, y: 68, w: 40, h: 212 };
const NOTCH_Y     = { 3: 112, 2: 188, 1: 264 };
const SPEED_COLORS = [0x4477dd, 0x44aa77, 0xdd6633]; // turtle/medium/rabbit

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

// Persist across scene restarts
let g_distractionsEnabled = true;
let g_speedStep         = 2;

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
    this.sprinklerCount   = 0;
    this.sprinklerTimer   = null;
    this.activeSprinkler  = null;
    this.bladeOff       = false;
    this.speedStep      = g_speedStep;
    this.squirrel       = { active: false };
    this.squirrelCount  = 0;

    this.buildMowedTextures();
    this.buildBackground();
    this.buildMowedLayer();
    this.buildObstacleLayer();

    this.totalCells    = YARD_ROWS * YARD_COLS;
    this.sprinklerGfx  = this.add.graphics();
    this.sprinklerGfx.setDepth(4);

    this.setupPlayer();
    this.setupInput();
    this.buildHUD();
    this.buildLever();
    this.buildWinOverlay();
    this.syncUIOverlay();
    this.scale.on('resize', this.syncUIOverlay, this);

    this.squirrelGfx = this.add.graphics();
    this.squirrelGfx.setDepth(4);

    this.mowAt(this.player.x, this.player.y);
    this.scheduleSprinkler();
    this.scheduleSquirrel();

    document.getElementById('loading-screen')?.classList.add('hidden');
  }

  // ── Textures ─────────────────────────────────────────────────────────────

  buildMowedTextures() {
    for (let h = 1; h <= 3; h++) {
      const { base, stripe } = DECK[h - 1];
      const g = this.make.graphics({ add: false });
      g.fillStyle(base);
      g.fillRect(0, 0, CELL, CELL);
      g.fillStyle(stripe, 0.5);
      g.fillRect(2, 0, 3, CELL);
      g.fillRect(10, 0, 2, CELL);
      g.lineStyle(1, 0x000000, 0.05);
      g.strokeRect(0, 0, CELL, CELL);
      g.generateTexture('mowed_' + h, CELL, CELL);
      g.destroy();
    }
  }

  buildLevelTextures() {
    const S = CELL * 2; // 32px — fits a 2×2 cell block

    // Tree — 32×32 pixel art
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
    tg.generateTexture('tree', S, S);
    tg.destroy();

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
    const g = this.make.graphics({ add: false });

    g.fillStyle(C.border);
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

    const rt = this.add.renderTexture(0, 0, W, H);
    rt.setOrigin(0, 0);
    rt.draw(g, 0, 0);
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

    // Gardens: all cells grid-blocked.
    // Trees: no grid blocking — trunk uses pixel-radius collision so the mower
    // can enter and mow the cell but can't pass through the trunk post.
    for (let r = 0; r < YARD_ROWS; r++)
      for (let c = 0; c < YARD_COLS; c++)
        if (map[r][c] === 'G') this.obstacleGrid[r][c] = 1;

    this.trunkPositions = [];

    this.obstacleRT = this.add.renderTexture(0, 0, W, H);
    this.obstacleRT.setOrigin(0, 0);
    this.obstacleRT.setDepth(3);

    for (let r = 0; r < YARD_ROWS; r++) {
      for (let c = 0; c < YARD_COLS; c++) {
        const type = map[r][c];
        if (type !== 'T' && type !== 'G') continue;

        // Only process from the top-left corner of each contiguous cluster
        const aboveSame = r > 0 && map[r - 1][c] === type;
        const leftSame  = c > 0 && map[r][c - 1] === type;
        if (aboveSame || leftSame) continue;

        // Measure cluster width and height
        let cw = 1, cH = 1;
        while (c + cw < YARD_COLS && map[r][c + cw] === type) cw++;
        while (r + cH < YARD_ROWS && map[r + cH] && map[r + cH][c] === type) cH++;

        if (type === 'G') {
          // Gardens: auto-mow when all perimeter cells are mowed
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

        // Stamp one 32×32 texture per 2×2 sub-block within the cluster
        const key = type === 'T' ? 'tree' : 'garden';
        for (let dr = 0; dr < cH; dr += 2) {
          for (let dc = 0; dc < cw; dc += 2) {
            const tx = (YARD_X + c + dc) * CELL + CELL;
            const ty = (YARD_Y + r + dr) * CELL + CELL;
            this.obstacleRT.stamp(key, null, tx, ty);
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
    if (this.obstacleGrid[gr][gc] === 1) return true;
    for (const { wx, wy } of this.trunkPositions) {
      const ddx = px - wx, ddy = py - wy;
      if (ddx * ddx + ddy * ddy < 36) return true; // 6px radius around trunk
    }
    if (this.activeSprinkler) {
      const { r, c } = this.activeSprinkler;
      if (gr >= r && gr < r + 2 && gc >= c && gc < c + 2) return true;
    }
    if (this.squirrel.active) {
      const sqc = Math.floor((this.squirrel.x - YARD_X * CELL) / CELL);
      const sqr = Math.floor((this.squirrel.y - YARD_Y * CELL) / CELL);
      if (gc === sqc && gr === sqr) return true;
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
        const next = (this.currentLevel + 1) % this.allLevels.length;
        this.hideWin();
        this.scene.restart({ levels: this.allLevels, level: next });
        return;
      }
      if (p.x > (YARD_X + YARD_COLS) * CELL) {
        if (p.y >= 25 && p.y < 43) {
          this.toggleBlade();
        } else if (p.y >= 45 && p.y < 63) {
          this.toggleDistractions();
        } else if (p.x < (SPD_LEVER_X + LEVER_X) / 2) {
          // Speed lever tap — snap to closest notch
          let bestS = this.speedStep, bestDist = Infinity;
          for (let s = 1; s <= 3; s++) {
            const d = Math.abs(p.y - NOTCH_Y[s]);
            if (d < bestDist) { bestDist = d; bestS = s; }
          }
          this.setSpeed(bestS);
        } else {
          // Deck lever tap — snap to closest notch
          let bestH = this.deckHeight, bestDist = Infinity;
          for (let h = 1; h <= 3; h++) {
            const d = Math.abs(p.y - NOTCH_Y[h]);
            if (d < bestDist) { bestDist = d; bestH = h; }
          }
          this.setDeckHeight(bestH);
        }
      } else if (!this.isTouchDevice && p.x < W * 0.65) {
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
      if (this.won) {
        const next = (this.currentLevel + 1) % this.allLevels.length;
        this.hideWin();
        this.scene.restart({ levels: this.allLevels, level: next });
      }
    });
    this.input.keyboard.on('keydown-B', () => this.toggleBlade());
    this.input.keyboard.on('keydown-ONE',   () => this.setDeckHeight(1));
    this.input.keyboard.on('keydown-TWO',   () => this.setDeckHeight(2));
    this.input.keyboard.on('keydown-THREE', () => this.setDeckHeight(3));
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

  // ── Lever UI ──────────────────────────────────────────────────────────────

  buildLever() {
    this.leverGfx  = this.add.graphics();
    this.leverGfx.setDepth(10);
    this.notchEls  = {
      1: document.getElementById('notch-1'),
      2: document.getElementById('notch-2'),
      3: document.getElementById('notch-3'),
    };
    this.bladeEl  = document.getElementById('blade-val');
    this.distEl  = document.getElementById('dist-val');
    this.drawLever();
  }

  setDeckHeight(h) {
    this.deckHeight = h;
    this.drawLever();
  }

  setSpeed(s) {
    this.speedStep = s;
    g_speedStep    = s;
    this.drawLever();
  }

  toggleBlade() {
    this.bladeOff = !this.bladeOff;
    this.drawLever();
  }

  toggleDistractions() {
    g_distractionsEnabled = !g_distractionsEnabled;
    if (!g_distractionsEnabled) {
      if (this.sprinklerTimer) { this.sprinklerTimer.remove(); this.sprinklerTimer = null; }
      if (this.squirrelTimer)  { this.squirrelTimer.remove();  this.squirrelTimer  = null; }

    } else {
      this.scheduleSprinkler();
      this.scheduleSquirrel();
    }
    this.drawLever();
  }

  drawLever() {
    const g  = this.leverGfx;
    g.clear();
    const p  = LEVER_PNL;
    const lx = LEVER_X;
    const sx = SPD_LEVER_X;

    g.fillStyle(0x1a1a1a, 0.88);
    g.fillRect(p.x, p.y, p.w, p.h);
    g.lineStyle(1, 0x444444);
    g.strokeRect(p.x, p.y, p.w, p.h);

    // ── Deck rail + notches ───────────────────────────────────────────────
    g.lineStyle(2, 0x444444);
    g.lineBetween(lx, NOTCH_Y[3] - 6, lx, NOTCH_Y[1] + 6);
    g.lineStyle(1, 0x222222);
    g.lineBetween(lx - 1, NOTCH_Y[3] - 5, lx - 1, NOTCH_Y[1] + 5);

    for (let h = 1; h <= 3; h++) {
      const active = this.deckHeight === h;
      g.lineStyle(1, active ? 0xdddddd : 0x555555);
      g.lineBetween(lx - 4, NOTCH_Y[h], lx + 4, NOTCH_Y[h]);
      if (this.notchEls)
        this.notchEls[h].style.color = active ? '#ffffff' : '#555555';
    }

    // Deck knob
    const hy = NOTCH_Y[this.deckHeight];
    const bc = DECK[this.deckHeight - 1].base;
    g.fillStyle(0x000000, 0.5);
    g.fillRect(lx - 9, hy - 3, 18, 9);
    g.fillStyle(bc);
    g.fillRect(lx - 8, hy - 4, 16, 8);
    g.fillStyle(0xffffff, 0.25);
    g.fillRect(lx - 8, hy - 4, 16, 2);
    g.fillStyle(0x000000, 0.3);
    for (let i = -2; i <= 2; i += 2)
      g.fillRect(lx + i, hy - 2, 1, 4);

    // ── Speed rail + notches ──────────────────────────────────────────────
    g.lineStyle(2, 0x444444);
    g.lineBetween(sx, NOTCH_Y[3] - 6, sx, NOTCH_Y[1] + 6);
    g.lineStyle(1, 0x222222);
    g.lineBetween(sx - 1, NOTCH_Y[3] - 5, sx - 1, NOTCH_Y[1] + 5);

    for (let s = 1; s <= 3; s++) {
      const active = this.speedStep === s;
      g.lineStyle(1, active ? 0xdddddd : 0x555555);
      g.lineBetween(sx - 4, NOTCH_Y[s], sx + 4, NOTCH_Y[s]);
    }

    // Speed knob
    const sy  = NOTCH_Y[this.speedStep];
    const sc  = SPEED_COLORS[this.speedStep - 1];
    g.fillStyle(0x000000, 0.5);
    g.fillRect(sx - 7, sy - 3, 14, 9);
    g.fillStyle(sc);
    g.fillRect(sx - 6, sy - 4, 12, 8);
    g.fillStyle(0xffffff, 0.25);
    g.fillRect(sx - 6, sy - 4, 12, 2);

    // ── Speed indicator rect: bottom = turtle, none = medium, top = rabbit ─
    if (this.speedStep !== 2) {
      const indX = p.x + 3;
      const indW = p.w - 6;
      const indY = this.speedStep === 1 ? p.y + p.h - 12 : p.y + 4;
      g.fillStyle(sc);
      g.fillRect(indX, indY, indW, 8);
      g.fillStyle(0xffffff, 0.2);
      g.fillRect(indX, indY, indW, 2);
      g.lineStyle(1, 0x333333);
      g.strokeRect(indX, indY, indW, 8);
    }

    // Toggle buttons above deck panel
    const TH = 18, TX = p.x;
    const T1Y = 25, T2Y = 45;

    g.fillStyle(0x1a1a1a, 0.88);
    g.fillRect(TX, T1Y, p.w, TH);
    g.lineStyle(1, this.bladeOff ? 0x664400 : 0x2a6a2a);
    g.strokeRect(TX, T1Y, p.w, TH);

    g.fillStyle(0x1a1a1a, 0.88);
    g.fillRect(TX, T2Y, p.w, TH);
    g.lineStyle(1, g_distractionsEnabled ? 0x2a6a2a : 0x444444);
    g.strokeRect(TX, T2Y, p.w, TH);

    if (this.bladeEl) {
      this.bladeEl.textContent = this.bladeOff ? 'OFF' : 'ON';
      this.bladeEl.style.color = this.bladeOff ? '#cc7722' : '#66dd44';
    }
    if (this.distEl) {
      this.distEl.textContent = g_distractionsEnabled ? 'ON' : 'OFF';
      this.distEl.style.color = g_distractionsEnabled ? '#66dd44' : '#666666';
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  buildHUD() {
    this.add.rectangle(W / 2, 8, W - 16, 14, 0x000000, 0.7).setOrigin(0.5, 0).setDepth(10);
    this.barBg = this.add.rectangle(58, 11, W - 110, 8, 0x333333).setOrigin(0, 0.5).setDepth(10);
    this.bar   = this.add.rectangle(58, 11, 0, 8, 0x66dd22).setOrigin(0, 0.5).setDepth(10);
    this.barW  = W - 110;

    // Text lives in the HTML overlay — just grab refs
    document.getElementById('hud-level').textContent = `L${this.currentLevel + 1}`;
    this.pctEl = document.getElementById('hud-pct');
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
    this.events.on('shutdown', () => {
      this.hideWin();
      this.scale.off('resize', this.syncUIOverlay, this);
      if (this.sprinklerTimer) this.sprinklerTimer.remove();
      if (this.squirrelTimer)  this.squirrelTimer.remove();
      this.squirrelGfx?.clear();
    });
  }

  showWin() {
    const isLast = this.currentLevel >= this.allLevels.length - 1;
    this.winNextEl.textContent   = isLast ? 'All levels complete!' : `Up next: ${this.allLevels[this.currentLevel + 1].name}`;
    this.winActionEl.textContent = isLast ? 'Tap or press R to restart from L1' : 'Tap or press R for next level';
    this.winEl.classList.add('visible');
  }

  hideWin() {
    this.winEl.classList.remove('visible');
  }

  // ── Mowing ────────────────────────────────────────────────────────────────

  mowAt(px, py) {
    if (this.bladeOff) return;
    const gc = Math.floor((px - YARD_X * CELL) / CELL);
    const gr = Math.floor((py - YARD_Y * CELL) / CELL);
    if (gc < 0 || gc >= YARD_COLS || gr < 0 || gr >= YARD_ROWS) return;
    if (this.obstacleGrid[gr][gc]) return;
    if (this.activeSprinkler) {
      const { r, c } = this.activeSprinkler;
      if (gr >= r && gr < r + 2 && gc >= c && gc < c + 2) return;
    }
    if (this.squirrel.active) {
      const sqc = Math.floor((this.squirrel.x - YARD_X * CELL) / CELL);
      const sqr = Math.floor((this.squirrel.y - YARD_Y * CELL) / CELL);
      if (gc === sqc && gr === sqr) return;
    }

    const cellH = this.grid[gr][gc];
    if (cellH !== 0 && this.deckHeight >= cellH) return;

    const firstMow = cellH === 0;
    this.grid[gr][gc] = this.deckHeight;
    if (firstMow) this.mowedCount++;

    const cx = (YARD_X + gc) * CELL + CELL / 2;
    const cy = (YARD_Y + gr) * CELL + CELL / 2;
    this.mowedRT.stamp('mowed_' + this.deckHeight, null, cx, cy);
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
        this.mowedRT.stamp('mowed_2', null, cx, cy);
      }
      this.mowedRT.render();
    }
  }

  // ── Sprinkler ─────────────────────────────────────────────────────────────

  scheduleSprinkler() {
    if (!g_distractionsEnabled || this.sprinklerCount >= this.currentLevel + 1 || this.won) return;
    const pct         = this.mowedCount / this.totalCells;
    const speedFactor = 1 + (2 - this.speedStep) * 0.35; // 1.35 turtle → 1.0 mid → 0.65 rabbit
    const delay = (Phaser.Math.Between(3000, 6000)
                 + 12000 * (1 - pct)
                 + 2000  * this.currentLevel) * speedFactor;
    this.sprinklerTimer = this.time.delayedCall(delay, this.popSprinkler, [], this);
  }

  popSprinkler() {
    if (this.won || !g_distractionsEnabled) return;
    const pos = this.findSprinklerPos();
    if (!pos) { this.scheduleSprinkler(); return; }

    this.sprinklerCount++;
    const { r, c } = pos;
    this.activeSprinkler = { r, c };
    const wx = (YARD_X + c) * CELL + CELL;
    const wy = (YARD_Y + r) * CELL + CELL;
    this.animateSprinkler(wx, wy, r, c);
  }

  findSprinklerPos() {
    const pgc = Math.floor((this.player.x - YARD_X * CELL) / CELL);
    const pgr = Math.floor((this.player.y - YARD_Y * CELL) / CELL);
    const candidates = [];
    for (let r = 0; r <= YARD_ROWS - 2; r++) {
      for (let c = 0; c <= YARD_COLS - 2; c++) {
        let valid = true, hasMowed = true;
        if (pgr >= r && pgr < r + 2 && pgc >= c && pgc < c + 2) valid = false;
        if (valid) outer: for (let dr = 0; dr < 2; dr++) {
          for (let dc = 0; dc < 2; dc++) {
            if (this.obstacleGrid[r + dr][c + dc]) { valid = false; break outer; }
            if (this.grid[r + dr][c + dc] === 0) hasMowed = false;
          }
        }
        if (valid && hasMowed) candidates.push({ r, c });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Phaser.Math.Between(0, candidates.length - 1)];
  }

  rebuildMowedRT() {
    this.mowedRT.clear();
    for (let r = 0; r < YARD_ROWS; r++) {
      for (let c = 0; c < YARD_COLS; c++) {
        const h = this.grid[r][c];
        if (h === 0) continue;
        const cx = (YARD_X + c) * CELL + CELL / 2;
        const cy = (YARD_Y + r) * CELL + CELL / 2;
        this.mowedRT.stamp('mowed_' + h, null, cx, cy);
      }
    }
    this.mowedRT.render();
  }

  animateSprinkler(wx, wy, gr, gc) {
    const RISE    = 400;
    const SPRAY   = 2000;
    const RETRACT = 400;
    const TOTAL   = RISE + SPRAY + RETRACT;
    const MAX_H   = 14;
    let elapsed   = 0;
    let angle     = 0;
    let reverted  = false;
    const gfx     = this.sprinklerGfx;

    const ev = this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        elapsed += 16;
        gfx.clear();

        let stemH, spraying;
        if (elapsed < RISE) {
          stemH    = MAX_H * (elapsed / RISE);
          spraying = false;
        } else if (elapsed < RISE + SPRAY) {
          stemH    = MAX_H;
          spraying = true;
          angle   += 0.08;
        } else {
          // Revert grass exactly once at the spray→retract boundary
          if (!reverted) {
            reverted = true;
            for (let dr = 0; dr < 2; dr++) {
              for (let dc = 0; dc < 2; dc++) {
                if (this.grid[gr + dr][gc + dc] !== 0) {
                  this.grid[gr + dr][gc + dc] = 0;
                  this.mowedCount = Math.max(0, this.mowedCount - 1);
                }
              }
            }
            this.rebuildMowedRT();
            this.updateHUD();
          }
          stemH    = MAX_H * Math.max(0, 1 - (elapsed - RISE - SPRAY) / RETRACT);
          spraying = false;
        }

        // Stem
        gfx.fillStyle(0x999999);
        gfx.fillRect(wx - 2, wy - stemH, 4, stemH);
        // Head
        gfx.fillStyle(0xcccccc);
        gfx.fillCircle(wx, wy - stemH, 3);

        if (spraying) {
          for (let i = 0; i < 4; i++) {
            const a = angle + (i * Math.PI / 2);
            const tx = wx + Math.cos(a) * 20;
            const ty = wy - stemH - 6 + Math.sin(a) * 8;
            gfx.lineStyle(1, 0x66bbff, 0.85);
            gfx.lineBetween(wx, wy - stemH, tx, ty);
            gfx.fillStyle(0x66bbff, 0.7);
            gfx.fillCircle(tx, ty, 1.5);
          }
        }

        if (elapsed >= TOTAL) {
          ev.remove();
          gfx.clear();
          this.activeSprinkler = null;
          this.scheduleSprinkler();
        }
      }
    });
  }

  // ── Squirrel ──────────────────────────────────────────────────────────────

  scheduleSquirrel() {
    if (!g_distractionsEnabled || this.won || this.squirrelCount >= this.currentLevel + 1) return;
    this.squirrelTimer = this.time.delayedCall(
      Phaser.Math.Between(6000, 14000), this.launchSquirrel, [], this);
  }

  launchSquirrel() {
    if (this.won || !g_distractionsEnabled) return;
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

  updateHUD() {
    const pct = this.mowedCount / this.totalCells;
    this.bar.width = this.barW * pct;
    this.pctEl.textContent = Math.floor(pct * 100) + '%';
    if (pct * 100 >= WIN_PCT && !this.won) {
      this.won = true;
      this.showWin();
    }
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_, delta) {
    if (this.won) return;

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

    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      if (Math.abs(dx) >= Math.abs(dy))
        this.player.dir = dx > 0 ? 'right' : 'left';
      else
        this.player.dir = dy > 0 ? 'down' : 'up';
    }

    this.mowAt(this.player.x, this.player.y);
    this.drawPlayer();
    this.updateSquirrel(dt);
    this.drawJoystick();
  }
}

// ─── Responsive DOM layout ────────────────────────────────────────────────────
// Applies the computed W/H to the DOM pieces that assume a fixed canvas size,
// since YARD_COLS/YARD_ROWS (and so W/H) now vary per device. Runs once at
// load — the grid size doesn't live-recompute on resize/rotate.
function applyResponsiveLayout() {
  const isPortraitTouch = window.matchMedia(
    '(hover: none) and (pointer: coarse) and (orientation: portrait)'
  ).matches;

  // Only in portrait does #game-container need pinning to the canvas's exact
  // rendered height (see index.html) — landscape/desktop already fill the
  // window via flex:1, and the computed W/H is chosen to closely match it.
  if (isPortraitTouch) {
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) gameContainer.style.aspectRatio = `${W} / ${H}`;
  }

  const uiCanvas = document.getElementById('ui-canvas');
  if (uiCanvas) {
    uiCanvas.style.width  = W + 'px';
    uiCanvas.style.height = H + 'px';
  }

  // The lever/toggle labels dock to the right border strip, which shifts
  // right when YARD_COLS grows (wide/landscape screens) — reposition them
  // to match instead of leaving them at their authored 18-column offsets.
  const setLeft = (id, px) => {
    const el = document.getElementById(id);
    if (el) el.style.left = px + 'px';
  };
  setLeft('deck-label',    LEVER_X + 2);
  setLeft('notch-3',       LEVER_X - 8);
  setLeft('notch-2',       LEVER_X - 8);
  setLeft('notch-1',       LEVER_X - 8);
  setLeft('speed-label',   SPD_LEVER_X + 2);
  setLeft('speed-rabbit',  SPD_LEVER_X + 2);
  setLeft('speed-turtle',  SPD_LEVER_X + 2);
  setLeft('toggle-blade',  LEVER_PNL.x);
  setLeft('toggle-sprink', LEVER_PNL.x);
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

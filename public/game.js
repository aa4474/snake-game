'use strict';
// ================================================================
//  SERPENTINE — Ultimate Snake Game Engine
//  GitHub: aa4474/snake-game
// ================================================================

// ── Server URL ────────────────────────────────────────────────────
// ⚠️ Update this AFTER deploying server to Render.com
// Find your URL in Render dashboard → Service → top URL bar
const SERVER_URL = 'wss://snake-game-server-f6yi.onrender.com';

// ── Grid Config ───────────────────────────────────────────────────
const GRID   = 25;
const CELL   = 24;
const W      = GRID * CELL; // 600
const H      = GRID * CELL; // 600
const BASE_SPEED = 150; // ms per tick

// ── Skins ─────────────────────────────────────────────────────────
const SKINS = [
  { name: 'Neon',    head: '#00ff88', body: '#00aa55', glow: '#00ff88', eye: '#ffffff', trail: 'rgba(0,255,136,0.3)' },
  { name: 'Classic', head: '#5cb85c', body: '#2d7a2d', glow: '#66bb6a', eye: '#ffffff', trail: 'rgba(92,184,92,0.3)' },
  { name: 'Fire',    head: '#ff6600', body: '#bb2200', glow: '#ff4400', eye: '#ffffff', trail: 'rgba(255,102,0,0.3)' },
  { name: 'Ice',     head: '#00e5ff', body: '#0077aa', glow: '#00e5ff', eye: '#000000', trail: 'rgba(0,229,255,0.3)' },
  { name: 'Galaxy',  head: '#ce93d8', body: '#7b1fa2', glow: '#e040fb', eye: '#ffffff', trail: 'rgba(206,147,216,0.3)' },
  { name: 'Gold',    head: '#ffd700', body: '#cc7700', glow: '#ffd700', eye: '#000000', trail: 'rgba(255,215,0,0.3)' },
];

// ── Power-up Definitions ──────────────────────────────────────────
const POWERUP_DEFS = {
  SPEED:      { name: 'Speed Boost',   icon: '⚡', color: '#ffeb3b', duration: 6000 },
  SHIELD:     { name: 'Shield',        icon: '🛡', color: '#2196F3', duration: 0 },
  GHOST:      { name: 'Ghost Mode',    icon: '👻', color: '#9c27b0', duration: 5000 },
  SLOWMO:     { name: 'Slow-Mo',       icon: '🐌', color: '#00bcd4', duration: 5000 },
  MULTIPLIER: { name: '2× Score',      icon: '✨', color: '#ff9800', duration: 8000 },
  SHRINK:     { name: 'Shrink Ray',    icon: '🔫', color: '#f44336', duration: 0 },
  BOMB:       { name: 'Area Bomb',     icon: '💣', color: '#78909c', duration: 0 },
};

// ── Mode Labels ────────────────────────────────────────────────────
const MODE_LABELS = {
  classic:    '🏆 CLASSIC',
  speed_rush: '⚡ SPEED RUSH',
  portal:     '🌀 PORTAL',
  time_attack:'⏱ TIME ATTACK',
  versus:     '⚔️ VERSUS',
  coop:       '🤝 CO-OP',
  chaos:      '🔮 CHAOS',
};

// ── Tips ──────────────────────────────────────────────────────────
const TIPS = [
  'Use WASD or Arrow Keys to move',
  'Power-ups spawn every 8 seconds!',
  'In Versus mode: first to 5 kills wins',
  'Golden food is worth 5× more points',
  'Ghost mode lets you pass through yourself',
  'Shield absorbs one fatal collision',
  'Chain food for combo multipliers!',
  'In Portal mode, walk into walls to teleport',
  'In Chaos mode, expect the unexpected…',
  'Speed Rush gets faster every 10 seconds!',
];

// ================================================================
//  AUDIO ENGINE  (Web Audio API — no files needed)
// ================================================================
class AudioEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.volume = 0.18;
    this._initCtx();
  }

  _initCtx() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.enabled = false;
    }
  }

  _play(freq, type, start, duration, gain, freqEnd = null) {
    if (!this.enabled || !this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const osc  = this.ctx.createOscillator();
      const amp  = this.ctx.createGain();
      osc.connect(amp);
      amp.connect(this.ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration);
      amp.gain.setValueAtTime(gain * this.volume, start);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.start(start);
      osc.stop(start + duration + 0.01);
    } catch {}
  }

  eat()     { const t = this.ctx?.currentTime || 0; this._play(440,'square',t,0.07,0.6,880); }
  death()   { const t = this.ctx?.currentTime || 0; this._play(380,'sawtooth',t,0.45,0.6,60); }
  click()   { const t = this.ctx?.currentTime || 0; this._play(900,'sine',t,0.03,0.4); }
  kill()    { const t = this.ctx?.currentTime || 0; this._play(660,'square',t,0.06,0.8,220); }
  win()     {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [261,329,392,523,659,784].forEach((f,i) => this._play(f,'sine',t+i*0.09,0.18,0.5));
  }
  levelUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [392,523,659,784].forEach((f,i) => this._play(f,'sine',t+i*0.08,0.12,0.5));
  }
  powerup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523,659,784,1047].forEach((f,i) => this._play(f,'sine',t+i*0.07,0.1,0.45));
  }
  chaos()   {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [200,400,150,500,100].forEach((f,i) => this._play(f,'sawtooth',t+i*0.06,0.1,0.3));
  }
}

// ================================================================
//  PARTICLE SYSTEM
// ================================================================
class ParticleSystem {
  constructor() { this.particles = []; }

  spawn(cx, cy, opts = {}) {
    const { count=8, color='#00ff88', speed=3, life=35, size=3, spread=Math.PI*2 } = opts;
    for (let i = 0; i < count; i++) {
      const angle = (spread / count) * i + Math.random() * 0.6 - 0.3;
      const spd   = speed * (0.6 + Math.random() * 0.8);
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color, size: size * (0.5 + Math.random() * 0.8),
        life, maxLife: life,
        glow: opts.glow ?? true,
      });
    }
  }

  explosion(cx, cy, color) {
    this.spawn(cx, cy, { count: 22, color, speed: 5.5, life: 55, size: 4.5 });
  }

  eat(cx, cy, color) {
    this.spawn(cx, cy, { count: 10, color, speed: 2.5, life: 28, size: 2.5 });
  }

  portal(cx, cy) {
    this.spawn(cx, cy, { count: 14, color: '#e040fb', speed: 3, life: 32, size: 2.5 });
  }

  update() {
    this.particles = this.particles.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vx *= 0.91;
      p.vy *= 0.91;
      return --p.life > 0;
    });
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.particles) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = p.size * 3; }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }
}

// ================================================================
//  BACKGROUND CANVAS (menu animation)
// ================================================================
class BackgroundRenderer {
  constructor() {
    this.canvas = document.getElementById('bg-canvas');
    this.ctx    = this.canvas.getContext('2d');
    this.dots   = [];
    this.frame  = 0;
    this._resize();
    this._initDots();
    window.addEventListener('resize', () => this._resize());
    this._loop();
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _initDots() {
    this.dots = [];
    const count = Math.floor(window.innerWidth * window.innerHeight / 14000);
    for (let i = 0; i < count; i++) {
      this.dots.push({
        x:  Math.random() * window.innerWidth,
        y:  Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r:  Math.random() * 1.5 + 0.5,
        a:  Math.random() * 0.5 + 0.15,
      });
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    this.frame++;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = 'rgba(0,255,136,0.025)';
    ctx.lineWidth = 1;
    const gs = 40;
    for (let x = 0; x < W; x += gs) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gs) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Floating dots
    for (const d of this.dots) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0) d.x = W; if (d.x > W) d.x = 0;
      if (d.y < 0) d.y = H; if (d.y > H) d.y = 0;
      ctx.globalAlpha = d.a;
      ctx.fillStyle   = '#00ff88';
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }
}

// ================================================================
//  SNAKE CLASS
// ================================================================
class Snake {
  constructor(sx, sy, skinIdx = 0, dir = 'right') {
    this.body    = [{ x: sx, y: sy }];
    this.dir     = dir;
    this.nextDir = dir;
    this.skin    = SKINS[skinIdx];
    this.skinIdx = skinIdx;
    this.alive   = true;
    this.growing = 0;

    // Power-up state
    this.shielded    = false;
    this.ghosted     = false;
    this.speedBoost  = false;
    this.slowMo      = false;
    this.multiplier  = 1;
    this._timers     = {};

    // Visual trail
    this.trail = [];
  }

  get head() { return this.body[0]; }
  get length() { return this.body.length; }

  setDir(d) {
    const opp = { up:'down', down:'up', left:'right', right:'left' };
    if (d !== opp[this.dir] && d !== this.dir) this.nextDir = d;
  }

  step(wrapWalls = false) {
    if (!this.alive) return;
    this.dir = this.nextDir;

    // Record trail
    const hd = this.body[0];
    this.trail.push({ x: hd.x * CELL + CELL/2, y: hd.y * CELL + CELL/2 });
    if (this.trail.length > 12) this.trail.shift();

    const nh = { x: hd.x, y: hd.y };
    if (this.dir === 'up')    nh.y--;
    if (this.dir === 'down')  nh.y++;
    if (this.dir === 'left')  nh.x--;
    if (this.dir === 'right') nh.x++;

    if (wrapWalls) {
      nh.x = (nh.x + GRID) % GRID;
      nh.y = (nh.y + GRID) % GRID;
    }

    this.body.unshift(nh);
    if (this.growing > 0) this.growing--;
    else this.body.pop();
  }

  grow(n = 1) { this.growing += n; }

  hitsWall() {
    const { x, y } = this.head;
    return !this.ghosted && (x < 0 || x >= GRID || y < 0 || y >= GRID);
  }

  hitsSelf() {
    if (this.ghosted) return false;
    const { x, y } = this.head;
    return this.body.slice(1).some(s => s.x === x && s.y === y);
  }

  hitsBody(other) {
    const { x, y } = this.head;
    return other.body.some(s => s.x === x && s.y === y);
  }

  applyPower(type) {
    const d = POWERUP_DEFS[type];
    if (!d) return;
    clearTimeout(this._timers[type]);

    switch (type) {
      case 'SPEED':
        this.speedBoost = true;
        this._timers.SPEED = setTimeout(() => { this.speedBoost = false; }, d.duration);
        break;
      case 'SHIELD':
        this.shielded = true;
        break;
      case 'GHOST':
        this.ghosted = true;
        this._timers.GHOST = setTimeout(() => { this.ghosted = false; }, d.duration);
        break;
      case 'SLOWMO':
        this.slowMo = true;
        this._timers.SLOWMO = setTimeout(() => { this.slowMo = false; }, d.duration);
        break;
      case 'MULTIPLIER':
        this.multiplier = 2;
        this._timers.MULT = setTimeout(() => { this.multiplier = 1; }, d.duration);
        break;
    }
  }

  useShield() {
    this.shielded = false;
    return true;
  }

  clearPowers() {
    Object.values(this._timers).forEach(clearTimeout);
    this._timers = {};
    this.shielded = this.ghosted = this.speedBoost = this.slowMo = false;
    this.multiplier = 1;
  }

  // ── Draw ──────────────────────────────────────────────────────
  draw(ctx, t) {
    if (!this.alive && !this._dyingAlpha) return;

    const { skin, body } = this;
    const alpha = this.ghosted ? 0.38 : (this._dyingAlpha ?? 1);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Trail
    if (!this.ghosted) {
      for (let i = 0; i < this.trail.length; i++) {
        const tr = this.trail[i];
        const ta = (i / this.trail.length) * 0.18;
        ctx.globalAlpha = ta;
        ctx.fillStyle  = skin.trail;
        ctx.shadowColor = skin.glow;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, CELL * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = alpha;
    ctx.shadowBlur  = 0;

    // Body segments
    for (let i = body.length - 1; i >= 1; i--) {
      const s  = body[i];
      const bx = s.x * CELL + 2, by = s.y * CELL + 2;
      const bw = CELL - 4, bh = CELL - 4;
      const t2 = i / body.length;

      ctx.shadowColor = skin.glow;
      ctx.shadowBlur  = this.speedBoost ? 14 : (this.ghosted ? 18 : 5);
      ctx.fillStyle   = skin.body;
      ctx.globalAlpha = alpha * (1 - t2 * 0.35);
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 4);
      ctx.fill();
    }

    ctx.globalAlpha = alpha;

    // Head
    if (body.length > 0) {
      const hd = body[0];
      const hx = hd.x * CELL + 1, hy = hd.y * CELL + 1;

      ctx.shadowColor = skin.glow;
      ctx.shadowBlur  = 16;
      ctx.fillStyle   = skin.head;
      ctx.beginPath();
      ctx.roundRect(hx, hy, CELL - 2, CELL - 2, 6);
      ctx.fill();
      ctx.shadowBlur  = 0;

      // Power-up aura
      if (this.shielded) {
        ctx.strokeStyle = '#2196F3';
        ctx.shadowColor = '#2196F3';
        ctx.shadowBlur  = 20;
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.arc(hd.x * CELL + CELL/2, hd.y * CELL + CELL/2, CELL * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (this.ghosted) {
        ctx.strokeStyle = '#9c27b0';
        ctx.shadowColor = '#e040fb';
        ctx.shadowBlur  = 20;
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(hd.x * CELL + CELL/2, hd.y * CELL + CELL/2, CELL * 0.78, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
      }

      // Eyes
      this._drawEyes(ctx, hd);
    }

    ctx.restore();
  }

  _drawEyes(ctx, head) {
    const cx = head.x * CELL + CELL/2;
    const cy = head.y * CELL + CELL/2;
    const r  = 2.8, ofs = 5.5;
    let [ex1, ey1, ex2, ey2] = [0,0,0,0];

    switch (this.dir) {
      case 'right': ex1=cx+4; ey1=cy-ofs; ex2=cx+4; ey2=cy+ofs; break;
      case 'left':  ex1=cx-4; ey1=cy-ofs; ex2=cx-4; ey2=cy+ofs; break;
      case 'up':    ex1=cx-ofs; ey1=cy-4; ex2=cx+ofs; ey2=cy-4; break;
      case 'down':  ex1=cx-ofs; ey1=cy+4; ex2=cx+ofs; ey2=cy+4; break;
    }

    ctx.fillStyle = this.skin.eye;
    ctx.beginPath(); ctx.arc(ex1, ey1, r,   0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2, ey2, r,   0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(ex1, ey1, r/2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2, ey2, r/2, 0, Math.PI*2); ctx.fill();
  }
}

// ================================================================
//  GAME ENGINE
// ================================================================
class SnakeGame {
  constructor() {
    // Canvas setup
    this.canvas  = document.getElementById('game-canvas');
    this.ctx     = this.canvas.getContext('2d');
    this.canvas.width  = W;
    this.canvas.height = H;

    // Scale canvas to fit window
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    // Systems
    this.audio    = new AudioEngine();
    this.particles = new ParticleSystem();
    this.bg       = new BackgroundRenderer();

    // Game state
    this.state   = 'menu';
    this.mode    = 'classic';
    this.skinIdx = 0;
    this.isHost  = true;
    this.isMP    = false;   // multiplayer?

    // Snake & world
    this.snake   = null;
    this.snake2  = null;
    this.foods   = [];
    this.powerUps = [];
    this.portals = [];
    this.popups  = [];

    // Scores
    this.score  = 0;
    this.score2 = 0;
    this.combo  = 1;
    this.kills  = 0;
    this.kills2 = 0;
    this.gameTime = 0;
    this.timeLeft = 60;
    this.level  = 1;

    // Timing
    this.tickInterval = BASE_SPEED;
    this.lastTick     = 0;

    // Chaos
    this.chaosTimer = 0;
    this.chaosEvent = null;
    this.wrapWalls  = false;

    // Power-up spawn
    this.puTimer = 0;

    // Network
    this.network  = new NetworkManager(this);
    this.lastSentDir = null;

    // Achievements / HS / UI
    this.achievements = new AchievementSystem(this);
    this.highScores   = JSON.parse(localStorage.getItem('serpHs') || '{}');
    this.ui           = new UIManager(this);

    this._setupInput();
    this._loop();
    this.ui.showScreen('menu');
    this._rotateTips();
  }

  // ── Resize canvas to fit available space ─────────────────────
  _resizeCanvas() {
    const wrap  = document.querySelector('.canvas-wrap');
    if (!wrap) return;
    const maxW  = wrap.clientWidth  - 2;
    const maxH  = wrap.clientHeight - 2;
    const scale = Math.min(maxW / W, maxH / H, 1);
    this.canvas.style.width  = Math.floor(W * scale) + 'px';
    this.canvas.style.height = Math.floor(H * scale) + 'px';
  }

  // ── Start (or restart) a game ─────────────────────────────────
  startGame(mode, skinIdx, isHost = true, isMP = false) {
    this.mode    = mode;
    this.skinIdx = skinIdx;
    this.isHost  = isHost;
    this.isMP    = isMP;

    // Reset state
    this.snake = this.snake2 = null;
    this.foods = []; this.powerUps = []; this.portals = []; this.popups = [];
    this.score = this.score2 = this.combo = 0; this.combo = 1;
    this.kills = this.kills2 = 0;
    this.gameTime = 0; this.timeLeft = 60; this.level = 1;
    this.tickInterval = BASE_SPEED;
    this.lastTick = performance.now();
    this.puTimer = 0; this.chaosTimer = 0;
    this.chaosEvent = null; this.wrapWalls = false;

    // Build snakes
    if (mode === 'versus' || mode === 'coop') {
      this.snake  = new Snake(4,  12, skinIdx, 'right');
      this.snake2 = new Snake(20, 12, (skinIdx === 2 ? 0 : 2), 'left');
    } else {
      this.snake = new Snake(12, 12, skinIdx, 'right');
    }

    // Portals
    if (mode === 'portal') {
      this.portals = [
        { x: 0,      y: 12, pair: 1 },
        { x: GRID-1, y: 12, pair: 0 },
        { x: 12, y: 0,      pair: 3 },
        { x: 12, y: GRID-1, pair: 2 },
      ];
    }

    // Initial food
    this.spawnFood(); this.spawnFood();

    this.state = 'countdown';
    this.ui.showScreen('game');
    this.ui.updateModeLabel();
    this.ui.setHUDVisibility();
    this.ui.startCountdown(() => { this.state = 'playing'; });
  }

  // ── Main RAF loop ─────────────────────────────────────────────
  _loop(ts = 0) {
    requestAnimationFrame((t) => this._loop(t));

    this.particles.update();
    this.popups = this.popups.filter(p => { p.y -= 0.5; return --p.life > 0; });

    if (this.state === 'playing') {
      const speed = this._effectiveSpeed();
      if (ts - this.lastTick >= speed) {
        this.lastTick = ts;
        this._tick(ts);
      }
    }

    if (['playing','countdown','paused','game_over'].includes(this.state)) {
      this._render(ts);
    }
  }

  _effectiveSpeed() {
    let s = this.tickInterval;
    if (this.snake?.speedBoost) s *= 0.5;
    if (this.snake?.slowMo)     s *= 2.0;
    return s;
  }

  // ── One game tick ─────────────────────────────────────────────
  _tick(ts) {
    this.gameTime++;

    // Mode-specific updates
    switch (this.mode) {
      case 'speed_rush':
        if (this.gameTime % Math.round(10000 / this.tickInterval) === 0) {
          this.tickInterval = Math.max(55, this.tickInterval - 6);
          this.level++;
          this.audio.levelUp();
          this.addPopup('⚡ FASTER!', W/2, H/2, '#ffeb3b');
        }
        break;
      case 'time_attack':
        this.timeLeft -= this.tickInterval / 1000;
        if (this.timeLeft <= 0) { this._endGame(false); return; }
        this.ui.updateTimer(this.timeLeft);
        break;
      case 'chaos':
        this.chaosTimer++;
        if (this.chaosTimer >= Math.round(15000 / this.tickInterval)) {
          this.chaosTimer = 0;
          this._triggerChaos();
        }
        break;
    }

    // Guest in multiplayer just receives state — no local simulation
    if (this.isMP && !this.isHost) return;

    // Move
    const wrap = this.wrapWalls;
    this.snake?.step(wrap);
    if (this.snake2 && this.mode === 'versus') {
      this.snake2.step(wrap);
    } else {
      this.snake2?.step(wrap);
    }

    // Collisions
    this._checkCollisions();
    this._checkFood();
    this._checkPowerUps();
    if (this.mode === 'portal') this._checkPortals();

    // Power-up spawning
    this.puTimer++;
    if (this.puTimer >= Math.round(8000 / this.tickInterval) && this.powerUps.length < 4) {
      this.puTimer = 0;
      this.spawnPowerUp();
    }

    this.achievements.check(this);
    this.ui.updateHUD();

    // Broadcast to guest
    if (this.isMP && this.isHost) {
      this.network.sendState();
    }
  }

  // ── Collision detection ───────────────────────────────────────
  _checkCollisions() {
    const s1 = this.snake, s2 = this.snake2;

    // P1
    if (s1?.alive) {
      const wallDie = !this.wrapWalls && s1.hitsWall();
      const selfDie = s1.hitsSelf();

      if (wallDie || selfDie) {
        if (s1.shielded) { s1.useShield(); this.particles.explosion(s1.head.x*CELL+CELL/2, s1.head.y*CELL+CELL/2, '#2196F3'); return; }
        this._killSnake(s1, 1);
        if (s2?.alive && (this.mode === 'versus')) { this.kills2++; this._vsCheck(); }
        return;
      }

      // P1 head hits P2 body
      if (s2?.alive && s1.hitsBody(s2) && !s1.ghosted) {
        if (s1.shielded) { s1.useShield(); return; }
        this._killSnake(s1, 1);
        if (this.mode === 'versus') { this.kills2++; this.audio.kill(); this.addPopup('💀 ELIMINATED', s1.head.x*CELL, s1.head.y*CELL, '#ff3366'); this._vsCheck(); }
        return;
      }
    }

    // P2
    if (s2?.alive) {
      const wallDie2 = !this.wrapWalls && s2.hitsWall();
      const selfDie2 = s2.hitsSelf();

      if (wallDie2 || selfDie2) {
        if (s2.shielded) { s2.useShield(); this.particles.explosion(s2.head.x*CELL+CELL/2, s2.head.y*CELL+CELL/2, '#2196F3'); return; }
        this._killSnake(s2, 2);
        if (s1?.alive && this.mode === 'versus') { this.kills++; this._vsCheck(); }
        return;
      }

      // P2 head hits P1 body
      if (s1?.alive && s2.hitsBody(s1) && !s2.ghosted) {
        if (s2.shielded) { s2.useShield(); return; }
        this._killSnake(s2, 2);
        if (this.mode === 'versus') { this.kills++; this.audio.kill(); this.addPopup('⚔️ KILL!', s1.head.x*CELL, s1.head.y*CELL, '#00ff88'); this._vsCheck(); }
        return;
      }

      // Head-to-head
      if (s1?.alive && s1.head.x === s2.head.x && s1.head.y === s2.head.y) {
        this._killSnake(s1, 1); this._killSnake(s2, 2);
        if (this.mode === 'versus') this._vsCheck();
      }
    }

    // Co-op body collision
    if (this.mode === 'coop' && s1?.alive && s2?.alive) {
      if (s1.head.x === s2.head.x && s1.head.y === s2.head.y) {
        this._killSnake(s1, 1); this._killSnake(s2, 2);
      }
    }
  }

  _vsCheck() {
    const WIN = 5;
    if (this.kills >= WIN || this.kills2 >= WIN) {
      setTimeout(() => this._endGame(false), 400);
    }
  }

  _killSnake(snake, player) {
    snake.alive = false;
    const h = snake.head;
    this.particles.explosion(h.x * CELL + CELL/2, h.y * CELL + CELL/2, snake.skin.glow);
    this.audio.death();

    if (this.mode === 'versus') {
      // Respawn after 2s if kills haven't hit win condition
      const skinI  = player === 1 ? this.skinIdx : (this.skinIdx === 2 ? 0 : 2);
      const startX = player === 1 ? 4 : 20;
      const startD = player === 1 ? 'right' : 'left';
      setTimeout(() => {
        if (this.state !== 'playing') return;
        if (this.kills >= 5 || this.kills2 >= 5) return;
        const ns = new Snake(startX, 12, skinI, startD);
        if (player === 1) this.snake = ns;
        else this.snake2 = ns;
      }, 2000);
      return;
    }

    if (this.mode === 'coop') {
      if (!this.snake?.alive && !this.snake2?.alive) {
        setTimeout(() => this._endGame(false), 700);
      }
      return;
    }

    setTimeout(() => this._endGame(false), 700);
  }

  // ── Food ─────────────────────────────────────────────────────
  _checkFood() {
    const snakes = [this.snake, this.snake2].filter(Boolean);
    for (const s of snakes) {
      if (!s.alive) continue;
      const idx = this.foods.findIndex(f => f.x === s.head.x && f.y === s.head.y);
      if (idx < 0) continue;
      const food = this.foods.splice(idx, 1)[0];
      s.grow(1);
      const pts = (food.type === 'golden' ? 50 : 10) * this.combo * s.multiplier;
      if (s === this.snake || this.mode === 'coop') this.score += pts;
      else this.score2 += pts;
      this.combo = Math.min(this.combo + 1, 8);
      this.particles.eat(s.head.x*CELL+CELL/2, s.head.y*CELL+CELL/2, food.type === 'golden' ? '#ffd700' : '#ff5252');
      this.audio.eat();
      this.addPopup(`+${pts}`, s.head.x*CELL+CELL/2, s.head.y*CELL - 4, food.type === 'golden' ? '#ffd700' : '#fff');
      this.spawnFood();
      if (Math.random() < 0.08) this.spawnFood();
      if (this.mode === 'coop' && this.score >= 500) { this._endGame(true); return; }
    }
  }

  // ── Power-ups ─────────────────────────────────────────────────
  _checkPowerUps() {
    const snakes = [this.snake, this.snake2].filter(Boolean);
    for (const s of snakes) {
      if (!s.alive) continue;
      const idx = this.powerUps.findIndex(p => p.x === s.head.x && p.y === s.head.y);
      if (idx < 0) continue;
      const pu = this.powerUps.splice(idx, 1)[0];
      this._applyPowerUp(s, pu.type, s === this.snake ? this.snake2 : this.snake);
    }
  }

  _applyPowerUp(snake, type, opponent) {
    const def = POWERUP_DEFS[type];
    if (!def) return;

    if (type === 'SHRINK' && opponent?.alive) {
      const cut = Math.max(1, Math.floor(opponent.body.length * 0.35));
      opponent.body.splice(-cut);
      this.particles.explosion(opponent.head.x*CELL+CELL/2, opponent.head.y*CELL+CELL/2, '#f44336');
      this.addPopup('SHRUNK!', opponent.head.x*CELL, opponent.head.y*CELL, '#f44336');
    } else if (type === 'BOMB') {
      // Blow away some of own tail
      const cut = Math.max(0, Math.floor(snake.body.length * 0.3));
      snake.body.splice(-cut);
      this.particles.explosion(snake.head.x*CELL+CELL/2, snake.head.y*CELL+CELL/2, '#78909c');
    } else {
      snake.applyPower(type);
    }

    this.audio.powerup();
    this.particles.spawn(snake.head.x*CELL+CELL/2, snake.head.y*CELL+CELL/2, { count:14, color: def.color, speed:3.5, life:30 });
    this.addPopup(def.name + '!', snake.head.x*CELL+CELL/2, snake.head.y*CELL - 4, def.color);
    this.ui.updateHUD();
  }

  // ── Portals ───────────────────────────────────────────────────
  _checkPortals() {
    const snakes = [this.snake, this.snake2].filter(Boolean);
    for (const s of snakes) {
      if (!s.alive) continue;
      const h = s.head;
      if (h.x < 0 || h.x >= GRID || h.y < 0 || h.y >= GRID) {
        // Find nearest portal
        const portal = this.portals.find(p => {
          if (h.x < 0)      return p.x === 0       && Math.abs(p.y - h.y) < 2;
          if (h.x >= GRID)  return p.x === GRID-1   && Math.abs(p.y - h.y) < 2;
          if (h.y < 0)      return p.y === 0        && Math.abs(p.x - h.x) < 2;
          if (h.y >= GRID)  return p.y === GRID-1   && Math.abs(p.x - h.x) < 2;
          return false;
        });
        if (portal) {
          const dest = this.portals[portal.pair];
          h.x = dest.x; h.y = dest.y;
          this.particles.portal(dest.x*CELL+CELL/2, dest.y*CELL+CELL/2);
        } else {
          if (s.shielded) { s.useShield(); } else { this._killSnake(s, s===this.snake?1:2); }
        }
      }
    }
  }

  // ── Chaos events ──────────────────────────────────────────────
  _triggerChaos() {
    const evs = ['speedUp','slowDown','foodStorm','wrapWalls','reverse','gravity'];
    const ev  = evs[Math.floor(Math.random() * evs.length)];
    this.chaosEvent = ev;
    this.audio.chaos();

    switch (ev) {
      case 'speedUp':
        this.tickInterval = Math.max(60, this.tickInterval * 0.65);
        this.addPopup('⚡ SPEED SURGE!', W/2, H/3, '#ffeb3b');
        setTimeout(() => { this.tickInterval = BASE_SPEED; this.chaosEvent = null; }, 5000);
        break;
      case 'slowDown':
        this.tickInterval = Math.min(350, this.tickInterval * 1.7);
        this.addPopup('🐌 SLOW FIELD!', W/2, H/3, '#00bcd4');
        setTimeout(() => { this.tickInterval = BASE_SPEED; this.chaosEvent = null; }, 5000);
        break;
      case 'foodStorm':
        for (let i = 0; i < 6; i++) this.spawnFood();
        this.addPopup('🍎 FOOD STORM!', W/2, H/3, '#ff5252');
        this.chaosEvent = null;
        break;
      case 'wrapWalls':
        this.wrapWalls = true;
        this.addPopup('🔄 WALLS WRAP!', W/2, H/3, '#e040fb');
        setTimeout(() => { this.wrapWalls = false; this.chaosEvent = null; }, 8000);
        break;
      case 'reverse':
        if (this.snake?.alive) {
          this.snake.body.reverse();
          const oppDir = { up:'down', down:'up', left:'right', right:'left' };
          this.snake.dir = this.snake.nextDir = oppDir[this.snake.dir] || 'right';
        }
        this.addPopup('🔃 REVERSED!', W/2, H/3, '#ff9800');
        this.chaosEvent = null;
        break;
      case 'gravity':
        // Spawn lots of power-ups at once
        for (let i = 0; i < 4; i++) this.spawnPowerUp();
        this.addPopup('🎁 POWER RAIN!', W/2, H/3, '#ce93d8');
        this.chaosEvent = null;
        break;
    }
  }

  // ── Spawn helpers ──────────────────────────────────────────────
  spawnFood(type = null) {
    if (!type) type = Math.random() < 0.12 ? 'golden' : 'normal';
    const pos = this._emptyCell();
    if (pos) this.foods.push({ ...pos, type });
  }

  spawnPowerUp() {
    const types = Object.keys(POWERUP_DEFS);
    const allowed = this.mode === 'versus' ? types : types.filter(t => t !== 'SHRINK');
    const type = allowed[Math.floor(Math.random() * allowed.length)];
    const pos  = this._emptyCell();
    if (pos) this.powerUps.push({ ...pos, type });
  }

  _emptyCell() {
    const occ = new Set();
    const add  = (arr) => arr?.forEach(s => occ.add(`${s.x},${s.y}`));
    add(this.snake?.body);
    add(this.snake2?.body);
    this.foods.forEach(f => occ.add(`${f.x},${f.y}`));
    this.powerUps.forEach(p => occ.add(`${p.x},${p.y}`));
    this.portals.forEach(p => occ.add(`${p.x},${p.y}`));
    for (let i = 0; i < 150; i++) {
      const x = Math.floor(Math.random() * GRID);
      const y = Math.floor(Math.random() * GRID);
      if (!occ.has(`${x},${y}`)) return { x, y };
    }
    return null;
  }

  addPopup(text, x, y, color = '#ffffff') {
    this.popups.push({ text, x, y, color, life: 55, maxLife: 55 });
  }

  // ── End game ──────────────────────────────────────────────────
  _endGame(won) {
    if (this.state === 'game_over') return;
    this.state = 'game_over';
    const m = this.mode;
    if (!this.highScores[m] || this.score > this.highScores[m]) {
      this.highScores[m] = this.score;
      localStorage.setItem('serpHs', JSON.stringify(this.highScores));
    }
    if (won) this.audio.win();
    this.ui.showGameOver(won, this.score, this.score2, this.kills, this.kills2);
    if (this.isMP) {
      this.network.relay({ action: 'game_over', won: !won, score: this.score2, score2: this.score, kills: this.kills2, kills2: this.kills });
    }
  }

  // ── Renderer ──────────────────────────────────────────────────
  _render(ts) {
    const ctx = this.ctx;
    const t   = ts;

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);
    this._drawGrid(ctx);

    // Portals
    if (this.mode === 'portal') this._drawPortals(ctx, t);

    // Food
    this._drawFood(ctx, t);

    // Power-ups
    this._drawPowerUps(ctx, t);

    // Snakes (draw P2 first so P1 is on top)
    this.snake2?.draw(ctx, t);
    this.snake?.draw(ctx, t);

    // Particles
    this.particles.draw(ctx);

    // Popups
    this._drawPopups(ctx);

    // Mode overlays
    if (this.mode === 'versus')     this._drawKillBar(ctx);
    if (this.mode === 'time_attack') this._drawTimerBar(ctx, this.timeLeft / 60);
    if (this.mode === 'coop')        this._drawCoopProgress(ctx);
  }

  _drawGrid(ctx) {
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID; x++) {
      ctx.beginPath(); ctx.moveTo(x*CELL, 0); ctx.lineTo(x*CELL, H); ctx.stroke();
    }
    for (let y = 0; y <= GRID; y++) {
      ctx.beginPath(); ctx.moveTo(0, y*CELL); ctx.lineTo(W, y*CELL); ctx.stroke();
    }
  }

  _drawFood(ctx, t) {
    for (const f of this.foods) {
      const cx = f.x*CELL + CELL/2, cy = f.y*CELL + CELL/2;
      const pulse = 0.82 + Math.sin(t/280 + f.x*0.7 + f.y*0.5) * 0.18;
      const r = (CELL/2 - 2) * pulse;

      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      if (f.type === 'golden') {
        g.addColorStop(0,'#ffffcc'); g.addColorStop(0.5,'#ffd700'); g.addColorStop(1,'#ff8800');
        ctx.shadowColor = '#ffd700';
      } else {
        g.addColorStop(0,'#ffbbbb'); g.addColorStop(0.5,'#ff3333'); g.addColorStop(1,'#990000');
        ctx.shadowColor = '#ff4444';
      }
      ctx.shadowBlur = 14;
      ctx.fillStyle  = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;

      // Golden sparkle
      if (f.type === 'golden') {
        const angle = t / 600;
        ctx.strokeStyle = 'rgba(255,255,200,0.8)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 5;
        for (let i = 0; i < 4; i++) {
          const a = angle + (Math.PI/2)*i;
          const len = 7 + Math.sin(t/200)*2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a)*len, cy + Math.sin(a)*len);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }
  }

  _drawPowerUps(ctx, t) {
    for (const pu of this.powerUps) {
      const cx = pu.x*CELL + CELL/2, cy = pu.y*CELL + CELL/2;
      const def  = POWERUP_DEFS[pu.type];
      if (!def) continue;
      const pulse = 0.85 + Math.sin(t/450)*0.15;
      const r = (CELL/2 - 1) * pulse;

      // Ring
      ctx.strokeStyle = def.color;
      ctx.shadowColor = def.color; ctx.shadowBlur = 18;
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      ctx.shadowBlur  = 0;

      // Inner fill
      ctx.fillStyle = def.color + '22';
      ctx.beginPath(); ctx.arc(cx, cy, r-2, 0, Math.PI*2); ctx.fill();

      // Icon
      ctx.font = `${Math.round(CELL*0.58)}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, cx, cy+1);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  _drawPortals(ctx, t) {
    const colors = ['#e040fb','#40c4ff','#69f0ae','#ff6e40'];
    for (let i = 0; i < this.portals.length; i++) {
      const p = this.portals[i];
      const cx = p.x*CELL + CELL/2, cy = p.y*CELL + CELL/2;
      const color = colors[i % colors.length];
      const rot   = t / 900 * (i%2===0?1:-1);

      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.shadowColor = color; ctx.shadowBlur = 20;
      for (let r2 = 4; r2 <= CELL/2-2; r2 += 5) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = (1 - r2/(CELL/2)) * 0.8;
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.arc(0, 0, r2, 0, Math.PI*1.6); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  _drawPopups(ctx) {
    ctx.save();
    for (const p of this.popups) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.font = 'bold 14px Orbitron, sans-serif';
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.textAlign   = 'center';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.textAlign   = 'left';
    ctx.restore();
  }

  _drawKillBar(ctx) {
    const WIN = 5, yp = 12;
    const dot = (kill, color, xStart, dir) => {
      for (let i = 0; i < WIN; i++) {
        ctx.beginPath();
        ctx.arc(xStart + dir*i*22, yp, 7, 0, Math.PI*2);
        const on = i < kill;
        ctx.fillStyle   = on ? color : 'rgba(255,255,255,0.12)';
        ctx.shadowColor = color; ctx.shadowBlur = on ? 12 : 0;
        ctx.fill();
      }
    };
    dot(this.kills,  this.snake?.skin.glow || '#00ff88', 22, 1);
    if (this.snake2)
      dot(this.kills2, this.snake2?.skin.glow || '#ff3366', W-22, -1);
    ctx.shadowBlur = 0;
  }

  _drawTimerBar(ctx, pct) {
    const bh = 5, y = H - bh;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, y, W, bh);
    const col = pct > 0.5 ? '#00ff88' : pct > 0.25 ? '#ff9800' : '#ff3333';
    ctx.fillStyle   = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.fillRect(0, y, W*pct, bh);
    ctx.shadowBlur = 0;
  }

  _drawCoopProgress(ctx) {
    const pct = Math.min(this.score / 500, 1);
    const bh  = 5;
    ctx.fillStyle = 'rgba(0,255,136,0.08)';
    ctx.fillRect(0, H-bh, W, bh);
    ctx.fillStyle   = '#00ff88';
    ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 8;
    ctx.fillRect(0, H-bh, W*pct, bh);
    ctx.shadowBlur  = 0;
  }

  // ── Receive multiplayer state (guest only) ─────────────────────
  receiveState(data) {
    if (!data) return;
    if (data.snake1 && this.snake)  this.snake.body  = data.snake1;
    if (data.snake2 && this.snake2) this.snake2.body = data.snake2;
    if (data.dir1   && this.snake)  this.snake.dir   = data.dir1;
    if (data.dir2   && this.snake2) this.snake2.dir  = data.dir2;
    if (data.alive1 !== undefined && this.snake)  this.snake.alive  = data.alive1;
    if (data.alive2 !== undefined && this.snake2) this.snake2.alive = data.alive2;
    this.foods     = data.foods    ?? this.foods;
    this.powerUps  = data.powerUps ?? this.powerUps;
    this.score     = data.score  ?? 0;
    this.score2    = data.score2 ?? 0;
    this.kills     = data.kills  ?? 0;
    this.kills2    = data.kills2 ?? 0;
    this.ui.updateHUD();
  }

  // ── Input ─────────────────────────────────────────────────────
  _setupInput() {
    const MAP1 = {
      ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',
      KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right',
    };
    const MAP2 = {
      KeyI:'up',KeyK:'down',KeyJ:'left',KeyL:'right',
    };

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing') { this.state = 'paused'; this.ui.togglePause(true); }
        else if (this.state === 'paused') { this.state = 'playing'; this.ui.togglePause(false); }
        return;
      }
      if (this.state !== 'playing') return;

      const d1 = MAP1[e.code];
      if (d1 && this.snake?.alive) {
        e.preventDefault();
        if (!this.isMP || this.isHost) this.snake.setDir(d1);
        else this.network.sendInput(d1);
      }

      const d2 = MAP2[e.code];
      if (d2 && this.snake2?.alive && !this.isMP) {
        e.preventDefault(); this.snake2.setDir(d2);
      }
    });

    // Touch
    let tx = 0, ty = 0;
    this.canvas.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; e.preventDefault(); }, { passive: false });
    this.canvas.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx>0?'right':'left') : (dy>0?'down':'up');
      if (this.snake?.alive && this.state === 'playing') {
        if (!this.isMP || this.isHost) this.snake.setDir(dir);
        else this.network.sendInput(dir);
      }
      e.preventDefault();
    }, { passive: false });

    // On-screen buttons
    document.querySelectorAll('.touch-btn').forEach(btn => {
      btn.addEventListener('touchstart', e => {
        const dir = btn.dataset.dir;
        if (dir && dir !== 'none' && this.snake?.alive && this.state === 'playing') {
          if (!this.isMP || this.isHost) this.snake.setDir(dir);
          else this.network.sendInput(dir);
        }
        e.preventDefault();
      }, { passive: false });
    });
  }

  _rotateTips() {
    let i = 0;
    const el = document.getElementById('tip-text');
    setInterval(() => {
      if (!el) return;
      el.style.opacity = '0';
      setTimeout(() => {
        i = (i + 1) % TIPS.length;
        el.textContent = TIPS[i];
        el.style.opacity = '1';
      }, 400);
    }, 5000);
    if (el) el.style.transition = 'opacity 0.4s';
  }
}

// ================================================================
//  NETWORK MANAGER
// ================================================================
class NetworkManager {
  constructor(game) {
    this.game     = game;
    this.ws       = null;
    this.code     = null;
    this.role     = null; // 'host' | 'guest'
    this.connected = false;
    this._pingT   = null;
    this._pingInterval = null;
    this._stateSeq = 0;
  }

  connect() {
    return new Promise((res, rej) => {
      if (this.ws?.readyState === WebSocket.OPEN) { res(); return; }
      try {
        this.ws = new WebSocket(SERVER_URL);
        const timeout = setTimeout(() => { this.ws.close(); rej(new Error('Timeout')); }, 8000);
        this.ws.onopen  = () => { clearTimeout(timeout); this.connected = true; this._startPing(); res(); };
        this.ws.onerror = () => { clearTimeout(timeout); rej(new Error('Connection error')); };
        this.ws.onclose = () => {
          this.connected = false;
          clearInterval(this._pingInterval);
          this.game.ui.onDisconnect();
        };
        this.ws.onmessage = (e) => {
          try { this._handle(JSON.parse(e.data)); } catch {}
        };
      } catch (e) { rej(e); }
    });
  }

  _handle(msg) {
    switch (msg.type) {
      case 'room_created':
        this.code = msg.code; this.role = 'host';
        this.game.ui.onRoomCreated(msg.code);
        break;
      case 'room_joined':
        this.code = msg.code; this.role = 'guest';
        this.game.ui.onRoomJoined(msg.code, msg.gameMode);
        break;
      case 'guest_joined':
        this.game.ui.onGuestJoined();
        break;
      case 'relay':
        this._handleRelay(msg.from, msg.data);
        break;
      case 'player_disconnected':
        this.game.ui.onOpponentLeft(msg.role);
        break;
      case 'room_expired':
        this.game.ui.showToast('Room expired due to inactivity', 'warn');
        break;
      case 'pong':
        if (this._pingT) {
          const lat = Date.now() - this._pingT;
          this.game.ui.updateLatency(lat);
        }
        break;
      case 'error':
        this.game.ui.showToast(msg.message || 'Server error', 'err');
        break;
    }
  }

  _handleRelay(from, data) {
    if (!data || typeof data.action !== 'string') return;
    switch (data.action) {
      case 'input':
        if (this.role === 'host' && this.game.snake2?.alive) {
          const valid = ['up','down','left','right'];
          if (valid.includes(data.dir)) this.game.snake2.setDir(data.dir);
        }
        break;
      case 'state':
        if (this.role === 'guest') this.game.receiveState(data);
        break;
      case 'start':
        if (this.role === 'guest') {
          const mode = data.mode || this.game.ui.selectedMode;
          this.game.startGame(mode, data.skinIdx ?? 0, false, true);
        }
        break;
      case 'game_over':
        if (this.role === 'guest') {
          this.game.state = 'game_over';
          this.game.ui.showGameOver(data.won, data.score, data.score2, data.kills, data.kills2);
        }
        break;
      case 'ready':
        this.game.ui.showToast('Opponent is ready!', 'ok');
        break;
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(data)); } catch {}
    }
  }

  relay(data) { this.send({ type: 'relay', data }); }
  sendInput(dir) { this.relay({ action: 'input', dir }); }

  sendState() {
    const g  = this.game;
    const s1 = g.snake, s2 = g.snake2;
    this.relay({
      action:  'state',
      seq:     this._stateSeq++,
      snake1:  s1 ? s1.body.slice(0, 50) : [],
      snake2:  s2 ? s2.body.slice(0, 50) : [],
      dir1:    s1?.dir,
      dir2:    s2?.dir,
      alive1:  s1?.alive ?? false,
      alive2:  s2?.alive ?? false,
      foods:   g.foods,
      powerUps: g.powerUps,
      score:   g.score, score2: g.score2,
      kills:   g.kills, kills2: g.kills2,
    });
  }

  startMPGame(mode, skinIdx) {
    this.relay({ action: 'start', mode, skinIdx });
    this.game.startGame(mode, skinIdx, true, true);
  }

  createRoom(mode)  { this.send({ type: 'create_room', gameMode: mode }); }
  joinRoom(code)    { this.send({ type: 'join_room',   code }); }
  leaveRoom()       { this.send({ type: 'leave_room' }); this._cleanup(); }

  _cleanup() {
    clearInterval(this._pingInterval);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.connected = false; this.code = null; this.role = null;
  }

  _startPing() {
    this._pingInterval = setInterval(() => {
      this._pingT = Date.now();
      this.send({ type: 'ping', t: this._pingT });
    }, 4000);
  }
}

// ================================================================
//  ACHIEVEMENT SYSTEM
// ================================================================
class AchievementSystem {
  constructor(game) {
    this.game    = game;
    this.earned  = new Set(JSON.parse(localStorage.getItem('serpAch') || '[]'));
    this.pending = []; // unlocked this session (for game-over screen)
    this.defs    = {
      first_bite:   { name: '🍎 First Bite',    desc: 'Eat your first food',           icon: '🍎' },
      centurion:    { name: '💯 Centurion',      desc: 'Reach 100 points',              icon: '💯' },
      speed_demon:  { name: '⚡ Speed Demon',    desc: 'Collect a Speed Boost',         icon: '⚡' },
      untouchable:  { name: '🛡 Untouchable',    desc: 'Block a hit with Shield',       icon: '🛡' },
      ghost_rider:  { name: '👻 Ghost Rider',    desc: 'Activate Ghost Mode',           icon: '👻' },
      glutton:      { name: '🐍 Glutton',        desc: 'Grow to length 20',             icon: '🐍' },
      combo_king:   { name: '🔥 Combo King',     desc: 'Reach ×5 combo',                icon: '🔥' },
      first_blood:  { name: '⚔️ First Blood',    desc: 'Get your first kill (Versus)',  icon: '⚔️' },
      dominator:    { name: '👑 Dominator',      desc: 'Reach 5 kills in Versus',       icon: '👑' },
      team_player:  { name: '🤝 Team Player',    desc: 'Win a Co-op game',              icon: '🤝' },
      chaos_master: { name: '🔮 Chaos Master',   desc: 'Score 300 in Chaos mode',       icon: '🔮' },
      millennium:   { name: '🌟 Millennium',     desc: 'Reach 1000 points',             icon: '🌟' },
    };
  }

  check(g) {
    const s = g.snake;
    if (!s) return;
    if (s.length >= 2)   this._unlock('first_bite');
    if (g.score >= 100)  this._unlock('centurion');
    if (g.score >= 1000) this._unlock('millennium');
    if (s.speedBoost)    this._unlock('speed_demon');
    if (s.ghosted)       this._unlock('ghost_rider');
    if (s.length >= 20)  this._unlock('glutton');
    if (g.combo >= 5)    this._unlock('combo_king');
    if (g.kills >= 1)    this._unlock('first_blood');
    if (g.kills >= 5)    this._unlock('dominator');
    if (g.mode === 'chaos' && g.score >= 300) this._unlock('chaos_master');
  }

  onCoopWin()  { this._unlock('team_player'); }
  onShieldUse(){ this._unlock('untouchable'); }

  _unlock(id) {
    if (this.earned.has(id)) return;
    this.earned.add(id);
    this.pending.push(id);
    localStorage.setItem('serpAch', JSON.stringify([...this.earned]));
    const def = this.defs[id];
    if (def) this._popup(def);
  }

  _popup(def) {
    const container = document.getElementById('achievement-container');
    const el = document.createElement('div');
    el.className = 'achievement-popup';
    el.innerHTML = `
      <div class="ach-icon">${def.icon}</div>
      <div class="ach-info">
        <div class="ach-title">Achievement Unlocked!</div>
        <div class="ach-name">${def.name}</div>
        <div class="ach-desc">${def.desc}</div>
      </div>`;
    container.appendChild(el);
    setTimeout(() => el.classList.add('show'), 80);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 450);
    }, 3200);
  }
}

// ================================================================
//  UI MANAGER
// ================================================================
class UIManager {
  constructor(game) {
    this.game         = game;
    this.selectedMode = 'classic';
    this._roomPending = false;
    this._setup();
    this._buildSkins();
    this._buildLobbySkins();
  }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.add('active');
  }

  // ── Build all button listeners ───────────────────────────────
  _setup() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

    // Menu
    on('btn-solo',          'click', () => { this.game.audio.click(); this.showScreen('mode_select'); });
    on('btn-multiplayer',   'click', () => { this.game.audio.click(); this.showScreen('lobby'); this._resetLobby(); });
    on('btn-leaderboard',   'click', () => { this.game.audio.click(); this._refreshLB(); this.showScreen('leaderboard'); });

    // Mode select
    document.querySelectorAll('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        this.game.audio.click();
        document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedMode = card.dataset.mode;
      });
      card.addEventListener('dblclick', () => {
        this.selectedMode = card.dataset.mode;
        this.showScreen('skin_select');
      });
    });

    on('btn-play-mode',   'click', () => { this.game.audio.click(); this.showScreen('skin_select'); });
    on('btn-start-game',  'click', () => {
      this.game.audio.click();
      this.game.startGame(this.selectedMode, this.game.skinIdx);
    });

    // Back buttons
    document.querySelectorAll('.btn-back-small').forEach(btn => {
      btn.addEventListener('click', () => {
        this.game.audio.click();
        this.showScreen(btn.dataset.target || 'menu');
      });
    });

    // Leaderboard
    on('btn-clear-hs', 'click', () => {
      localStorage.removeItem('serpHs');
      this.game.highScores = {};
      this._refreshLB();
    });

    // Lobby — create
    on('btn-create-room', 'click', async () => {
      if (this._roomPending) return;
      this._roomPending = true;
      this.game.audio.click();
      const mode = document.getElementById('lobby-mode-select')?.value || 'versus';
      this.selectedMode = mode;
      this._setLobbyStatus('create', 'Connecting to server…');
      try {
        await this.game.network.connect();
        this.game.network.createRoom(mode);
      } catch {
        this._setLobbyStatus('create', '❌ Server unreachable. Try again later.');
        this._roomPending = false;
      }
    });

    // Copy code
    on('btn-copy-code', 'click', () => {
      const code = document.getElementById('room-code-display')?.textContent;
      if (code && code !== '------') {
        navigator.clipboard?.writeText(code).then(() => this._setLobbyStatus('create', '✅ Code copied!'));
      }
    });

    // Lobby — join
    on('btn-join-room', 'click', async () => {
      if (this._roomPending) return;
      const code = (document.getElementById('code-input')?.value || '').replace(/\D/g,'').slice(0,6);
      if (code.length !== 6) { this._setLobbyStatus('join', '⚠️ Enter a valid 6-digit code'); return; }
      this._roomPending = true;
      this.game.audio.click();
      this._setLobbyStatus('join', 'Connecting…');
      try {
        await this.game.network.connect();
        this.game.network.joinRoom(code);
      } catch {
        this._setLobbyStatus('join', '❌ Server unreachable. Try again later.');
        this._roomPending = false;
      }
    });

    // Code input — only digits
    on('code-input', 'input', (e) => {
      e.target.value = e.target.value.replace(/\D/g,'').slice(0,6);
    });

    // Start multiplayer game (host)
    on('btn-start-mp', 'click', () => {
      this.game.audio.click();
      this.game.network.startMPGame(this.selectedMode, this.game.skinIdx);
    });

    // Mode selector in lobby
    on('lobby-mode-select', 'change', (e) => { this.selectedMode = e.target.value; });

    // Pause
    on('btn-pause',        'click', () => { this.game.state = 'paused'; this.togglePause(true);  this.game.audio.click(); });
    on('btn-resume',       'click', () => { this.game.state = 'playing'; this.togglePause(false); this.game.audio.click(); });
    on('btn-restart-game', 'click', () => {
      this.game.audio.click();
      this.togglePause(false);
      this.game.startGame(this.game.mode, this.game.skinIdx, this.game.isHost, this.game.isMP);
    });
    on('btn-quit-game', 'click', () => {
      this.game.audio.click();
      this.togglePause(false);
      this.game.network.leaveRoom();
      this.showScreen('menu');
    });

    // Game Over
    on('btn-play-again', 'click', () => {
      this.game.audio.click();
      this.game.startGame(this.game.mode, this.game.skinIdx, this.game.isHost, this.game.isMP);
    });
    on('btn-main-menu', 'click', () => {
      this.game.audio.click();
      this.game.network.leaveRoom();
      this.showScreen('menu');
    });
  }

  // ── Skins ───────────────────────────────────────────────────
  _buildSkins() {
    const container = document.getElementById('skin-options');
    if (!container) return;
    container.innerHTML = '';

    SKINS.forEach((skin, i) => {
      const card = document.createElement('div');
      card.className = 'skin-card' + (i === 0 ? ' selected' : '');

      const cv = document.createElement('canvas');
      cv.className = 'skin-preview'; cv.width = 88; cv.height = 60;
      this._drawSkinPreview(cv, skin);

      const nm = document.createElement('div');
      nm.className = 'skin-name'; nm.textContent = skin.name;

      card.append(cv, nm);
      card.addEventListener('click', () => {
        document.querySelectorAll('#skin-options .skin-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.game.skinIdx = i;
        this.game.audio.click();
        document.getElementById('selected-skin-name').textContent = skin.name;
        this._drawMainPreview(skin);
      });
      container.appendChild(card);
    });
    this._drawMainPreview(SKINS[0]);
  }

  _buildLobbySkins() {
    const container = document.getElementById('lobby-skin-options');
    if (!container) return;
    SKINS.forEach((skin, i) => {
      const dot = document.createElement('div');
      dot.className = 'lobby-skin-dot' + (i === 0 ? ' selected' : '');
      dot.style.background = `radial-gradient(circle at 35% 35%, ${skin.head}, ${skin.body})`;
      dot.title = skin.name;
      dot.addEventListener('click', () => {
        document.querySelectorAll('.lobby-skin-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        this.game.skinIdx = i;
        this.game.audio.click();
      });
      container.appendChild(dot);
    });
  }

  _drawSkinPreview(canvas, skin) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#05050f'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const segs = [{x:2,y:1},{x:1,y:1},{x:0,y:1}];
    const cs = 26;
    segs.forEach((s,si) => {
      ctx.fillStyle = si===0 ? skin.head : skin.body;
      ctx.shadowColor = skin.glow; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.roundRect(s.x*cs+5, s.y*cs+17, cs-3, cs-3, 4); ctx.fill();
    });
    ctx.shadowBlur = 0;
  }

  _drawMainPreview(skin) {
    const canvas = document.getElementById('skin-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#05050f'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const segs = [{x:4,y:1},{x:3,y:1},{x:2,y:1},{x:1,y:1},{x:0,y:1}];
    const cs = 34;
    segs.forEach((s,si) => {
      ctx.fillStyle = si===0 ? skin.head : skin.body;
      ctx.shadowColor = skin.glow; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.roundRect(s.x*cs+4, s.y*cs+8, cs-2, cs-2, 5); ctx.fill();
    });
    ctx.shadowBlur = 0;
  }

  // ── Lobby ───────────────────────────────────────────────────
  _resetLobby() {
    this._roomPending = false;
    this._setCodeDigits('------');
    this._setLobbyStatus('create', 'Click Create to get a room code');
    this._setLobbyStatus('join', 'Enter the 6-digit code');
    const startBtn = document.getElementById('btn-start-mp');
    if (startBtn) { startBtn.style.display = 'none'; startBtn.disabled = true; }
    const copyBtn  = document.getElementById('btn-copy-code');
    if (copyBtn) copyBtn.style.display = 'none';
    const inp = document.getElementById('code-input');
    if (inp) inp.value = '';
    this.game.network.leaveRoom();
  }

  _setLobbyStatus(side, msg) {
    const el = document.getElementById(`lobby-status-${side}`);
    if (el) el.textContent = msg;
  }

  _setCodeDigits(code) {
    const digits = document.querySelectorAll('.code-digit');
    digits.forEach((d, i) => { d.textContent = code[i] ?? '-'; d.classList.toggle('active', code[i] !== '-'); });
  }

  onRoomCreated(code) {
    this._roomPending = false;
    this._setCodeDigits(code);
    this._setLobbyStatus('create', '⏳ Waiting for a friend to join…');
    const copyBtn = document.getElementById('btn-copy-code');
    if (copyBtn) copyBtn.style.display = 'inline-flex';
    // Store code on button for copy
    document.getElementById('room-code-display').dataset.code = code;
  }

  onRoomJoined(code, gameMode) {
    this._roomPending = false;
    this._setCodeDigits(code);
    this._setLobbyStatus('join', '✅ Joined! Waiting for host to start…');
    this.selectedMode = gameMode || this.selectedMode;
  }

  onGuestJoined() {
    this._setLobbyStatus('create', '🎮 Player joined! Ready to start!');
    const startBtn = document.getElementById('btn-start-mp');
    if (startBtn) { startBtn.style.display = 'block'; startBtn.disabled = false; }
  }

  onOpponentLeft(role) {
    if (this.game.state === 'playing') {
      this.game.state = 'paused';
      this.togglePause(true);
      this.showToast('Opponent disconnected! 🏆 You win!', 'ok');
    } else {
      this.showToast('Opponent disconnected.', 'warn');
      this._resetLobby();
    }
  }

  onDisconnect() {
    if (this.game.state === 'playing') this.showToast('Connection lost!', 'err');
  }

  updateLatency(ms) {
    const el1 = document.getElementById('latency-display');
    const el2 = document.getElementById('latency-hud');
    const col  = ms < 80 ? '#00ff88' : ms < 160 ? '#ffeb3b' : '#ff4444';
    const txt  = ms + 'ms';
    if (el1) { el1.textContent = txt; el1.style.color = col; }
    if (el2) { el2.textContent = txt; el2.style.color = col; }
  }

  // ── In-game HUD ──────────────────────────────────────────────
  updateModeLabel() {
    const el = document.getElementById('mode-label');
    if (el) el.textContent = MODE_LABELS[this.game.mode] || this.game.mode.toUpperCase();
  }

  setHUDVisibility() {
    const g = this.game;
    const vs = g.mode === 'versus', coop = g.mode === 'coop';
    const mp = g.isMP;

    // P2 score
    const p2hud = document.getElementById('p2-hud');
    if (p2hud) { p2hud.style.display = (vs || coop) ? 'flex' : 'none'; }
    const p2lbl = document.getElementById('p2-label');
    if (p2lbl) p2lbl.textContent = coop ? 'SHARED' : 'P2 SCORE';

    // Kills row
    const khud = document.getElementById('kills-hud');
    if (khud) { khud.style.display = vs ? 'flex' : 'none'; }

    // Timer
    const timer = document.getElementById('timer-display');
    if (timer) { timer.style.display = g.mode === 'time_attack' ? 'block' : 'none'; }

    // Latency
    const lathud = document.getElementById('latency-hud');
    if (lathud) { lathud.style.display = mp ? 'block' : 'none'; }
  }

  updateHUD() {
    const g = this.game;
    const $ = (id) => document.getElementById(id);

    const sdis = $('score-display');
    if (sdis) sdis.textContent = g.score.toLocaleString();

    const cdis = $('combo-display');
    if (cdis) {
      cdis.textContent = `×${g.combo}`;
      cdis.style.background = g.combo >= 5 ? 'rgba(255,215,0,0.15)' : g.combo >= 3 ? 'rgba(255,152,0,0.15)' : 'rgba(0,255,136,0.1)';
      cdis.style.borderColor = g.combo >= 5 ? 'rgba(255,215,0,0.5)' : g.combo >= 3 ? 'rgba(255,152,0,0.5)' : 'rgba(0,255,136,0.3)';
      cdis.style.color = g.combo >= 5 ? '#ffd700' : g.combo >= 3 ? '#ff9800' : '#00ff88';
    }

    const p2s = $('p2-score-display');
    if (p2s) p2s.textContent = (g.mode === 'coop' ? g.score : g.score2).toLocaleString();

    const k1 = $('kills-display'), k2 = $('kills2-display');
    if (k1) k1.textContent = g.kills;
    if (k2) k2.textContent = g.kills2;

    this._updatePowerUpsRow();
  }

  _updatePowerUpsRow() {
    const container = document.getElementById('hud-powerups');
    const s = this.game.snake;
    if (!container || !s) return;
    const active = [];
    if (s.speedBoost) active.push({ icon: '⚡', name: 'Speed',  col: '#ffeb3b' });
    if (s.shielded)   active.push({ icon: '🛡', name: 'Shield', col: '#2196F3' });
    if (s.ghosted)    active.push({ icon: '👻', name: 'Ghost',  col: '#9c27b0' });
    if (s.slowMo)     active.push({ icon: '🐌', name: 'Slow',   col: '#00bcd4' });
    if (s.multiplier > 1) active.push({ icon: '✨', name: '2×', col: '#ff9800' });
    container.innerHTML = active.map(p =>
      `<span class="powerup-badge" style="border-color:${p.col}44;color:${p.col}">${p.icon} ${p.name}</span>`
    ).join('');
  }

  updateTimer(t) {
    const el = document.getElementById('timer-display');
    if (el) {
      el.textContent = Math.ceil(t) + 's';
      el.style.color = t < 15 ? '#ff3333' : t < 30 ? '#ff9800' : '#ffffff';
    }
  }

  togglePause(on) {
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.toggle('active', on);
  }

  startCountdown(cb) {
    const overlay = document.getElementById('countdown-overlay');
    if (!overlay) { cb(); return; }
    let count = 3;
    overlay.textContent = count;
    overlay.classList.add('active');
    this.game.audio.click();

    const tick = () => {
      count--;
      if (count <= 0) {
        overlay.textContent = 'GO!';
        this.game.audio.levelUp();
        setTimeout(() => { overlay.classList.remove('active'); overlay.textContent = ''; cb(); }, 600);
      } else {
        overlay.textContent = count;
        this.game.audio.click();
        setTimeout(tick, 900);
      }
    };
    setTimeout(tick, 900);
  }

  // ── Leaderboard ──────────────────────────────────────────────
  _refreshLB() {
    const hs   = this.game.highScores;
    const ach  = this.game.achievements;
    const tbody = document.getElementById('lb-body');
    const modeMap = [
      ['classic','🏆 Classic'], ['speed_rush','⚡ Speed Rush'], ['portal','🌀 Portal'],
      ['time_attack','⏱ Time Attack'], ['versus','⚔️ Versus'], ['coop','🤝 Co-op'], ['chaos','🔮 Chaos'],
    ];
    if (tbody) {
      tbody.innerHTML = modeMap.map(([k,n]) => `
        <tr>
          <td>${n}</td>
          <td class="score-val">${hs[k] ? hs[k].toLocaleString() : '—'}</td>
        </tr>`).join('');
    }
    const achList = document.getElementById('ach-list');
    if (achList) {
      achList.innerHTML = Object.entries(ach.defs).map(([id, d]) => {
        const earned = ach.earned.has(id);
        return `<div class="ach-badge${earned ? ' earned' : ''}">${d.icon ?? d.name.split(' ')[0]} ${d.name.split(' ').slice(1).join(' ')}</div>`;
      }).join('');
    }
  }

  // ── Game Over ────────────────────────────────────────────────
  showGameOver(won, score, score2, kills, kills2) {
    const g   = this.game;
    const mode = g.mode;

    const title = document.getElementById('game-over-title');
    if (title) {
      if (mode === 'versus') {
        const win = kills > kills2;
        const tie = kills === kills2;
        title.textContent  = tie ? '🤝 TIE!' : win ? '🏆 YOU WIN!' : '💀 YOU LOSE';
        title.style.color  = tie ? '#ffffff' : win ? '#ffd700' : '#ff3366';
      } else if (mode === 'coop') {
        title.textContent = won ? '🎉 MISSION COMPLETE!' : '💀 GAME OVER';
        title.style.color = won ? '#00ff88' : '#ff3366';
      } else {
        title.textContent = '💀 GAME OVER';
        title.style.color = '#ff3366';
      }
    }

    const scoreEl = document.getElementById('final-score');
    if (scoreEl) {
      if (mode === 'versus') {
        scoreEl.innerHTML = `
          <div style="display:flex;gap:32px;justify-content:center;align-items:center">
            <div style="text-align:center"><div style="font-size:12px;color:var(--text-muted);font-family:var(--font-title);letter-spacing:.1em">YOU</div><div style="font-size:36px;font-family:var(--font-title);color:var(--neon-green)">${kills}</div><div style="font-size:12px;color:var(--text-muted)">kills</div></div>
            <div style="color:var(--text-muted);font-size:20px">vs</div>
            <div style="text-align:center"><div style="font-size:12px;color:var(--text-muted);font-family:var(--font-title);letter-spacing:.1em">OPPONENT</div><div style="font-size:36px;font-family:var(--font-title);color:var(--neon-red)">${kills2}</div><div style="font-size:12px;color:var(--text-muted)">kills</div></div>
          </div>`;
      } else {
        scoreEl.innerHTML = `Score: <span class="highlight">${score.toLocaleString()}</span>`;
      }
    }

    // High score banner
    const nhsEl = document.getElementById('new-highscore');
    const prevHs = g.highScores[mode] || 0;
    if (nhsEl) nhsEl.style.display = score > prevHs && score > 0 ? 'block' : 'none';

    // Stats
    const statsEl = document.getElementById('final-stats');
    if (statsEl) {
      const len = g.snake?.length || 1;
      statsEl.innerHTML = `
        🐍 Length: <strong>${len}</strong> &nbsp;|&nbsp;
        ⏱ Time: <strong>${Math.floor(g.gameTime * g.tickInterval / 1000)}s</strong> &nbsp;|&nbsp;
        🔥 Best Combo: <strong>×${g.combo}</strong>`;
    }

    // Session achievements
    const achEl = document.getElementById('go-achievements');
    if (achEl) {
      const pending = g.achievements.pending;
      achEl.innerHTML = pending.length
        ? pending.map(id => {
            const d = g.achievements.defs[id];
            return d ? `<div class="go-ach-badge">${d.icon} ${d.name}</div>` : '';
          }).join('')
        : '';
      g.achievements.pending = [];
    }

    this.showScreen('game_over');
  }

  // ── Toast ────────────────────────────────────────────────────
  showToast(msg, type = 'err') {
    const el = document.getElementById('error-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = type === 'ok' ? 'rgba(0,150,80,0.95)' : type === 'warn' ? 'rgba(140,100,0,0.95)' : 'rgba(198,40,40,0.95)';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 4000);
  }
}

// ================================================================
//  BOOT
// ================================================================
window.addEventListener('DOMContentLoaded', () => {
  window.serpentine = new SnakeGame();
});

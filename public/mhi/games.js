// ═══════════════════════════════════════════════════════════════
// MHI Games — evidence-based micro-interventions
// Each game: visuospatial engagement + calming rhythm
// No fail states. No scores. Just presence.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── Shared ────────────────────────────────────────────────
  var WORDS = ['breathe', 'pause', "you're here", 'you matter', 'steady', 'ready', 'begin again'];
  var wIdx = 0;
  function nw() { var w = WORDS[wIdx % WORDS.length]; wIdx++; return w; }
  var PAL = ['#c4a35a', '#7a9e8e', '#6a8fa7', '#b07a7a', '#8a9eae', '#b8856e', '#8e7299', '#a69076'];
  function rC() { return PAL[Math.floor(Math.random() * PAL.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function blk(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, s, s, 3); else ctx.rect(x, y, s, s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 2, y + 2, s - 4, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x + 2, y + s - 1, s - 4, 1);
  }

  function gridBg(ctx, w, h, cell, cols, rows) {
    ctx.fillStyle = '#141820'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(37,42,56,0.25)'; ctx.lineWidth = 0.5;
    for (var c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c * cell, 0); ctx.lineTo(c * cell, h); ctx.stroke(); }
    for (var r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell); ctx.lineTo(w, r * cell); ctx.stroke(); }
  }

  // SVG icon fragments for controls
  var ICON = {
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    up: '<polyline points="18 15 12 9 6 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    rotate: '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    slam: '<polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/>',
    tend: '<path d="M12 3C12 3 8 8 8 12a4 4 0 0 0 8 0c0-4-4-9-4-9z"/>',
  };

  // ═══════════════════════════════════════════════════════════
  // 1. TETRIS — visuospatial processing interrupts rumination
  // ═══════════════════════════════════════════════════════════

  var tetris = (function () {
    var COLS = 8, ROWS = 14, cell, grid, piece, dropTimer;
    var DROP = 1000;
    var PIECES = [
      { s: [[1, 1], [1, 1]], c: '#c4a35a' },
      { s: [[1, 1, 1]], c: '#7a9e8e' },
      { s: [[1, 1, 1, 1]], c: '#6a8fa7' },
      { s: [[1, 1, 0], [0, 1, 1]], c: '#b07a7a' },
      { s: [[0, 1, 1], [1, 1, 0]], c: '#8a9eae' },
      { s: [[1, 0], [1, 0], [1, 1]], c: '#b8856e' },
      { s: [[0, 1], [0, 1], [1, 1]], c: '#8e7299' },
      { s: [[1, 1, 1], [0, 1, 0]], c: '#a69076' },
    ];

    function spawn() {
      var d = PIECES[Math.floor(Math.random() * PIECES.length)];
      var sh = []; for (var r = 0; r < d.s.length; r++) sh[r] = d.s[r].slice();
      return { s: sh, c: d.c, x: Math.floor((COLS - sh[0].length) / 2), y: 0 };
    }

    function fits(sh, px, py) {
      for (var r = 0; r < sh.length; r++)
        for (var c = 0; c < sh[r].length; c++)
          if (sh[r][c]) {
            var gx = px + c, gy = py + r;
            if (gx < 0 || gx >= COLS || gy >= ROWS) return false;
            if (gy >= 0 && grid[gy][gx]) return false;
          }
      return true;
    }

    function lock() {
      for (var r = 0; r < piece.s.length; r++)
        for (var c = 0; c < piece.s[r].length; c++)
          if (piece.s[r][c]) {
            var gy = piece.y + r, gx = piece.x + c;
            if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) grid[gy][gx] = piece.c;
          }
    }

    function clear() {
      var ev = [];
      for (var r = ROWS - 1; r >= 0; r--) {
        var full = true;
        for (var c = 0; c < COLS; c++) if (!grid[r][c]) { full = false; break; }
        if (full) {
          ev.push({ text: nw(), y: r * cell });
          grid.splice(r, 1);
          var nr = []; for (var c2 = 0; c2 < COLS; c2++) nr.push(null);
          grid.unshift(nr); r++;
        }
      }
      return ev;
    }

    return {
      id: 'tetris', name: 'blocks',
      controls: [
        { icon: ICON.left, label: 'Move left' },
        { icon: ICON.rotate, label: 'Rotate' },
        { icon: ICON.right, label: 'Move right' },
        { icon: ICON.slam, label: 'Drop' }
      ],
      start: function (maxW, maxH) {
        cell = Math.floor(Math.min(maxW / COLS, maxH / ROWS));
        cell = clamp(cell, 18, 32);
        grid = [];
        for (var r = 0; r < ROWS; r++) { grid[r] = []; for (var c = 0; c < COLS; c++) grid[r][c] = null; }
        // Seed bottom rows
        for (var r2 = ROWS - 5; r2 < ROWS; r2++) {
          var d = 0.4 + (r2 - (ROWS - 5)) * 0.08;
          for (var c2 = 0; c2 < COLS; c2++) if (Math.random() < d) grid[r2][c2] = rC();
        }
        for (var r3 = ROWS - 5; r3 < ROWS; r3++) {
          var f = true; for (var c3 = 0; c3 < COLS; c3++) if (!grid[r3][c3]) { f = false; break; }
          if (f) for (var g = 0; g < 3; g++) grid[r3][Math.floor(Math.random() * COLS)] = null;
        }
        piece = spawn(); dropTimer = 0;
        return { w: COLS * cell, h: ROWS * cell };
      },
      tick: function (dt) {
        dropTimer += dt;
        if (dropTimer >= DROP) {
          dropTimer = 0;
          if (fits(piece.s, piece.x, piece.y + 1)) piece.y++;
          else {
            lock(); var ev = clear();
            piece = spawn();
            if (!fits(piece.s, piece.x, piece.y)) {
              for (var r = 0; r < 4; r++) for (var c = 0; c < COLS; c++) grid[r][c] = null;
              piece.y = 0;
            }
            return ev;
          }
        }
        return [];
      },
      draw: function (ctx, w, h) {
        gridBg(ctx, w, h, cell, COLS, ROWS);
        for (var r = 0; r < ROWS; r++)
          for (var c = 0; c < COLS; c++)
            if (grid[r][c]) blk(ctx, c * cell + 1, r * cell + 1, cell - 2, grid[r][c]);
        if (piece)
          for (var pr = 0; pr < piece.s.length; pr++)
            for (var pc = 0; pc < piece.s[pr].length; pc++)
              if (piece.s[pr][pc]) blk(ctx, (piece.x + pc) * cell + 1, (piece.y + pr) * cell + 1, cell - 2, piece.c);
      },
      onControl: function (i) {
        if (!piece) return [];
        if (i === 0 && fits(piece.s, piece.x - 1, piece.y)) piece.x--;
        else if (i === 2 && fits(piece.s, piece.x + 1, piece.y)) piece.x++;
        else if (i === 1) {
          var old = piece.s, rows = old.length, cols = old[0].length, rot = [];
          for (var c = 0; c < cols; c++) { rot[c] = []; for (var r = rows - 1; r >= 0; r--) rot[c].push(old[r][c]); }
          var off = [0, -1, 1, -2, 2];
          for (var j = 0; j < off.length; j++)
            if (fits(rot, piece.x + off[j], piece.y)) { piece.s = rot; piece.x += off[j]; break; }
        } else if (i === 3) {
          while (fits(piece.s, piece.x, piece.y + 1)) piece.y++;
          lock(); var ev = clear();
          piece = spawn();
          if (!fits(piece.s, piece.x, piece.y)) {
            for (var r = 0; r < 4; r++) for (var c = 0; c < COLS; c++) grid[r][c] = null;
            piece.y = 0;
          }
          dropTimer = 0;
          return ev;
        }
        return [];
      }
    };
  })();

  // ═══════════════════════════════════════════════════════════
  // 2. SNAKE — sustained attention, flow state
  //    No death. Wraps edges. Calming pace.
  // ═══════════════════════════════════════════════════════════

  var snake = (function () {
    var COLS = 12, ROWS = 12, cell;
    var body, dir, food, moveTimer;
    var SPEED = 180;

    function randFood() {
      for (var tries = 0; tries < 100; tries++) {
        var x = Math.floor(Math.random() * COLS), y = Math.floor(Math.random() * ROWS);
        var on = false;
        for (var i = 0; i < body.length; i++) if (body[i].x === x && body[i].y === y) { on = true; break; }
        if (!on) return { x: x, y: y, c: rC() };
      }
      return { x: 0, y: 0, c: rC() };
    }

    return {
      id: 'snake', name: 'serpent',
      controls: [
        { icon: ICON.left, label: 'Left' },
        { icon: ICON.up, label: 'Up' },
        { icon: ICON.down, label: 'Down' },
        { icon: ICON.right, label: 'Right' }
      ],
      start: function (maxW, maxH) {
        var sq = Math.min(maxW, maxH);
        cell = Math.floor(sq / COLS);
        cell = clamp(cell, 18, 28);
        // Start with a snake of length 5 in the middle
        body = [];
        var mid = Math.floor(ROWS / 2);
        for (var i = 4; i >= 0; i--) body.push({ x: Math.floor(COLS / 2) - i, y: mid });
        dir = { x: 1, y: 0 };
        food = randFood();
        moveTimer = 0;
        return { w: COLS * cell, h: ROWS * cell };
      },
      tick: function (dt) {
        moveTimer += dt;
        if (moveTimer < SPEED) return [];
        moveTimer = 0;
        var head = body[0];
        var nx = (head.x + dir.x + COLS) % COLS;
        var ny = (head.y + dir.y + ROWS) % ROWS;
        // Self-collision: just trim the tail to make room (no death)
        for (var i = 0; i < body.length; i++) {
          if (body[i].x === nx && body[i].y === ny) {
            body = body.slice(0, i);
            break;
          }
        }
        body.unshift({ x: nx, y: ny });
        if (nx === food.x && ny === food.y) {
          var ev = [{ text: nw(), y: ny * cell }];
          food = randFood();
          // If snake gets too long, trim it
          if (body.length > COLS * ROWS * 0.4) body = body.slice(0, 5);
          return ev;
        }
        body.pop();
        return [];
      },
      draw: function (ctx, w, h) {
        gridBg(ctx, w, h, cell, COLS, ROWS);
        // Food
        ctx.fillStyle = food.c;
        ctx.beginPath();
        ctx.arc(food.x * cell + cell / 2, food.y * cell + cell / 2, cell * 0.35, 0, Math.PI * 2);
        ctx.fill();
        // Body
        for (var i = body.length - 1; i >= 0; i--) {
          var b = body[i];
          var alpha = 0.4 + 0.6 * (1 - i / body.length);
          ctx.save(); ctx.globalAlpha = alpha;
          blk(ctx, b.x * cell + 2, b.y * cell + 2, cell - 4, i === 0 ? '#a8c8a0' : '#7a9e8e');
          ctx.restore();
        }
      },
      onControl: function (i) {
        if (i === 0 && dir.x !== 1) dir = { x: -1, y: 0 };
        else if (i === 1 && dir.y !== 1) dir = { x: 0, y: -1 };
        else if (i === 2 && dir.y !== -1) dir = { x: 0, y: 1 };
        else if (i === 3 && dir.x !== -1) dir = { x: 1, y: 0 };
        return [];
      }
    };
  })();

  // ═══════════════════════════════════════════════════════════
  // 3. BRICK BREAKER — rhythmic tracking, predictable physics
  //    No lives. Ball resets to paddle. Gentle pace.
  // ═══════════════════════════════════════════════════════════

  var breaker = (function () {
    var W, H, paddle, ball, bricks, brickW, brickH;
    var PADDLE_W = 80, PADDLE_H = 10, BALL_R = 5;
    var BALL_SPEED = 1.6;
    var BRICK_ROWS = 5, BRICK_COLS = 8;

    function resetBall() {
      ball = { x: paddle.x, y: H - 30 - BALL_R, dx: BALL_SPEED * 0.7, dy: -BALL_SPEED };
    }

    return {
      id: 'breaker', name: 'breaker',
      controls: [
        { icon: ICON.left, label: 'Left' },
        null,
        { icon: ICON.right, label: 'Right' },
        null
      ],
      start: function (maxW, maxH) {
        W = Math.min(maxW, 280);
        H = Math.min(maxH, 400);
        brickW = Math.floor(W / BRICK_COLS);
        brickH = 14;
        paddle = { x: W / 2, w: PADDLE_W };
        resetBall();
        bricks = [];
        for (var r = 0; r < BRICK_ROWS; r++) {
          for (var c = 0; c < BRICK_COLS; c++) {
            // Pre-break some bricks for instant-puzzle feel
            if (Math.random() < 0.15) continue;
            bricks.push({
              x: c * brickW, y: 20 + r * (brickH + 3),
              w: brickW - 2, h: brickH,
              c: PAL[r % PAL.length], alive: true
            });
          }
        }
        return { w: W, h: H };
      },
      tick: function (dt) {
        var events = [];
        // Move ball (dt-independent via fixed steps)
        var steps = Math.ceil(dt / 8);
        for (var s = 0; s < steps; s++) {
          ball.x += ball.dx;
          ball.y += ball.dy;
          // Wall bounce
          if (ball.x <= BALL_R || ball.x >= W - BALL_R) { ball.dx = -ball.dx; ball.x = clamp(ball.x, BALL_R, W - BALL_R); }
          if (ball.y <= BALL_R) { ball.dy = Math.abs(ball.dy); }
          // Paddle bounce
          if (ball.dy > 0 && ball.y >= H - 30 - BALL_R && ball.y <= H - 20) {
            var px = ball.x - paddle.x;
            if (Math.abs(px) < paddle.w / 2 + BALL_R) {
              ball.dy = -Math.abs(ball.dy);
              ball.dx = BALL_SPEED * (px / (paddle.w / 2)) * 0.9;
              ball.y = H - 30 - BALL_R;
            }
          }
          // Reset if below paddle (no punishment)
          if (ball.y > H + 10) resetBall();
          // Brick collision
          for (var i = 0; i < bricks.length; i++) {
            var br = bricks[i];
            if (!br.alive) continue;
            if (ball.x >= br.x && ball.x <= br.x + br.w && ball.y - BALL_R <= br.y + br.h && ball.y + BALL_R >= br.y) {
              br.alive = false;
              ball.dy = -ball.dy;
              events.push({ text: nw(), y: br.y });
              break;
            }
          }
        }
        // If all bricks gone, regenerate
        var alive = false;
        for (var j = 0; j < bricks.length; j++) if (bricks[j].alive) { alive = true; break; }
        if (!alive) {
          bricks = [];
          for (var r = 0; r < BRICK_ROWS; r++)
            for (var c = 0; c < BRICK_COLS; c++)
              bricks.push({
                x: c * brickW, y: 20 + r * (brickH + 3),
                w: brickW - 2, h: brickH,
                c: PAL[r % PAL.length], alive: true
              });
        }
        return events;
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#141820'; ctx.fillRect(0, 0, w, h);
        // Bricks
        for (var i = 0; i < bricks.length; i++) {
          var br = bricks[i];
          if (!br.alive) continue;
          ctx.fillStyle = br.c;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(br.x + 1, br.y, br.w, br.h, 2);
          else ctx.rect(br.x + 1, br.y, br.w, br.h);
          ctx.fill();
        }
        // Paddle
        ctx.fillStyle = '#c4a35a';
        ctx.beginPath();
        var px = paddle.x - paddle.w / 2;
        if (ctx.roundRect) ctx.roundRect(px, h - 30, paddle.w, PADDLE_H, 5);
        else ctx.rect(px, h - 30, paddle.w, PADDLE_H);
        ctx.fill();
        // Ball
        ctx.fillStyle = '#d4cdc0';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
        ctx.fill();
      },
      onControl: function (i) {
        if (i === 0) paddle.x = Math.max(paddle.w / 2, paddle.x - 20);
        else if (i === 2) paddle.x = Math.min(W - paddle.w / 2, paddle.x + 20);
        return [];
      }
    };
  })();

  // ═══════════════════════════════════════════════════════════
  // 5. GARDEN — nurturing, non-violent whac-a-mole
  //    Flowers sprout. Tap to tend them. They bloom.
  //    Canvas-tap interaction. No controls needed.
  // ═══════════════════════════════════════════════════════════

  var garden = (function () {
    var COLS = 4, ROWS = 4, cell;
    var plots, sproutTimer;
    var W, H;
    var SPROUT_INTERVAL = 1500;
    var PLANT_COLORS = ['#7a9e8e', '#6aaa8e', '#b8856e', '#8e7299', '#c4a35a', '#b07a7a'];

    function pCol() { return PLANT_COLORS[Math.floor(Math.random() * PLANT_COLORS.length)]; }

    return {
      id: 'garden', name: 'garden',
      controls: [null, null, null, null], // tap-based, no buttons
      start: function (maxW, maxH) {
        var sq = Math.min(maxW, maxH);
        cell = Math.floor(sq / COLS);
        cell = clamp(cell, 40, 70);
        W = COLS * cell;
        H = ROWS * cell;
        plots = [];
        for (var r = 0; r < ROWS; r++) {
          plots[r] = [];
          for (var c = 0; c < COLS; c++) {
            plots[r][c] = { state: 'empty', color: null, age: 0, bloomAge: 0 };
          }
        }
        // Pre-sprout a few
        for (var i = 0; i < 4; i++) {
          var pr = Math.floor(Math.random() * ROWS), pc = Math.floor(Math.random() * COLS);
          plots[pr][pc] = { state: 'growing', color: pCol(), age: 500 + Math.random() * 1000, bloomAge: 0 };
        }
        sproutTimer = 0;
        return { w: W, h: H };
      },
      tick: function (dt) {
        sproutTimer += dt;
        // Sprout new plants
        if (sproutTimer >= SPROUT_INTERVAL) {
          sproutTimer = 0;
          var empties = [];
          for (var r = 0; r < ROWS; r++)
            for (var c = 0; c < COLS; c++)
              if (plots[r][c].state === 'empty') empties.push({ r: r, c: c });
          if (empties.length > 0) {
            var pick = empties[Math.floor(Math.random() * empties.length)];
            plots[pick.r][pick.c] = { state: 'sprouting', color: pCol(), age: 0, bloomAge: 0 };
          }
        }
        // Age all plants
        for (var r2 = 0; r2 < ROWS; r2++) {
          for (var c2 = 0; c2 < COLS; c2++) {
            var p = plots[r2][c2];
            if (p.state === 'sprouting') {
              p.age += dt;
              if (p.age > 600) p.state = 'growing';
            } else if (p.state === 'growing') {
              p.age += dt;
              if (p.age > 6000) { p.state = 'wilted'; p.age = 0; }
            } else if (p.state === 'blooming') {
              p.bloomAge += dt;
              if (p.bloomAge > 1800) { p.state = 'empty'; p.color = null; p.age = 0; p.bloomAge = 0; }
            } else if (p.state === 'wilted') {
              p.age += dt;
              if (p.age > 1000) { p.state = 'empty'; p.color = null; p.age = 0; }
            }
          }
        }
        return [];
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#141820'; ctx.fillRect(0, 0, w, h);
        // Draw plots
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var px = c * cell, py = r * cell;
            var p = plots[r][c];
            // Plot background
            ctx.fillStyle = '#1a1f2a';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(px + 3, py + 3, cell - 6, cell - 6, 6);
            else ctx.rect(px + 3, py + 3, cell - 6, cell - 6);
            ctx.fill();
            // Subtle border
            ctx.strokeStyle = 'rgba(37,42,56,0.5)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            var cx = px + cell / 2, cy = py + cell / 2;
            if (p.state === 'sprouting') {
              // Small green dot
              ctx.fillStyle = p.color;
              ctx.globalAlpha = 0.5;
              ctx.beginPath();
              ctx.arc(cx, cy + 4, 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            } else if (p.state === 'growing') {
              // Stem + leaves
              var growPct = Math.min(p.age / 3000, 1);
              var stemH = 8 + growPct * 14;
              ctx.strokeStyle = '#5a8a5a';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(cx, cy + 10);
              ctx.lineTo(cx, cy + 10 - stemH);
              ctx.stroke();
              // Flower head
              ctx.fillStyle = p.color;
              ctx.beginPath();
              ctx.arc(cx, cy + 10 - stemH, 4 + growPct * 4, 0, Math.PI * 2);
              ctx.fill();
              // Pulse to invite tapping
              if (growPct > 0.5) {
                ctx.fillStyle = p.color;
                ctx.globalAlpha = 0.15 + Math.sin(p.age * 0.004) * 0.1;
                ctx.beginPath();
                ctx.arc(cx, cy + 10 - stemH, 10 + growPct * 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
              }
            } else if (p.state === 'blooming') {
              // Full bloom with radiating glow
              var fade = 1 - p.bloomAge / 1800;
              ctx.fillStyle = p.color;
              ctx.globalAlpha = fade * 0.15;
              ctx.beginPath();
              ctx.arc(cx, cy, cell * 0.35, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = fade;
              // Petals
              for (var pe = 0; pe < 6; pe++) {
                var pa = (pe / 6) * Math.PI * 2 + p.bloomAge * 0.001;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(cx + Math.cos(pa) * 8, cy + Math.sin(pa) * 8, 4, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.fillStyle = '#c4a35a';
              ctx.beginPath();
              ctx.arc(cx, cy, 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            } else if (p.state === 'wilted') {
              // Fading grey dot
              var wFade = 1 - p.age / 1000;
              ctx.fillStyle = '#3a3a3a';
              ctx.globalAlpha = wFade * 0.5;
              ctx.beginPath();
              ctx.arc(cx, cy, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          }
        }
      },
      onTap: function (x, y) {
        var c = Math.floor(x / cell), r = Math.floor(y / cell);
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return [];
        var p = plots[r][c];
        if (p.state === 'growing' || p.state === 'sprouting') {
          p.state = 'blooming';
          p.bloomAge = 0;
          return [{ text: nw(), y: r * cell + cell / 2 }];
        }
        return [];
      },
      onControl: function () { return []; }
    };
  })();

  // ─── Export ────────────────────────────────────────────────
  window.MHI_GAMES = [tetris, snake, breaker, garden];

})();

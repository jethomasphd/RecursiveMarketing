// ═══════════════════════════════════════════════════════════════
// MHI — A Moment
// Cinematic landing → breathing game → job search
// Every pixel intentional.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var WORKER = window.__WORKER_URL__ || '';
  var TIMEOUT = 30000;
  var GAME_DURATION = 18000;

  // ─── State ──────────────────────────────────────────────
  var currentTab = 'search';
  var stage = 'landing';

  // Search
  var userName = '';
  var selectedInterest = '';
  var selectedLocation = '';
  var detectedLocation = '';
  var extraction = { interest: 'jobs', location: 'anywhere' };
  var signal = 0;
  var rawHistory = [];
  var cachedJobs = null;
  var totalResults = 0;
  var searchUrl = '';
  var lastSearchKey = '';
  var isWaiting = false;
  var topPickJob = null;

  // Game
  var gameRunning = false;
  var gamePaused = false;
  var gameCanvas, gameCtx;
  var gameStartTime = 0;
  var gameAnimFrame = null;
  var breathTimer = 0;
  var breathPhase = 'in';
  var BREATH_IN = 4000;
  var BREATH_OUT = 4000;
  var timerExpired = false;
  var freePlay = false;

  // Grid: 8 cols x 14 rows
  var COLS = 8, ROWS = 14;
  var CELL = 0;
  var grid = [];
  var currentPiece = null;
  var dropTimer = 0;
  var DROP_INTERVAL = 1000;
  var rowsCleared = 0;
  var floatingWords = [];
  var gameWords = ['breathe', 'pause', "you're here", 'you matter', 'steady', 'ready', 'begin again'];
  var wordIndex = 0;

  // Piece definitions — muted natural tones
  var PIECES = [
    { shape: [[1,1],[1,1]], color: '#c4a35a' },
    { shape: [[1,1,1]], color: '#7a9e8e' },
    { shape: [[1,1,1,1]], color: '#6a8fa7' },
    { shape: [[1,1,0],[0,1,1]], color: '#b07a7a' },
    { shape: [[0,1,1],[1,1,0]], color: '#8a9eae' },
    { shape: [[1,0],[1,0],[1,1]], color: '#b8856e' },
    { shape: [[0,1],[0,1],[1,1]], color: '#8e7299' },
    { shape: [[1,1,1],[0,1,0]], color: '#a69076' },
  ];

  // ─── Helpers ────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function each(sel, fn) { var els = document.querySelectorAll(sel); for (var i = 0; i < els.length; i++) fn(els[i]); }
  function log() { var a = ['[mhi]']; for (var i = 0; i < arguments.length; i++) a.push(arguments[i]); console.log.apply(console, a); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function scrollChat() { var a = $('chatArea'); if (a) a.scrollTop = a.scrollHeight; }

  // ─── Tabs ───────────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;
    each('.tab', function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
    $('screenSearch').classList.toggle('hidden', tab !== 'search');
    $('screenAbout').classList.toggle('hidden', tab !== 'about');
    if (tab === 'about') $('screenAbout').scrollTop = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    log('init');

    // Tabs
    each('.tab', function (t) { t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); }); });

    // Landing
    $('beginBtn').addEventListener('click', beginTransition);
    $('skipBtn').addEventListener('click', skipToSearch);

    // Game controls
    $('ctrlLeft').addEventListener('click', function () { movePiece(-1); });
    $('ctrlRight').addEventListener('click', function () { movePiece(1); });
    $('ctrlRotate').addEventListener('click', function () { rotatePiece(); });
    $('ctrlSlam').addEventListener('click', function () { slamPiece(); });

    // Prevent double-tap zoom on controls
    each('.ctrl', function (btn) {
      btn.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
      btn.addEventListener('touchend', function (e) {
        e.preventDefault();
        btn.click();
      }, { passive: false });
    });

    // Game overlay
    $('keepPlayingBtn').addEventListener('click', keepPlaying);
    $('readyBtn').addEventListener('click', readyToSearch);
    $('freeplayExit').addEventListener('click', readyToSearch);

    // Picks
    var ni = $('nameInput');
    ni.addEventListener('input', updateGoButton);
    ni.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPicks(); });

    each('#interestChips .chip', function (c) { c.addEventListener('click', function () { selectChip('interest', c); }); });
    each('#locationChips .chip', function (c) { c.addEventListener('click', function () { selectChip('location', c); }); });

    var li = $('locationInput');
    if (li) {
      li.addEventListener('input', function () {
        if (li.value.trim()) {
          each('#locationChips .chip', function (c) { c.classList.remove('selected'); });
          selectedLocation = li.value.trim();
          updateGoButton();
        }
      });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPicks(); });
    }

    $('goBtn').addEventListener('click', submitPicks);
    $('skipPicks').addEventListener('click', function () { submitPicks(true); });

    // Chat
    $('chatInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    $('chatSend').addEventListener('click', sendChat);
    $('ctaBtn').addEventListener('click', function (e) { e.preventDefault(); goToApply(); });

    // Tooltip system
    initTooltips();

    // Canvas setup
    gameCanvas = $('gameCanvas');
    gameCtx = gameCanvas.getContext('2d');
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    // Start cinematic reveal
    revealLanding();
  }

  function sizeCanvas() {
    var maxW = Math.min(window.innerWidth - 48, 280);
    var maxH = window.innerHeight - 220;
    CELL = Math.floor(Math.min(maxW / COLS, maxH / ROWS));
    CELL = Math.max(CELL, 18);
    CELL = Math.min(CELL, 32);
    gameCanvas.width = COLS * CELL;
    gameCanvas.height = ROWS * CELL;
  }

  // ═══════════════════════════════════════════════════════════
  // LANDING — cinematic slow reveal
  // ═══════════════════════════════════════════════════════════
  function revealLanding() {
    var timings = [
      { el: 'enso', cls: 'draw', delay: 800 },
      { el: 'r1', cls: 'vis', delay: 2800 },
      { el: 'r2', cls: 'vis', delay: 4800 },
      { el: 'r3', cls: 'vis', delay: 6200 },
      { el: 'r4', cls: 'vis', delay: 8000 },
      { el: 'r5', cls: 'vis', delay: 9800 },
      { el: 'beginBtn', cls: 'vis', delay: 11500 },
      { el: 'skipBtn', cls: 'vis', delay: 12500 },
    ];
    for (var i = 0; i < timings.length; i++) {
      (function (t) {
        setTimeout(function () {
          var el = $(t.el);
          if (el) el.classList.add(t.cls);
        }, t.delay);
      })(timings[i]);
    }
  }

  // ─── Soft fade → guided breath → game ──────────────────
  function beginTransition() {
    log('begin transition');
    var landing = $('stageLanding');
    landing.classList.add('exiting');

    setTimeout(function () {
      landing.style.display = 'none';
      startBreath();
    }, 1000);
  }

  function startBreath() {
    log('guided breath');
    stage = 'breath';
    var el = $('stageBreath');
    var guide = $('breathGuide');
    var text = $('breathText');
    el.classList.add('active');

    // Phase 1: breathe in (4s)
    setTimeout(function () {
      text.textContent = 'breathe in';
      text.classList.add('vis');
      guide.classList.add('expanding');
    }, 600);

    // Phase 2: breathe out (4.5s)
    setTimeout(function () {
      text.textContent = 'and out';
      guide.classList.remove('expanding');
      guide.classList.add('contracting');
    }, 5000);

    // Phase 3: fade out and start game
    setTimeout(function () {
      el.style.transition = 'opacity 0.8s ease';
      el.style.opacity = '0';
      setTimeout(function () {
        el.classList.remove('active');
        el.style.opacity = '';
        el.style.transition = '';
        startGame();
      }, 800);
    }, 9800);
  }

  function skipToSearch() {
    log('skip to search');
    $('stageLanding').style.display = 'none';
    $('stageSearch').classList.add('active');
    stage = 'picks';
    detectLocation();
    setTimeout(function () { $('nameInput').focus(); }, 400);
  }

  // ═══════════════════════════════════════════════════════════
  // GAME ENGINE
  // ═══════════════════════════════════════════════════════════

  function startGame() {
    log('starting game');
    stage = 'game';
    $('stageGame').classList.add('active');

    grid = [];
    for (var r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (var c = 0; c < COLS; c++) grid[r][c] = null;
    }

    // Pre-fill bottom rows so the board starts mid-puzzle
    seedGrid();

    rowsCleared = 0;
    wordIndex = 0;
    breathTimer = 0;
    breathPhase = 'in';
    dropTimer = 0;
    floatingWords = [];
    timerExpired = false;
    freePlay = false;
    gamePaused = false;
    gameRunning = true;
    gameStartTime = Date.now();
    currentPiece = spawnPiece();

    $('gameOverlay').classList.remove('vis');
    $('freeplayExit').classList.remove('vis');
    $('timerTrack').style.display = '';

    // Initialize breath circle
    var circle = $('breathCircle');
    if (circle) { circle.classList.remove('inhale', 'exhale'); circle.classList.add('inhale'); }

    gameLoop(Date.now());
  }

  // Seed bottom rows with blocks and gaps — gives the user something to puzzle into
  function seedGrid() {
    var colors = [];
    for (var i = 0; i < PIECES.length; i++) colors.push(PIECES[i].color);

    // Fill rows ROWS-5 through ROWS-1 (bottom 5 rows)
    for (var r = ROWS - 5; r < ROWS; r++) {
      // Rows closer to bottom are more filled
      var density = 0.4 + (r - (ROWS - 5)) * 0.08;
      for (var c = 0; c < COLS; c++) {
        if (Math.random() < density) {
          grid[r][c] = colors[Math.floor(Math.random() * colors.length)];
        }
      }
    }

    // Ensure no row is completely full (so the game doesn't immediately clear)
    for (var r2 = ROWS - 5; r2 < ROWS; r2++) {
      var full = true;
      for (var c2 = 0; c2 < COLS; c2++) {
        if (!grid[r2][c2]) { full = false; break; }
      }
      if (full) {
        // Remove 2-3 random blocks
        var gaps = 2 + Math.floor(Math.random() * 2);
        for (var g = 0; g < gaps; g++) {
          grid[r2][Math.floor(Math.random() * COLS)] = null;
        }
      }
    }
  }

  function spawnPiece() {
    var def = PIECES[Math.floor(Math.random() * PIECES.length)];
    // Deep copy the shape so rotation doesn't mutate the template
    var shape = [];
    for (var r = 0; r < def.shape.length; r++) {
      shape[r] = def.shape[r].slice();
    }
    var w = shape[0].length;
    return { shape: shape, color: def.color, x: Math.floor((COLS - w) / 2), y: 0 };
  }

  function gameLoop(lastTime) {
    if (!gameRunning) return;

    var now = Date.now();
    var dt = now - lastTime;

    if (!gamePaused) {
      var elapsed = now - gameStartTime;

      // Timer
      if (!freePlay) {
        var progress = Math.min(elapsed / GAME_DURATION, 1);
        $('timerFill').style.width = (progress * 100) + '%';

        if (elapsed >= GAME_DURATION && !timerExpired) {
          timerExpired = true;
          showGameComplete();
        }
      }

      // Breathing — synced to circle
      breathTimer += dt;
      var cycle = BREATH_IN + BREATH_OUT;
      var pos = breathTimer % cycle;
      var newPhase = pos < BREATH_IN ? 'in' : 'out';
      if (newPhase !== breathPhase) {
        breathPhase = newPhase;
        $('breathHint').textContent = breathPhase === 'in' ? 'in' : 'out';
        var circle = $('breathCircle');
        if (circle) {
          circle.classList.remove('inhale', 'exhale');
          circle.classList.add(breathPhase === 'in' ? 'inhale' : 'exhale');
        }
      }

      // Drop
      if (!timerExpired || freePlay) {
        dropTimer += dt;
        if (dropTimer >= DROP_INTERVAL) {
          dropTimer = 0;
          if (currentPiece) {
            if (!tryMove(currentPiece, 0, 1)) {
              lockPiece(currentPiece);
              checkRows();
              currentPiece = spawnPiece();
              if (!canPlace(currentPiece, currentPiece.x, currentPiece.y)) {
                clearTopRows();
                currentPiece.y = 0;
              }
            }
          }
        }
      }

      // Update floating words
      updateFloatingWords(now);
    }

    drawGame();

    gameAnimFrame = requestAnimationFrame(function () { gameLoop(now); });
  }

  function showGameComplete() {
    gamePaused = true;
    $('gameOverlay').classList.add('vis');
  }

  function keepPlaying() {
    log('keep playing');
    freePlay = true;
    gamePaused = false;
    timerExpired = false;
    $('gameOverlay').classList.remove('vis');
    $('timerTrack').style.display = 'none';
    $('freeplayExit').classList.add('vis');
  }

  function readyToSearch() {
    log('ready to search');
    gameRunning = false;
    if (gameAnimFrame) cancelAnimationFrame(gameAnimFrame);

    // Fade game out
    var game = $('stageGame');
    game.style.transition = 'opacity 0.8s ease';
    game.style.opacity = '0';

    setTimeout(function () {
      game.classList.remove('active');
      game.style.opacity = '';
      game.style.transition = '';

      $('stageSearch').classList.add('active');
      stage = 'picks';
      detectLocation();
      setTimeout(function () { $('nameInput').focus(); }, 400);
    }, 800);
  }

  // ─── Piece movement ─────────────────────────────────────
  function tryMove(piece, dx, dy) {
    var nx = piece.x + dx;
    var ny = piece.y + dy;
    if (canPlace(piece, nx, ny)) {
      piece.x = nx;
      piece.y = ny;
      return true;
    }
    return false;
  }

  function canPlace(piece, px, py) {
    var s = piece.shape;
    for (var r = 0; r < s.length; r++) {
      for (var c = 0; c < s[r].length; c++) {
        if (s[r][c]) {
          var gx = px + c, gy = py + r;
          if (gx < 0 || gx >= COLS || gy >= ROWS) return false;
          if (gy >= 0 && grid[gy][gx]) return false;
        }
      }
    }
    return true;
  }

  function canPlaceShape(shape, px, py) {
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          var gx = px + c, gy = py + r;
          if (gx < 0 || gx >= COLS || gy >= ROWS) return false;
          if (gy >= 0 && grid[gy][gx]) return false;
        }
      }
    }
    return true;
  }

  function lockPiece(piece) {
    var s = piece.shape;
    for (var r = 0; r < s.length; r++) {
      for (var c = 0; c < s[r].length; c++) {
        if (s[r][c]) {
          var gy = piece.y + r, gx = piece.x + c;
          if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) {
            grid[gy][gx] = piece.color;
          }
        }
      }
    }
  }

  function movePiece(dx) {
    if (!gameRunning || !currentPiece || gamePaused) return;
    tryMove(currentPiece, dx, 0);
  }

  function rotatePiece() {
    if (!gameRunning || !currentPiece || gamePaused) return;

    var old = currentPiece.shape;
    var rows = old.length;
    var cols = old[0].length;
    var rotated = [];
    for (var c = 0; c < cols; c++) {
      rotated[c] = [];
      for (var r = rows - 1; r >= 0; r--) {
        rotated[c].push(old[r][c]);
      }
    }

    // Try placement: original position, then nudge left/right
    var offsets = [0, -1, 1, -2, 2];
    for (var i = 0; i < offsets.length; i++) {
      if (canPlaceShape(rotated, currentPiece.x + offsets[i], currentPiece.y)) {
        currentPiece.shape = rotated;
        currentPiece.x += offsets[i];
        return;
      }
    }
    // Rotation doesn't fit — do nothing (no punishment)
  }

  function slamPiece() {
    if (!gameRunning || !currentPiece || gamePaused) return;
    // Hard drop: move piece down as far as it can go
    while (tryMove(currentPiece, 0, 1)) { /* keep dropping */ }
    lockPiece(currentPiece);
    checkRows();
    currentPiece = spawnPiece();
    if (!canPlace(currentPiece, currentPiece.x, currentPiece.y)) {
      clearTopRows();
      currentPiece.y = 0;
    }
    dropTimer = 0;
  }

  function checkRows() {
    for (var r = ROWS - 1; r >= 0; r--) {
      var full = true;
      for (var c = 0; c < COLS; c++) {
        if (!grid[r][c]) { full = false; break; }
      }
      if (full) {
        // Add floating word at this row
        addFloatingWord(r);

        grid.splice(r, 1);
        var newRow = [];
        for (var c2 = 0; c2 < COLS; c2++) newRow.push(null);
        grid.unshift(newRow);
        rowsCleared++;
        r++;
      }
    }
  }

  function clearTopRows() {
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < COLS; c++) grid[r][c] = null;
    }
  }

  // ─── Floating words ─────────────────────────────────────
  function addFloatingWord(row) {
    var word = gameWords[wordIndex % gameWords.length];
    wordIndex++;
    floatingWords.push({
      text: word,
      y: row * CELL,
      alpha: 1.0,
      born: Date.now(),
    });
  }

  function updateFloatingWords(now) {
    for (var i = floatingWords.length - 1; i >= 0; i--) {
      var w = floatingWords[i];
      var age = now - w.born;
      if (age > 2000) {
        floatingWords.splice(i, 1);
      } else {
        w.alpha = 1 - (age / 2000);
        w.y -= 0.3;
      }
    }
  }

  // ─── Rendering ──────────────────────────────────────────
  function drawGame() {
    var ctx = gameCtx;
    var w = gameCanvas.width;
    var h = gameCanvas.height;

    // Background
    ctx.fillStyle = '#141820';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(37,42,56,0.25)';
    ctx.lineWidth = 0.5;
    for (var c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, h); ctx.stroke();
    }
    for (var r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(w, r * CELL); ctx.stroke();
    }

    // Placed blocks
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        if (grid[r2][c2]) drawBlock(ctx, c2, r2, grid[r2][c2], 1);
      }
    }

    // Current piece
    if (currentPiece && !gamePaused) {
      var s = currentPiece.shape;
      for (var pr = 0; pr < s.length; pr++) {
        for (var pc = 0; pc < s[pr].length; pc++) {
          if (s[pr][pc]) {
            drawBlock(ctx, currentPiece.x + pc, currentPiece.y + pr, currentPiece.color, 1);
          }
        }
      }
    }

    // Breathing overlay
    var cycle = breathTimer % (BREATH_IN + BREATH_OUT);
    var bp = cycle < BREATH_IN ? cycle / BREATH_IN : 1 - (cycle - BREATH_IN) / BREATH_OUT;
    var ga = 0.01 + bp * 0.03;
    ctx.fillStyle = 'rgba(122,158,142,' + ga + ')';
    ctx.fillRect(0, 0, w, h);

    // Floating words
    for (var fi = 0; fi < floatingWords.length; fi++) {
      var fw = floatingWords[fi];
      ctx.save();
      ctx.globalAlpha = fw.alpha * 0.8;
      ctx.font = '300 ' + Math.floor(CELL * 0.65) + 'px "Cormorant Garamond", Georgia, serif';
      ctx.fillStyle = '#c4a35a';
      ctx.textAlign = 'center';
      ctx.fillText(fw.text, w / 2, fw.y);
      ctx.restore();
    }
  }

  function drawBlock(ctx, x, y, color, alpha) {
    var px = x * CELL + 1;
    var py = y * CELL + 1;
    var s = CELL - 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(px, py, s, s, 3);
    } else {
      ctx.rect(px, py, s, s);
    }
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(px + 2, py + 2, s - 4, 1);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(px + 2, py + s - 1, s - 4, 1);

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════
  // PICKS
  // ═══════════════════════════════════════════════════════════

  function selectChip(type, chip) {
    var cid = type === 'interest' ? 'interestChips' : 'locationChips';
    each('#' + cid + ' .chip', function (c) { c.classList.remove('selected'); });
    chip.classList.add('selected');
    if (type === 'interest') selectedInterest = chip.getAttribute('data-value');
    else {
      selectedLocation = chip.getAttribute('data-value');
      var li = $('locationInput');
      if (li) li.value = '';
    }
    updateGoButton();
  }

  function updateGoButton() {
    var btn = $('goBtn');
    btn.disabled = !selectedInterest;
    if (selectedInterest && selectedLocation) btn.classList.add('pulse');
    else btn.classList.remove('pulse');
  }

  // ═══════════════════════════════════════════════════════════
  // PICKS → CHAT
  // ═══════════════════════════════════════════════════════════

  function submitPicks(skip) {
    if (stage === 'chat') return;
    userName = $('nameInput').value.trim() || 'friend';
    userName = userName.charAt(0).toUpperCase() + userName.slice(1);

    var li = $('locationInput');
    if (li && li.value.trim() && !selectedLocation) selectedLocation = li.value.trim();
    if (skip) {
      selectedInterest = selectedInterest || 'Anything';
      selectedLocation = selectedLocation || 'Anywhere';
    }
    if (!selectedInterest) selectedInterest = 'Anything';
    if (!selectedLocation) selectedLocation = detectedLocation || 'Anywhere';

    extraction.interest = selectedInterest.toLowerCase();
    extraction.location = selectedLocation;
    log('picks:', userName, extraction.interest, extraction.location);

    var pv = $('picksView');
    pv.style.opacity = '0';
    pv.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      pv.style.display = 'none';
      stage = 'chat';
      $('bigName').textContent = userName;
      $('chatView').classList.add('active');
      showThinking();

      callWorker(null, false, function (err, data) {
        removeThinking();
        if (err) {
          showError('Could not connect to the job search. ' + (err.message || err));
          enableInput();
          return;
        }

        cachedJobs = data.jobs || [];
        totalResults = data.totalResults || 0;
        searchUrl = data.searchUrl || '';
        lastSearchKey = extraction.interest + '|' + extraction.location;
        rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify({ message: data.message }) });

        animateSignal(data.signal || 25);
        updateResultsCount();

        addAssistantBubble(data.message || getFallback(), function () {
          showJobCards(data.showJobs || []);
          showSuggestions(data.suggestions);
          enableInput();
          updateCTA(data);
        });
      });
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════
  // WORKER
  // ═══════════════════════════════════════════════════════════

  function callWorker(userMessage, forceSearch, callback) {
    if (!WORKER) { callback(new Error('No worker URL configured'), null); return; }

    var controller = null, tid = null;
    try {
      controller = new AbortController();
      tid = setTimeout(function () { controller.abort(); }, TIMEOUT);
    } catch (e) {}

    var payload = {
      name: userName,
      interest_hint: extraction.interest,
      location_hint: extraction.location,
      history: rawHistory.slice(),
      forceSearch: !!forceSearch,
    };
    if (cachedJobs && !forceSearch) payload.cachedJobs = cachedJobs;

    var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    if (controller) opts.signal = controller.signal;

    fetch(WORKER + '/chat', opts)
      .then(function (r) { if (tid) clearTimeout(tid); if (!r.ok) throw new Error('Server ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.extraction) {
          extraction.interest = data.extraction.interest || extraction.interest;
          extraction.location = data.extraction.location || extraction.location;
        }
        if (data.jobs && data.jobs.length > 0) {
          cachedJobs = data.jobs;
          totalResults = data.totalResults || cachedJobs.length;
          searchUrl = data.searchUrl || searchUrl;
        }
        if (data.topPickJob) topPickJob = data.topPickJob;
        callback(null, data);
      })
      .catch(function (e) { if (tid) clearTimeout(tid); callback(e, null); });
  }

  function getFallback() {
    return userName + ', the system is connecting. Try sending a message.';
  }

  // ═══════════════════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════════════════

  function sendChat() {
    if (isWaiting) return;
    var input = $('chatInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendMessage(text);
  }

  function sendMessage(text) {
    if (isWaiting) return;
    isWaiting = true;

    addUserBubble(text);
    hideSuggestions();
    disableInput();
    rawHistory.push({ role: 'user', content: text });
    showThinking();

    var currentKey = extraction.interest + '|' + extraction.location;
    var needSearch = currentKey !== lastSearchKey;

    callWorker(text, needSearch, function (err, data) {
      removeThinking();
      if (err) {
        showError('Connection issue. Try again.');
        enableInput();
        isWaiting = false;
        return;
      }

      rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify({ message: data.message }) });
      signal = data.signal || signal;
      animateSignal(signal);
      updateResultsCount();
      lastSearchKey = extraction.interest + '|' + extraction.location;
      if (data.refineSearch) lastSearchKey = '';

      addAssistantBubble(data.message || 'Let me look into that...', function () {
        if (data.showJobs && data.showJobs.length > 0) showJobCards(data.showJobs);
        if (data.topPickJob) showFeaturedJob(data.topPickJob);
        showSuggestions(data.suggestions);
        enableInput();
        isWaiting = false;
        updateCTA(data);
      });
    });
  }

  // ─── Chat UI ────────────────────────────────────────────

  function addAssistantBubble(text, callback) {
    var area = $('chatArea');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant-bubble';

    var mark = document.createElement('span');
    mark.className = 'bmark';
    var btxt = document.createElement('span');
    btxt.className = 'btxt';
    var cur = document.createElement('span');
    cur.className = 'cur';

    bubble.appendChild(mark);
    bubble.appendChild(btxt);
    bubble.appendChild(cur);
    area.appendChild(bubble);
    scrollChat();

    var safe = text || '';
    var idx = 0;
    function type() {
      if (idx >= safe.length) {
        cur.remove();
        btxt.innerHTML = esc(safe).replace(
          new RegExp(esc(userName), 'g'),
          '<span class="hl">' + esc(userName) + '</span>'
        );
        if (callback) callback();
        return;
      }
      btxt.textContent = safe.substring(0, idx + 1);
      idx++;
      scrollChat();
      setTimeout(type, 12 + Math.random() * 14);
    }
    type();
  }

  function addUserBubble(text) {
    var area = $('chatArea');
    var b = document.createElement('div');
    b.className = 'chat-bubble user-bubble';
    b.textContent = text;
    area.appendChild(b);
    scrollChat();
  }

  function showError(msg) {
    var area = $('chatArea');
    var b = document.createElement('div');
    b.className = 'chat-bubble error-bubble';
    b.textContent = msg;
    area.appendChild(b);
    scrollChat();
  }

  function showThinking() {
    var area = $('chatArea');
    var el = document.createElement('div');
    el.className = 'chat-bubble assistant-bubble thinking';
    el.id = 'thinking';
    el.innerHTML = '<span class="bmark"></span><span class="dots"><span></span><span></span><span></span></span>';
    area.appendChild(el);
    scrollChat();
  }

  function removeThinking() {
    var el = $('thinking');
    if (el) el.remove();
  }

  // ─── Job Cards ──────────────────────────────────────────

  function showJobCards(jobs) {
    if (!jobs || !jobs.length) return;
    var area = $('chatArea');
    var container = document.createElement('div');
    container.className = 'job-cards';

    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      var card = document.createElement('a');
      card.className = 'job-card';
      card.href = j.applyUrl || j.url || '#';
      card.target = '_blank';
      card.rel = 'noopener';

      var salary = formatSalary(j.salaryMin, j.salaryMax, j.salaryPeriod);
      var meta = [];
      if (j.grade) meta.push(j.grade);
      if (j.schedule) meta.push(j.schedule);
      if (j.closing) meta.push('Closes ' + j.closing);

      card.innerHTML =
        '<div class="jc-title">' + esc(j.title) + '</div>' +
        '<div class="jc-org">' + esc(j.org || j.dept) + '</div>' +
        '<div class="jc-loc">' + esc(j.location) + '</div>' +
        (salary ? '<div class="jc-salary">' + esc(salary) + '</div>' : '') +
        (meta.length ? '<div class="jc-meta">' + esc(meta.join(' \u00b7 ')) + '</div>' : '') +
        '<div class="jc-apply">View &amp; Apply \u2192</div>';

      container.appendChild(card);
    }
    area.appendChild(container);
    scrollChat();
  }

  function showFeaturedJob(job) {
    if (!job) return;
    var area = $('chatArea');
    var card = document.createElement('a');
    card.className = 'featured-job';
    card.href = job.applyUrl || job.url || '#';
    card.target = '_blank';
    card.rel = 'noopener';

    var salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryPeriod);
    card.innerHTML =
      '<div class="fj-badge">top match</div>' +
      '<div class="fj-title">' + esc(job.title) + '</div>' +
      '<div class="fj-org">' + esc(job.org) + '</div>' +
      '<div class="fj-dept">' + esc(job.dept) + '</div>' +
      '<div class="fj-loc">' + esc(job.location) + '</div>' +
      (salary ? '<div class="fj-salary">' + esc(salary) + '</div>' : '') +
      (job.closing ? '<div class="fj-closing">Apply by ' + esc(job.closing) + '</div>' : '') +
      '<div class="fj-apply">APPLY NOW \u2192</div>';

    area.appendChild(card);
    scrollChat();
  }

  function formatSalary(min, max, period) {
    if (!min && !max) return '';
    var fmt = function (n) { var v = parseInt(n); return isNaN(v) ? n : '$' + v.toLocaleString('en-US'); };
    var range = min && max ? fmt(min) + ' \u2013 ' + fmt(max) : fmt(min || max);
    var per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '';
    return range + per;
  }

  // ─── Suggestions ────────────────────────────────────────

  function showSuggestions(chips) {
    var row = $('suggestRow');
    row.innerHTML = '';
    if (!chips || !chips.length) { row.classList.remove('visible'); return; }
    for (var i = 0; i < chips.length; i++) {
      (function (label) {
        var btn = document.createElement('button');
        btn.className = 'suggest-chip';
        btn.textContent = label;
        btn.addEventListener('click', function () { sendMessage(label); });
        row.appendChild(btn);
      })(chips[i]);
    }
    setTimeout(function () { row.classList.add('visible'); }, 100);
  }

  function hideSuggestions() { $('suggestRow').classList.remove('visible'); }

  // ─── Input ──────────────────────────────────────────────

  function enableInput() { $('chatInput').disabled = false; $('chatInput').focus(); $('chatSend').disabled = false; }
  function disableInput() { $('chatInput').disabled = true; $('chatSend').disabled = true; }

  // ─── Signal ─────────────────────────────────────────────

  function animateSignal(target) {
    var fill = $('signalFill'), pct = $('signalPct'), label = $('signalLabel');
    if (!fill || !pct) return;
    signal = target;
    var current = parseInt(pct.textContent) || 0;
    var start = Date.now(), dur = 1200;

    if (label) {
      if (target < 35) label.textContent = 'scanning';
      else if (target < 55) label.textContent = 'leads found';
      else if (target < 75) label.textContent = 'narrowing';
      else if (target < 90) label.textContent = 'match identified';
      else label.textContent = 'locked on target';
    }

    function tick() {
      var p = Math.min((Date.now() - start) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      var v = Math.floor(current + (target - current) * e);
      fill.style.width = v + '%';
      pct.textContent = v + '%';
      if (v < 40) fill.style.background = 'var(--gold)';
      else if (v < 70) fill.style.background = 'linear-gradient(90deg,var(--gold),var(--sage))';
      else fill.style.background = 'linear-gradient(90deg,var(--gold),var(--sage),var(--gold))';
      if (p < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  function updateResultsCount() {
    var el = $('resultsCount');
    if (!el) return;
    if (totalResults > 0) { el.textContent = totalResults.toLocaleString() + ' federal positions found'; el.style.display = 'block'; }
    else el.style.display = 'none';
  }

  // ─── CTA ────────────────────────────────────────────────

  function updateCTA(data) {
    var section = $('ctaSection'), btn = $('ctaBtn'), fine = $('ctaFine');
    section.classList.add('visible');

    if (data && data.topPickJob) {
      var job = data.topPickJob;
      btn.textContent = 'Apply: ' + job.title;
      btn.classList.add('hot');
      btn.setAttribute('data-url', job.applyUrl || job.url || '');
      if (fine) fine.textContent = job.org + ' \u00b7 ' + formatSalary(job.salaryMin, job.salaryMax, job.salaryPeriod);
    } else if (signal >= 60 && topPickJob) {
      btn.textContent = 'Apply: ' + topPickJob.title;
      btn.classList.add('hot');
      btn.setAttribute('data-url', topPickJob.applyUrl || topPickJob.url || '');
      if (fine) fine.textContent = topPickJob.org + ' \u00b7 ' + formatSalary(topPickJob.salaryMin, topPickJob.salaryMax, topPickJob.salaryPeriod);
    } else if (totalResults > 0) {
      btn.textContent = 'Browse all ' + totalResults.toLocaleString() + ' positions';
      btn.classList.remove('hot');
      btn.setAttribute('data-url', searchUrl);
      if (fine) fine.textContent = 'USAJobs.gov';
    } else {
      btn.textContent = 'Search USAJobs.gov';
      btn.classList.remove('hot');
      btn.setAttribute('data-url', 'https://www.usajobs.gov');
      if (fine) fine.textContent = 'verified federal positions';
    }
  }

  function goToApply() {
    var btn = $('ctaBtn');
    var url = btn.getAttribute('data-url');
    if (url) window.open(url, '_blank', 'noopener');
    else if (topPickJob) window.open(topPickJob.applyUrl || topPickJob.url, '_blank', 'noopener');
    else if (searchUrl) window.open(searchUrl, '_blank', 'noopener');
    else window.open('https://www.usajobs.gov', '_blank', 'noopener');
  }

  // ─── Geo ────────────────────────────────────────────────

  function detectLocation() {
    if (!WORKER) return;
    fetch(WORKER + '/geo')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.detected && d.locationString) {
          detectedLocation = d.locationString;
          injectDetectedChip(detectedLocation);
        }
      })
      .catch(function () {});
  }

  function injectDetectedChip(loc) {
    var c = $('locationChips');
    if (!c || c.querySelector('[data-detected]')) return;
    var chip = document.createElement('button');
    chip.className = 'chip detected';
    chip.setAttribute('data-value', loc);
    chip.setAttribute('data-detected', 'true');
    chip.textContent = loc;
    c.insertBefore(chip, c.firstChild);
    chip.addEventListener('click', function () { selectChip('location', chip); });
    setTimeout(function () { selectChip('location', chip); }, 300);
  }

  // ═══════════════════════════════════════════════════════════
  // TOOLTIP SYSTEM — citation bottom sheet
  // ═══════════════════════════════════════════════════════════

  function initTooltips() {
    var sheet = $('citeSheet');
    var title = $('citeTitle');
    var text = $('citeText');

    // Click any .cite to open sheet
    document.addEventListener('click', function (e) {
      var cite = e.target.closest('.cite');
      if (cite) {
        e.preventDefault();
        title.textContent = cite.getAttribute('data-title') || '';
        text.textContent = cite.getAttribute('data-cite') || '';
        sheet.classList.add('vis');
        return;
      }

      // Click dismiss or outside sheet
      if (e.target.id === 'citeDismiss' || (!e.target.closest('.cite-sheet') && sheet.classList.contains('vis'))) {
        sheet.classList.remove('vis');
      }
    });
  }

  // ─── Boot ───────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

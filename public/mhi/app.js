// ═══════════════════════════════════════════════════════════════
// MHI — Mental Health Intervention Search
// Landing → Breathing Game → Transition → Picks → Chat
// Evidence-based micro-intervention before job search.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var WORKER = window.__WORKER_URL__ || '';
  var TIMEOUT = 30000;
  var GAME_DURATION = 18000; // 18 seconds

  // ─── State ───────────────────────────────────────────────
  var currentTab = 'search';
  var stage = 'landing'; // landing → game → transition → picks → chat

  // Search state
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

  // Game state
  var gameRunning = false;
  var gameCanvas, gameCtx;
  var gameStartTime = 0;
  var gameAnimFrame = null;
  var breathPhase = 'in'; // 'in' or 'out'
  var breathTimer = 0;
  var BREATH_IN = 4000;  // 4 seconds inhale
  var BREATH_OUT = 4000; // 4 seconds exhale

  // Grid: 10 columns x 16 rows
  var COLS = 10, ROWS = 16;
  var CELL = 20; // pixel size per cell
  var grid = [];
  var currentPiece = null;
  var dropTimer = 0;
  var DROP_INTERVAL = 800; // ms per drop — synced to breathing
  var rowsCleared = 0;
  var gameWords = ['breathe', 'pause', "you're here", 'you matter', 'steady', 'ready'];
  var wordIndex = 0;

  // Piece shapes — simple, calming
  var PIECES = [
    { shape: [[1,1],[1,1]], color: '#f5a623' },           // square — warm amber
    { shape: [[1,1,1]], color: '#3ecfb4' },                // bar-3 — teal
    { shape: [[1,1,1,1]], color: '#5fa8e8' },              // bar-4 — sky
    { shape: [[1,1,0],[0,1,1]], color: '#e8758a' },        // S — rose
    { shape: [[0,1,1],[1,1,0]], color: '#7bc89c' },        // Z — sage
    { shape: [[1,0],[1,0],[1,1]], color: '#c084fc' },      // L — lavender
    { shape: [[0,1],[0,1],[1,1]], color: '#fbbf24' },      // J — gold
    { shape: [[1,1,1],[0,1,0]], color: '#f87171' },        // T — coral
  ];

  // Touch controls
  var touchStartX = 0;

  // ─── Helpers ──────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function each(sel, fn) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) fn(els[i]);
  }

  function log() {
    var args = ['[mhi]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function scrollChat() {
    var a = $('chatArea');
    if (a) a.scrollTop = a.scrollHeight;
  }

  // ─── Tab switching ─────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;
    each('.tab', function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });
    $('screenSearch').classList.toggle('hidden', tab !== 'search');
    $('screenAbout').classList.toggle('hidden', tab !== 'about');
    if (tab === 'about') {
      $('screenAbout').scrollTop = 0;
    }
  }

  // ─── Stage transitions ──────────────────────────────────────
  function showStage(name) {
    stage = name;
    $('stageLanding').classList.toggle('hidden', name !== 'landing');
    $('stageGame').classList.toggle('hidden', name !== 'game');
    $('stageTransition').classList.toggle('hidden', name !== 'transition');
    $('stageSearch').classList.toggle('hidden', name !== 'picks' && name !== 'chat');

    if (name === 'landing') {
      $('stageLanding').style.opacity = '1';
      $('stageLanding').style.display = '';
    }
    if (name === 'game') {
      $('stageGame').style.opacity = '1';
    }
    if (name === 'picks' || name === 'chat') {
      $('stageSearch').style.opacity = '1';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    log('init, worker:', WORKER || '(none)');

    // Tabs
    each('.tab', function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });

    // Landing
    $('beginBtn').addEventListener('click', startGame);
    $('skipToSearch').addEventListener('click', skipToSearch);

    // Transition
    $('readyBtn').addEventListener('click', function () { showStage('picks'); detectLocation(); });

    // Picks
    var ni = $('nameInput');
    ni.addEventListener('input', updateGoButton);
    ni.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPicks(); });

    each('#interestChips .chip', function (c) {
      c.addEventListener('click', function () { selectChip('interest', c); });
    });
    each('#locationChips .chip', function (c) {
      c.addEventListener('click', function () { selectChip('location', c); });
    });

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
    $('skipBtn').addEventListener('click', function () { submitPicks(true); });

    // Chat
    $('chatInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    $('chatSend').addEventListener('click', sendChat);
    $('ctaBtn').addEventListener('click', function (e) { e.preventDefault(); goToApply(); });

    // Game canvas setup
    gameCanvas = $('gameCanvas');
    gameCanvas.width = COLS * CELL;
    gameCanvas.height = ROWS * CELL;
    gameCtx = gameCanvas.getContext('2d');

    // Keyboard for game
    document.addEventListener('keydown', handleGameKey);

    // Touch controls for game
    gameCanvas.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    gameCanvas.addEventListener('touchend', function (e) {
      if (!gameRunning || !currentPiece) return;
      var endX = e.changedTouches[0].clientX;
      var diff = endX - touchStartX;
      if (Math.abs(diff) > 30) {
        movePiece(diff > 0 ? 1 : -1);
      } else {
        // Tap = drop faster
        dropPiece();
      }
    }, { passive: true });

    log('ready');
  }

  // ═══════════════════════════════════════════════════════════
  // GAME ENGINE — Breathing Tetris
  // ═══════════════════════════════════════════════════════════

  function startGame() {
    log('starting breathing game');
    showStage('game');
    setTimeout(function () {
      $('gameMessage').classList.add('visible');
    }, 300);

    // Init grid
    grid = [];
    for (var r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (var c = 0; c < COLS; c++) {
        grid[r][c] = null;
      }
    }

    rowsCleared = 0;
    wordIndex = 0;
    breathPhase = 'in';
    breathTimer = 0;
    dropTimer = 0;
    gameRunning = true;
    gameStartTime = Date.now();
    currentPiece = spawnPiece();

    gameLoop(Date.now());
  }

  function spawnPiece() {
    var def = PIECES[Math.floor(Math.random() * PIECES.length)];
    var shape = def.shape;
    var w = shape[0].length;
    return {
      shape: shape,
      color: def.color,
      x: Math.floor((COLS - w) / 2),
      y: 0,
    };
  }

  function gameLoop(lastTime) {
    if (!gameRunning) return;

    var now = Date.now();
    var dt = now - lastTime;
    var elapsed = now - gameStartTime;

    // Update timer bar
    var progress = Math.min(elapsed / GAME_DURATION, 1);
    $('gameTimerFill').style.width = (progress * 100) + '%';

    // Update breathing
    breathTimer += dt;
    var breathCycle = BREATH_IN + BREATH_OUT;
    var cyclePos = breathTimer % breathCycle;
    if (cyclePos < BREATH_IN) {
      if (breathPhase !== 'in') {
        breathPhase = 'in';
        $('breathGuide').innerHTML = '<em>breathe in</em>';
      }
    } else {
      if (breathPhase !== 'out') {
        breathPhase = 'out';
        $('breathGuide').innerHTML = '<em>breathe out</em>';
      }
    }

    // Drop piece
    dropTimer += dt;
    if (dropTimer >= DROP_INTERVAL) {
      dropTimer = 0;
      if (currentPiece) {
        if (!tryMove(currentPiece, 0, 1)) {
          // Lock piece
          lockPiece(currentPiece);
          checkRows();
          currentPiece = spawnPiece();
          // If new piece can't be placed, clear some space
          if (!canPlace(currentPiece, currentPiece.x, currentPiece.y)) {
            clearTopRows();
            currentPiece.y = 0;
          }
        }
      }
    }

    // Draw
    drawGame();

    // End check
    if (elapsed >= GAME_DURATION) {
      endGame();
      return;
    }

    gameAnimFrame = requestAnimationFrame(function () { gameLoop(now); });
  }

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
    var shape = piece.shape;
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          var gx = px + c;
          var gy = py + r;
          if (gx < 0 || gx >= COLS || gy >= ROWS) return false;
          if (gy >= 0 && grid[gy][gx]) return false;
        }
      }
    }
    return true;
  }

  function lockPiece(piece) {
    var shape = piece.shape;
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          var gy = piece.y + r;
          var gx = piece.x + c;
          if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) {
            grid[gy][gx] = piece.color;
          }
        }
      }
    }
  }

  function checkRows() {
    for (var r = ROWS - 1; r >= 0; r--) {
      var full = true;
      for (var c = 0; c < COLS; c++) {
        if (!grid[r][c]) { full = false; break; }
      }
      if (full) {
        // Remove row
        grid.splice(r, 1);
        var newRow = [];
        for (var c2 = 0; c2 < COLS; c2++) newRow.push(null);
        grid.unshift(newRow);
        rowsCleared++;
        r++; // Re-check this row index

        // Show a word
        showGameWord();
      }
    }
  }

  function clearTopRows() {
    // Gently clear the top 4 rows to make space — the game never punishes
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < COLS; c++) {
        grid[r][c] = null;
      }
    }
  }

  function showGameWord() {
    var word = gameWords[wordIndex % gameWords.length];
    wordIndex++;
    var el = $('gameWord');
    el.textContent = word;
    el.classList.add('visible');
    setTimeout(function () { el.classList.remove('visible'); }, 2000);
  }

  function movePiece(dx) {
    if (!gameRunning || !currentPiece) return;
    tryMove(currentPiece, dx, 0);
  }

  function dropPiece() {
    if (!gameRunning || !currentPiece) return;
    // Soft drop: move down one
    tryMove(currentPiece, 0, 1);
  }

  function handleGameKey(e) {
    if (!gameRunning || !currentPiece) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); movePiece(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); movePiece(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); dropPiece(); }
  }

  function drawGame() {
    var ctx = gameCtx;
    var w = gameCanvas.width;
    var h = gameCanvas.height;

    // Clear
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, w, h);

    // Draw grid lines (very subtle)
    ctx.strokeStyle = 'rgba(42,52,80,0.3)';
    ctx.lineWidth = 0.5;
    for (var c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, h);
      ctx.stroke();
    }
    for (var r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(w, r * CELL);
      ctx.stroke();
    }

    // Draw placed blocks
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        if (grid[r2][c2]) {
          drawBlock(ctx, c2, r2, grid[r2][c2]);
        }
      }
    }

    // Draw current piece
    if (currentPiece) {
      var shape = currentPiece.shape;
      for (var pr = 0; pr < shape.length; pr++) {
        for (var pc = 0; pc < shape[pr].length; pc++) {
          if (shape[pr][pc]) {
            drawBlock(ctx, currentPiece.x + pc, currentPiece.y + pr, currentPiece.color);
          }
        }
      }
    }

    // Breathing overlay — subtle pulsing glow
    var cyclePos = breathTimer % (BREATH_IN + BREATH_OUT);
    var breathProgress;
    if (cyclePos < BREATH_IN) {
      breathProgress = cyclePos / BREATH_IN;
    } else {
      breathProgress = 1 - (cyclePos - BREATH_IN) / BREATH_OUT;
    }
    var glowAlpha = 0.02 + breathProgress * 0.04;
    ctx.fillStyle = 'rgba(62,207,180,' + glowAlpha + ')';
    ctx.fillRect(0, 0, w, h);
  }

  function drawBlock(ctx, x, y, color) {
    var px = x * CELL;
    var py = y * CELL;
    var s = CELL - 1;

    // Block body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(px + 0.5, py + 0.5, s, s, 3);
    ctx.fill();

    // Subtle inner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(px + 2, py + 2, s - 4, 2);

    // Subtle shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(px + 2, py + s - 2, s - 4, 1);
  }

  function endGame() {
    gameRunning = false;
    if (gameAnimFrame) cancelAnimationFrame(gameAnimFrame);
    log('game ended, rows cleared:', rowsCleared);

    // Fade game out
    $('stageGame').style.transition = 'opacity 0.8s';
    $('stageGame').style.opacity = '0';

    setTimeout(function () {
      showStage('transition');
    }, 800);
  }

  function skipToSearch() {
    log('skipping to search');
    showStage('picks');
    detectLocation();
  }

  // ═══════════════════════════════════════════════════════════
  // PICKS
  // ═══════════════════════════════════════════════════════════

  function selectChip(type, chip) {
    if (navigator.vibrate) navigator.vibrate(10);
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

    if (navigator.vibrate) navigator.vibrate(15);
    extraction.interest = selectedInterest.toLowerCase();
    extraction.location = selectedLocation;

    log('submitting picks:', userName, extraction.interest, extraction.location);

    // Fade out picks → show chat
    var pv = $('picksView');
    pv.style.opacity = '0';
    pv.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      pv.style.display = 'none';
      stage = 'chat';
      $('bigName').textContent = userName;
      $('chatView').classList.add('active');

      showThinking();

      log('calling worker for first message...');
      callWorker(null, false, function (err, data) {
        removeThinking();

        if (err) {
          log('worker error on first call:', err);
          showError('Could not connect to the job search. ' + (err.message || err));
          enableInput();
          return;
        }

        log('worker response:', data.message ? data.message.substring(0, 80) + '...' : '(no message)');

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
  // WORKER CALL
  // ═══════════════════════════════════════════════════════════

  function callWorker(userMessage, forceSearch, callback) {
    if (!WORKER) {
      log('no worker URL configured');
      callback(new Error('No worker URL configured'), null);
      return;
    }

    var controller = null;
    var timeoutId = null;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(function () {
        log('request timed out');
        controller.abort();
      }, TIMEOUT);
    } catch (e) {
      log('AbortController not supported');
    }

    var payload = {
      name: userName,
      interest_hint: extraction.interest,
      location_hint: extraction.location,
      history: rawHistory.slice(),
      forceSearch: !!forceSearch,
    };

    if (cachedJobs && !forceSearch) {
      payload.cachedJobs = cachedJobs;
    }

    log('POST /chat', { name: payload.name, interest: payload.interest_hint, location: payload.location_hint });

    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    if (controller) opts.signal = controller.signal;

    fetch(WORKER + '/chat', opts)
      .then(function (r) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
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
        if (data.topPickJob) {
          topPickJob = data.topPickJob;
        }
        callback(null, data);
      })
      .catch(function (e) {
        if (timeoutId) clearTimeout(timeoutId);
        log('fetch error:', e.message || e);
        callback(e, null);
      });
  }

  function getFallback() {
    return userName + ', the system is connecting. Try sending a message \u2014 the job database has thousands of federal positions waiting.';
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
    if (navigator.vibrate) navigator.vibrate(10);

    addUserBubble(text);
    hideSuggestions();
    disableInput();
    rawHistory.push({ role: 'user', content: text });
    showThinking();

    log('sending message:', text);

    var currentKey = extraction.interest + '|' + extraction.location;
    var needSearch = currentKey !== lastSearchKey;

    callWorker(text, needSearch, function (err, data) {
      removeThinking();

      if (err) {
        showError('Connection issue \u2014 try sending your message again.');
        enableInput();
        isWaiting = false;
        return;
      }

      rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify({ message: data.message }) });

      signal = data.signal || signal;
      animateSignal(signal);
      updateResultsCount();
      lastSearchKey = extraction.interest + '|' + extraction.location;

      if (data.refineSearch) {
        lastSearchKey = '';
      }

      addAssistantBubble(data.message || 'Let me look into that...', function () {
        if (data.showJobs && data.showJobs.length > 0) {
          showJobCards(data.showJobs);
        }
        if (data.topPickJob) {
          showFeaturedJob(data.topPickJob);
        }
        showSuggestions(data.suggestions);
        enableInput();
        isWaiting = false;
        updateCTA(data);
      });
    });
  }

  // ─── Chat UI ──────────────────────────────────────────────

  function addAssistantBubble(text, callback) {
    var area = $('chatArea');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant-bubble';

    var mark = document.createElement('span');
    mark.className = 'bmark';
    mark.innerHTML = '&#x2728;';
    var btxt = document.createElement('span');
    btxt.className = 'btxt';
    var cur = document.createElement('span');
    cur.className = 'cur';

    bubble.appendChild(mark);
    bubble.appendChild(btxt);
    bubble.appendChild(cur);
    area.appendChild(bubble);
    scrollChat();

    var safeText = text || '';
    var i = 0;

    function type() {
      if (i >= safeText.length) {
        cur.remove();
        btxt.innerHTML = esc(safeText).replace(
          new RegExp(esc(userName), 'g'),
          '<span class="hl">' + esc(userName) + '</span>'
        );
        if (callback) callback();
        return;
      }
      btxt.textContent = safeText.substring(0, i + 1);
      i++;
      scrollChat();
      setTimeout(type, 10 + Math.random() * 14);
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
    el.innerHTML = '<span class="bmark">&#x2728;</span><span class="dots"><span>.</span><span>.</span><span>.</span></span>';
    area.appendChild(el);
    scrollChat();
  }

  function removeThinking() {
    var el = $('thinking');
    if (el) el.remove();
  }

  // ─── Job Cards ────────────────────────────────────────────

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
      '<div class="fj-badge">&#x2728; TOP MATCH</div>' +
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
    var fmt = function (n) {
      var num = parseInt(n);
      return isNaN(num) ? n : '$' + num.toLocaleString('en-US');
    };
    var range = min && max ? fmt(min) + ' \u2013 ' + fmt(max) : fmt(min || max);
    var per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '';
    return range + per;
  }

  // ─── Suggestions ──────────────────────────────────────────

  function showSuggestions(chips) {
    var row = $('suggestRow');
    row.innerHTML = '';
    if (!chips || !chips.length) {
      row.classList.remove('visible');
      return;
    }
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

  function hideSuggestions() {
    $('suggestRow').classList.remove('visible');
  }

  // ─── Input ────────────────────────────────────────────────

  function enableInput() {
    $('chatInput').disabled = false;
    $('chatInput').focus();
    $('chatSend').disabled = false;
  }

  function disableInput() {
    $('chatInput').disabled = true;
    $('chatSend').disabled = true;
  }

  // ─── Signal ───────────────────────────────────────────────

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
      if (v < 40) fill.style.background = 'var(--warm)';
      else if (v < 70) fill.style.background = 'linear-gradient(90deg,var(--warm),var(--green))';
      else fill.style.background = 'linear-gradient(90deg,var(--warm),var(--green),var(--gold))';
      if (p < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  // ─── Results Count ────────────────────────────────────────

  function updateResultsCount() {
    var el = $('resultsCount');
    if (!el) return;
    if (totalResults > 0) {
      el.textContent = totalResults.toLocaleString() + ' federal positions found';
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  // ─── CTA ──────────────────────────────────────────────────

  function updateCTA(data) {
    var section = $('ctaSection');
    var btn = $('ctaBtn');
    var fine = $('ctaFine');

    section.classList.add('visible');

    if (data && data.topPickJob) {
      var job = data.topPickJob;
      btn.textContent = 'APPLY: ' + job.title + ' \u2192';
      btn.classList.add('hot');
      btn.setAttribute('data-url', job.applyUrl || job.url || '');
      if (fine) fine.textContent = job.org + ' \u00b7 ' + formatSalary(job.salaryMin, job.salaryMax, job.salaryPeriod);
    } else if (signal >= 60 && topPickJob) {
      btn.textContent = 'APPLY: ' + topPickJob.title + ' \u2192';
      btn.classList.add('hot');
      btn.setAttribute('data-url', topPickJob.applyUrl || topPickJob.url || '');
      if (fine) fine.textContent = topPickJob.org + ' \u00b7 ' + formatSalary(topPickJob.salaryMin, topPickJob.salaryMax, topPickJob.salaryPeriod);
    } else if (totalResults > 0) {
      btn.textContent = 'Browse all ' + totalResults.toLocaleString() + ' positions \u2192';
      btn.classList.remove('hot');
      btn.setAttribute('data-url', searchUrl);
      if (fine) fine.textContent = 'USAJobs.gov \u00b7 keep chatting to find your match';
    } else {
      btn.textContent = 'Search USAJobs.gov \u2192';
      btn.classList.remove('hot');
      btn.setAttribute('data-url', 'https://www.usajobs.gov');
      if (fine) fine.textContent = 'federal positions \u00b7 verified \u00b7 real';
    }
  }

  // ─── Apply ────────────────────────────────────────────────

  function goToApply() {
    var btn = $('ctaBtn');
    var url = btn.getAttribute('data-url');
    if (url) window.open(url, '_blank', 'noopener');
    else if (topPickJob) window.open(topPickJob.applyUrl || topPickJob.url, '_blank', 'noopener');
    else if (searchUrl) window.open(searchUrl, '_blank', 'noopener');
    else window.open('https://www.usajobs.gov', '_blank', 'noopener');
  }

  // ─── Geo ──────────────────────────────────────────────────

  function detectLocation() {
    if (!WORKER) return;
    fetch(WORKER + '/geo')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.detected && d.locationString) {
          log('detected location:', d.locationString);
          detectedLocation = d.locationString;
          injectDetectedChip(detectedLocation);
        }
      })
      .catch(function (e) { log('geo detection failed:', e.message); });
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
    setTimeout(function () {
      selectChip('location', chip);
      chip.style.animation = 'popIn .4s ease both';
    }, 300);
  }

  // ─── Boot ─────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

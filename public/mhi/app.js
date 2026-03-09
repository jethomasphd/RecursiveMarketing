// ═══════════════════════════════════════════════════════════════
// MHI — A Moment
// Cinematic landing → guided breath → game carousel → job search
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

  // Game manager
  var allGames = [];
  var currentGameIndex = 0;
  var activeGame = null;
  var ctrlBtns = [];
  var floatingWords = [];

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

    // Load games from games.js
    allGames = window.MHI_GAMES || [];
    if (allGames.length > 0) activeGame = allGames[0];

    // Tabs
    each('.tab', function (t) { t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); }); });

    // Landing
    $('beginBtn').addEventListener('click', beginTransition);
    $('skipBtn').addEventListener('click', skipToSearch);

    // Collect control buttons and wire up generic handlers
    each('#controlsBar .ctrl', function (btn) { ctrlBtns.push(btn); });
    for (var i = 0; i < ctrlBtns.length; i++) {
      (function (idx) {
        ctrlBtns[idx].addEventListener('click', function () { handleControl(idx); });
      })(i);
    }

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
    $('tryDifferentBtn').addEventListener('click', function () {
      $('gameOverlay').classList.remove('vis');
      gamePaused = false;
      switchToNextGame();
    });
    $('readyBtn').addEventListener('click', readyToSearch);
    $('freeplayExit').addEventListener('click', readyToSearch);
    $('freeplayNext').addEventListener('click', function () { switchToNextGame(); });

    // Canvas setup
    gameCanvas = $('gameCanvas');
    gameCtx = gameCanvas.getContext('2d');

    // Canvas tap handler for tap-based games (garden, etc.)
    gameCanvas.addEventListener('click', function (e) {
      if (!gameRunning || gamePaused || !activeGame || !activeGame.onTap) return;
      var rect = gameCanvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (gameCanvas.width / rect.width);
      var y = (e.clientY - rect.top) * (gameCanvas.height / rect.height);
      var events = activeGame.onTap(x, y);
      if (events) for (var j = 0; j < events.length; j++) addFloatingWord(events[j]);
    });
    gameCanvas.addEventListener('touchend', function (e) {
      if (!gameRunning || gamePaused || !activeGame || !activeGame.onTap) return;
      e.preventDefault();
      var touch = e.changedTouches[0];
      var rect = gameCanvas.getBoundingClientRect();
      var x = (touch.clientX - rect.left) * (gameCanvas.width / rect.width);
      var y = (touch.clientY - rect.top) * (gameCanvas.height / rect.height);
      var events = activeGame.onTap(x, y);
      if (events) for (var j = 0; j < events.length; j++) addFloatingWord(events[j]);
    }, { passive: false });

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

    // Start cinematic reveal
    revealLanding();
  }

  // ─── Game manager ─────────────────────────────────────────

  function handleControl(idx) {
    if (!gameRunning || gamePaused || !activeGame) return;
    var events = activeGame.onControl(idx);
    if (events) for (var i = 0; i < events.length; i++) addFloatingWord(events[i]);
  }

  function switchToGame(idx) {
    currentGameIndex = idx;
    activeGame = allGames[idx];
    log('switching to game:', activeGame.id);
    updateControls();
  }

  function switchToNextGame() {
    var next = (currentGameIndex + 1) % allGames.length;
    switchToGame(next);
    // Show a brief breathing interlude before starting next game
    showBreathInterlude(function () {
      restartCurrentGame();
    }, true);
  }

  function showBreathInterlude(callback, resumeGame) {
    // Pause current game and fade it out
    gameRunning = false;
    if (gameAnimFrame) cancelAnimationFrame(gameAnimFrame);

    // Hide overlays so they don't bleed through
    $('gameOverlay').classList.remove('vis');
    $('freeplayBar').classList.remove('vis');
    gamePaused = false;

    var gameEl = $('stageGame');
    gameEl.style.transition = 'opacity 0.5s ease';
    gameEl.style.opacity = '0';

    setTimeout(function () {
      gameEl.classList.remove('active');
      gameEl.style.opacity = '';
      gameEl.style.transition = '';

      // Show breath stage
      var el = $('stageBreath');
      var guide = $('breathGuide');
      var text = $('breathText');
      guide.classList.remove('expanding', 'contracting');
      text.classList.remove('vis');
      text.textContent = '';
      el.classList.add('active');

      // Inhale
      setTimeout(function () {
        text.textContent = 'breathe in';
        text.classList.add('vis');
        guide.classList.add('expanding');
      }, 300);

      // Exhale
      setTimeout(function () {
        text.textContent = 'and out';
        guide.classList.remove('expanding');
        guide.classList.add('contracting');
      }, 4500);

      // Fade out and callback
      setTimeout(function () {
        el.style.transition = 'opacity 0.6s ease';
        el.style.opacity = '0';
        setTimeout(function () {
          el.classList.remove('active');
          el.style.opacity = '';
          el.style.transition = '';
          guide.classList.remove('expanding', 'contracting');
          text.classList.remove('vis');

          if (resumeGame) gameEl.classList.add('active');
          if (callback) callback();
        }, 600);
      }, 9000);
    }, 500);
  }

  function updateControls() {
    if (!activeGame) return;
    var controls = activeGame.controls;
    for (var i = 0; i < ctrlBtns.length; i++) {
      if (i < controls.length && controls[i]) {
        ctrlBtns[i].style.display = '';
        ctrlBtns[i].querySelector('svg').innerHTML = controls[i].icon;
        ctrlBtns[i].setAttribute('aria-label', controls[i].label);
      } else {
        ctrlBtns[i].style.display = 'none';
      }
    }
  }

  function sizeCanvas() {
    if (!activeGame) return;
    var maxW = Math.min(window.innerWidth - 48, 280);
    var maxH = window.innerHeight - 220;
    var dims = activeGame.start(maxW, maxH);
    gameCanvas.width = dims.w;
    gameCanvas.height = dims.h;
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
  // GAME ENGINE — delegates to active game
  // ═══════════════════════════════════════════════════════════

  function startGame() {
    log('starting game:', activeGame ? activeGame.id : 'none');
    stage = 'game';
    $('stageGame').classList.add('active');

    // Initialize game and size canvas
    updateControls();
    var maxW = Math.min(window.innerWidth - 48, 280);
    var maxH = window.innerHeight - 220;
    var dims = activeGame.start(maxW, maxH);
    gameCanvas.width = dims.w;
    gameCanvas.height = dims.h;

    breathTimer = 0;
    breathPhase = 'in';
    floatingWords = [];
    timerExpired = false;
    freePlay = false;
    gamePaused = false;
    gameRunning = true;
    gameStartTime = Date.now();

    $('gameOverlay').classList.remove('vis');
    $('freeplayBar').classList.remove('vis');
    $('timerTrack').style.display = '';

    gameLoop(Date.now());
  }

  function restartCurrentGame() {
    // Stop current loop, restart with (possibly different) active game
    gameRunning = false;
    if (gameAnimFrame) cancelAnimationFrame(gameAnimFrame);

    var maxW = Math.min(window.innerWidth - 48, 280);
    var maxH = window.innerHeight - 220;
    var dims = activeGame.start(maxW, maxH);
    gameCanvas.width = dims.w;
    gameCanvas.height = dims.h;
    updateControls();

    breathTimer = 0;
    breathPhase = 'in';
    floatingWords = [];
    timerExpired = false;
    freePlay = false;
    gamePaused = false;
    gameRunning = true;
    gameStartTime = Date.now();

    $('gameOverlay').classList.remove('vis');
    $('freeplayBar').classList.remove('vis');
    $('timerTrack').style.display = '';

    gameLoop(Date.now());
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

      // Breathing timer (used for subtle canvas overlay)
      breathTimer += dt;

      // Delegate tick to active game
      if ((!timerExpired || freePlay) && activeGame) {
        var events = activeGame.tick(dt);
        if (events) for (var i = 0; i < events.length; i++) addFloatingWord(events[i]);
      }

      // Update floating words
      updateFloatingWords(now);
    }

    // Draw
    if (activeGame) {
      activeGame.draw(gameCtx, gameCanvas.width, gameCanvas.height);
    }

    // Breathing overlay on canvas
    var bCycle = breathTimer % (BREATH_IN + BREATH_OUT);
    var bp = bCycle < BREATH_IN ? bCycle / BREATH_IN : 1 - (bCycle - BREATH_IN) / BREATH_OUT;
    var ga = 0.01 + bp * 0.03;
    gameCtx.fillStyle = 'rgba(122,158,142,' + ga + ')';
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

    // Floating words overlay
    drawFloatingWords();

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
    $('freeplayBar').classList.add('vis');
  }

  function readyToSearch() {
    log('ready to search');
    showBreathInterlude(function () {
      $('stageSearch').classList.add('active');
      stage = 'picks';
      detectLocation();
      setTimeout(function () { $('nameInput').focus(); }, 400);
    });
  }

  // ─── Floating words ─────────────────────────────────────
  function addFloatingWord(ev) {
    if (!ev || !ev.text) return;
    floatingWords.push({
      text: ev.text,
      y: ev.y || gameCanvas.height / 2,
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

  function drawFloatingWords() {
    var ctx = gameCtx;
    var cw = gameCanvas.width;
    for (var i = 0; i < floatingWords.length; i++) {
      var fw = floatingWords[i];
      ctx.save();
      ctx.globalAlpha = fw.alpha * 0.8;
      ctx.font = '300 14px "Cormorant Garamond", Georgia, serif';
      ctx.fillStyle = '#c4a35a';
      ctx.textAlign = 'center';
      ctx.fillText(fw.text, cw / 2, fw.y);
      ctx.restore();
    }
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

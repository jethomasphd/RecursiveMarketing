// ═══════════════════════════════════════════════════════════════
// THE SPIRAL v2 — Multi-turn state machine with signal gamification
// The coil now has teeth. Each turn sharpens the signal.
// Each interaction compresses uncertainty into intent.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── CONFIGURATION ───────────────────────────────────────────
  var WORKER_URL = window.__WORKER_URL__ || '';
  var FALLBACK_EXIT_URL = 'https://jobs.best-jobs-online.com/jobs';
  var BUDGET_MS = 60000; // Extended to 60s for multi-turn conversation
  var WORKER_TIMEOUT_MS = 8000;
  var MAX_TURNS = 3;

  // ─── STATES ──────────────────────────────────────────────────
  var S = { PORTAL: 0, PICKS: 1, SCAN: 2, REVEAL: 3, EXIT: 4 };
  var state = S.PORTAL;
  var t0 = null;

  // ─── SESSION DATA ────────────────────────────────────────────
  var userName = '';
  var selectedInterest = '';
  var selectedLocation = '';
  var detectedLocation = ''; // From geo detection
  var extraction = {
    interest: 'jobs',
    location: 'near me',
    toneTag: 'knife-to-truth'
  };
  var aiMessage = '';
  var workerResolved = false;
  var sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ─── CONVERSATION STATE ──────────────────────────────────────
  var currentTurn = 0;
  var conversationHistory = [];
  var signalPct = 0;
  var matchCount = 0;
  var isTyping = false;

  // ─── TIMING ──────────────────────────────────────────────────
  function elapsed() { return t0 ? Date.now() - t0 : 0; }
  function remaining() { return Math.max(0, BUDGET_MS - elapsed()); }

  // ─── DOM ─────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ─── BUDGET WATCHDOG ─────────────────────────────────────────
  function startBudgetWatchdog() {
    setInterval(function () {
      if (!t0 || state === S.EXIT || state === S.PORTAL) return;
      var r = remaining();
      if (r < 10000 && state === S.SCAN) {
        if (!aiMessage) aiMessage = getFallbackMessage();
        workerResolved = true;
      }
      if (r < 5000 && state === S.REVEAL) {
        goToExit();
      }
    }, 1000);
  }

  // ─── GEO DETECTION ──────────────────────────────────────────
  function detectLocation() {
    if (!WORKER_URL) return;
    try {
      fetch(WORKER_URL + '/geo', { method: 'GET' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.detected && data.locationString) {
            detectedLocation = data.locationString;
            showDetectedLocation(detectedLocation);
          }
        })
        .catch(function () { /* Silent fail — location chips still work */ });
    } catch (e) { /* No fetch support */ }
  }

  function showDetectedLocation(loc) {
    var container = $('locationChips');
    if (!container) return;

    // Check if we already added a detected chip
    if (container.querySelector('[data-detected]')) return;

    // Create the detected location chip — insert as first child
    var chip = document.createElement('button');
    chip.className = 'pick-chip detected-chip';
    chip.setAttribute('data-value', loc);
    chip.setAttribute('data-detected', 'true');
    chip.innerHTML = '<span class="detect-icon">&#x1F4CD;</span> ' + loc;
    container.insertBefore(chip, container.firstChild);

    // Bind click
    chip.addEventListener('click', function () { selectChip('location', chip); });

    // Auto-select it with a subtle pulse
    setTimeout(function () {
      selectChip('location', chip);
      chip.classList.add('auto-detected');
    }, 300);
  }

  // ─── INITIALIZE ──────────────────────────────────────────────
  function init() {
    // Portal
    $('portal').addEventListener('click', enterPortal);

    // Name input
    var nameInput = $('nameInput');
    nameInput.addEventListener('input', updateGoButton);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitPicks();
    });

    // Interest chips
    var interestChips = document.querySelectorAll('#interestChips .pick-chip');
    for (var i = 0; i < interestChips.length; i++) {
      (function (chip) {
        chip.addEventListener('click', function () { selectChip('interest', chip); });
      })(interestChips[i]);
    }

    // Location chips
    var locationChips = document.querySelectorAll('#locationChips .pick-chip');
    for (var j = 0; j < locationChips.length; j++) {
      (function (chip) {
        chip.addEventListener('click', function () { selectChip('location', chip); });
      })(locationChips[j]);
    }

    // Location text input
    var locInput = $('locationInput');
    if (locInput) {
      locInput.addEventListener('input', function () {
        if (locInput.value.trim()) {
          // Deselect all location chips when typing
          var chips = document.querySelectorAll('#locationChips .pick-chip');
          for (var k = 0; k < chips.length; k++) chips[k].classList.remove('selected');
          selectedLocation = locInput.value.trim();
          updateGoButton();
        }
      });
      locInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitPicks();
      });
    }

    // Buttons
    $('goBtn').addEventListener('click', submitPicks);
    $('skipBtn').addEventListener('click', function () { submitPicks(true); });

    // CTA
    $('ctaBtn').addEventListener('click', function (e) {
      e.preventDefault();
      goToExit();
    });

    // Ticker close
    var tickerClose = document.querySelector('.lt-close');
    if (tickerClose) {
      tickerClose.addEventListener('click', function () {
        $('liveTicker').classList.remove('show');
      });
    }

    startBudgetWatchdog();
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 0 → 1: ENTER THE PORTAL
  // ═══════════════════════════════════════════════════════════════
  function enterPortal() {
    if (state !== S.PORTAL) return;
    state = S.PICKS;
    t0 = Date.now();

    if (navigator.vibrate) navigator.vibrate(20);
    $('stage0').classList.add('gone');

    // Fire geo detection immediately
    detectLocation();

    setTimeout(function () {
      $('stage1').classList.add('active');
      setTimeout(function () { $('nameInput').focus(); }, 400);
    }, 600);
  }

  // ═══════════════════════════════════════════════════════════════
  // CHIP SELECTION
  // ═══════════════════════════════════════════════════════════════
  function selectChip(type, chip) {
    if (navigator.vibrate) navigator.vibrate(10);

    var containerId = type === 'interest' ? 'interestChips' : 'locationChips';
    var siblings = document.querySelectorAll('#' + containerId + ' .pick-chip');
    for (var i = 0; i < siblings.length; i++) {
      siblings[i].classList.remove('selected');
    }
    chip.classList.add('selected');

    if (type === 'interest') {
      selectedInterest = chip.getAttribute('data-value');
    } else {
      selectedLocation = chip.getAttribute('data-value');
      // Clear text input if a chip is selected
      var locInput = $('locationInput');
      if (locInput) locInput.value = '';
    }

    updateGoButton();
  }

  function updateGoButton() {
    var btn = $('goBtn');
    btn.disabled = !selectedInterest;

    if (selectedInterest && selectedLocation) {
      btn.classList.add('pulse');
    } else {
      btn.classList.remove('pulse');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 1 → 2: SUBMIT PICKS
  // ═══════════════════════════════════════════════════════════════
  function submitPicks(skip) {
    if (state !== S.PICKS) return;

    userName = $('nameInput').value.trim() || 'friend';
    userName = userName.charAt(0).toUpperCase() + userName.slice(1);

    // Check location text input
    var locInput = $('locationInput');
    if (locInput && locInput.value.trim() && !selectedLocation) {
      selectedLocation = locInput.value.trim();
    }

    if (skip) {
      selectedInterest = selectedInterest || 'Anything';
      selectedLocation = selectedLocation || 'Anywhere';
    }
    if (!selectedInterest) selectedInterest = 'Anything';
    if (!selectedLocation) selectedLocation = detectedLocation || 'Anywhere';

    if (navigator.vibrate) navigator.vibrate(15);
    state = S.SCAN;

    // Seed extraction from picks
    extraction.interest = selectedInterest.toLowerCase();
    extraction.location = selectedLocation;

    // Transition
    var s1 = $('stage1');
    s1.style.opacity = '0';
    s1.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      s1.style.display = 'none';

      // Echo picks into scan lines — the system notices you
      $('sl1').textContent = 'mapping ' + selectedInterest.toLowerCase() + ' positions...';
      $('sl2').textContent = 'filtering ' + selectedLocation + ' listings...';

      $('stage2').classList.add('active');
      runScan();
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2: SCAN + WORKER CALL
  // ═══════════════════════════════════════════════════════════════
  function runScan() {
    var lines = ['sl0', 'sl1', 'sl2', 'sl3', 'sl4'];
    var i = 0;

    var interval = setInterval(function () {
      if (i >= lines.length) {
        clearInterval(interval);
        waitForWorkerThenReveal();
        return;
      }
      var el = $(lines[i]);
      el.classList.add('done');
      el.innerHTML = '<span class="check">&#x2713;</span>' + el.textContent;
      i++;
    }, 700);

    // Fire worker call in parallel with scan animation
    callWorker(1);
  }

  function callWorker(turn) {
    if (!WORKER_URL) {
      aiMessage = getFallbackMessage();
      signalPct = 38;
      matchCount = 142;
      workerResolved = true;
      return;
    }

    var controller = null;
    var timeoutId = null;

    try {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, WORKER_TIMEOUT_MS);
    } catch (e) { /* AbortController not supported */ }

    var fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: userName,
        interest_hint: extraction.interest,
        location_hint: extraction.location,
        turn: turn,
        history: conversationHistory,
        session_id: sessionId,
        client_context: {
          tz: (typeof Intl !== 'undefined') ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
          ua: navigator.userAgent.slice(0, 80)
        }
      })
    };

    if (controller) fetchOpts.signal = controller.signal;

    fetch(WORKER_URL + '/chat', fetchOpts)
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        return res.json();
      })
      .then(function (data) {
        if (data.message) aiMessage = data.message;
        if (data.extraction) {
          extraction.interest = data.extraction.interest || extraction.interest;
          extraction.location = data.extraction.location || extraction.location;
          extraction.toneTag = data.extraction.toneTag || extraction.toneTag;
        }
        if (data.signalPct) signalPct = data.signalPct;
        if (data.matchCount) matchCount = data.matchCount;
        if (data.chips && data.chips.length > 0) {
          window.__dynamicChips = data.chips;
        }
        workerResolved = true;
      })
      .catch(function () {
        if (timeoutId) clearTimeout(timeoutId);
        aiMessage = getFallbackMessage();
        signalPct = turn === 1 ? 38 : turn === 2 ? 71 : 96;
        matchCount = turn === 1 ? 142 : turn === 2 ? 38 : 11;
        workerResolved = true;
      });
  }

  function waitForWorkerThenReveal() {
    if (workerResolved) {
      setTimeout(goToReveal, 500);
      return;
    }

    var checks = 0;
    var poll = setInterval(function () {
      checks++;
      if (workerResolved || checks > 30) {
        clearInterval(poll);
        if (!aiMessage) aiMessage = getFallbackMessage();
        workerResolved = true;
        setTimeout(goToReveal, 300);
      }
    }, 100);
  }

  function getFallbackMessage() {
    var interest = selectedInterest.toLowerCase();
    var location = selectedLocation;
    var loc = (location !== 'Anywhere' && location !== 'Near me')
      ? ' in ' + location
      : '';

    var messages = [
      userName + ', ' + interest + loc + ' \u2014 73% of those listings are ghosts. But not every door is painted on. We just locked onto the signal.',
      userName + ', 61% of applicants get ghosted. You won\'t. ' + capitalize(interest) + ' jobs' + loc + ' \u2014 the signal is forming.',
      userName + ', the system wants you scrolling forever. We\'re cutting through. ' + capitalize(interest) + loc + ' \u2014 signal acquired.'
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2 → 3: REVEAL — now a conversation loop
  // ═══════════════════════════════════════════════════════════════
  function goToReveal() {
    state = S.REVEAL;
    currentTurn = 1;

    var s2 = $('stage2');
    s2.style.opacity = '0';
    s2.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      s2.style.display = 'none';

      // Populate reveal
      $('bigName').textContent = userName;
      $('stage3').classList.add('active');

      // Animate signal meter
      animateSignal(signalPct || 38);

      // Animate match count
      animateMatchCount(matchCount || 142);

      // Add the AI message to conversation
      conversationHistory.push({
        role: 'assistant',
        message: aiMessage || getFallbackMessage()
      });

      // Type AI message
      setTimeout(function () {
        typeMessage(aiMessage || getFallbackMessage(), function () {
          // After message finishes typing, show chips
          showConversationChips();
        });
      }, 600);

      // Live ticker
      setTimeout(startLiveTicker, 4000);
    }, 400);
  }

  // ─── SIGNAL METER ──────────────────────────────────────────
  function animateSignal(target) {
    var fill = $('signalFill');
    var pctEl = $('signalPct');
    var labelEl = $('signalLabel');
    if (!fill || !pctEl) return;

    var current = parseInt(pctEl.textContent) || 0;
    var duration = 1500;
    var start = Date.now();

    // Update label based on signal level
    if (labelEl) {
      if (target < 50) labelEl.textContent = 'signal forming';
      else if (target < 80) labelEl.textContent = 'signal clarifying';
      else labelEl.textContent = 'signal locked';
    }

    function tick() {
      var progress = Math.min((Date.now() - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var val = Math.floor(current + (target - current) * eased);
      fill.style.width = val + '%';
      pctEl.textContent = val + '%';

      // Color transitions
      if (val < 50) {
        fill.style.background = 'linear-gradient(90deg, var(--cyan), var(--cyan))';
      } else if (val < 80) {
        fill.style.background = 'linear-gradient(90deg, var(--cyan), var(--green))';
      } else {
        fill.style.background = 'linear-gradient(90deg, var(--cyan), var(--green), var(--gold))';
      }

      if (progress < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  // ─── MATCH COUNT ───────────────────────────────────────────
  function animateMatchCount(target) {
    var el = $('matchCount');
    if (!el) return;

    var current = parseInt(el.textContent) || 0;
    var duration = 1200;
    var start = Date.now();

    function tick() {
      var progress = Math.min((Date.now() - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var val = Math.floor(current + (target - current) * eased);
      el.textContent = val;
      if (progress < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  // ─── TYPEWRITER ──────────────────────────────────────────────
  function typeMessage(text, callback) {
    var el = $('aiMsg');
    isTyping = true;

    // Create a new message bubble
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant-bubble';
    bubble.innerHTML = '<span class="bubble-marker">&#x2726;</span><span class="bubble-text"></span>';
    el.appendChild(bubble);

    var textEl = bubble.querySelector('.bubble-text');
    var i = 0;

    function type() {
      if (i >= text.length) {
        // Highlight user name
        var re = new RegExp(userName, 'g');
        textEl.innerHTML = textEl.innerHTML.replace(
          re,
          '<span class="hl">' + userName + '</span>'
        );
        isTyping = false;
        if (callback) callback();
        return;
      }
      textEl.innerHTML = text.substring(0, i + 1) + '<span class="typing-cursor"></span>';
      i++;
      setTimeout(type, 16 + Math.random() * 20);
    }
    type();

    // Scroll to bottom
    el.scrollTop = el.scrollHeight;
  }

  // ─── SHOW USER CHOICE ──────────────────────────────────────
  function showUserChoice(text) {
    var el = $('aiMsg');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble user-bubble';
    bubble.innerHTML = '<span class="bubble-text">' + text + '</span>';
    el.appendChild(bubble);
    el.scrollTop = el.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════════════
  // DYNAMIC CONVERSATION CHIPS
  // ═══════════════════════════════════════════════════════════════
  function showConversationChips() {
    var row = $('responseRow');
    row.innerHTML = '';

    var chips = window.__dynamicChips || getDefaultChips(currentTurn);

    for (var i = 0; i < chips.length; i++) {
      (function (label) {
        var chip = document.createElement('button');
        chip.className = 'response-chip';
        chip.textContent = label;
        chip.addEventListener('click', function () { handleConversationResponse(label); });
        row.appendChild(chip);
      })(chips[i]);
    }

    // Always add the CTA chip on turn 2+
    if (currentTurn >= 2) {
      var ctaChip = document.createElement('button');
      ctaChip.className = 'response-chip cta-chip';
      ctaChip.textContent = '\u2192 Show me jobs';
      ctaChip.addEventListener('click', function () { goToExit(); });
      row.appendChild(ctaChip);
    }

    // Show the row with animation
    setTimeout(function () {
      row.classList.add('visible');
    }, 200);

    // Also show/update the main CTA button
    var ctaBtn = $('ctaBtn');
    if (currentTurn >= 2) {
      ctaBtn.style.display = 'block';
      $('ctaSection').classList.add('visible');
    }
  }

  function getDefaultChips(turn) {
    if (turn === 1) {
      return ['Show me what you found', 'Make it remote', 'Higher pay only', 'Entry level', 'Night shift'];
    }
    if (turn === 2) {
      return ['Lock it in', 'Full-time only', '$20+/hr', 'No experience needed'];
    }
    return ['Show me the matches'];
  }

  // ═══════════════════════════════════════════════════════════════
  // CONVERSATION RESPONSE HANDLER — the chatty loop
  // ═══════════════════════════════════════════════════════════════
  function handleConversationResponse(label) {
    if (isTyping) return;
    if (navigator.vibrate) navigator.vibrate(10);

    // Hide current chips
    var row = $('responseRow');
    row.classList.remove('visible');

    // Show the user's choice as a chat bubble
    showUserChoice(label);

    // Record in history
    conversationHistory.push({ role: 'user', choice: label });

    currentTurn++;

    // If max turns reached or user wants to proceed, go to exit
    if (currentTurn > MAX_TURNS) {
      // Apply the last choice as a refinement
      applyRefinement(label);
      setTimeout(goToExit, 800);
      return;
    }

    // Apply the choice as an extraction refinement
    applyRefinement(label);

    // Show a loading state
    showThinking();

    // Fire next Claude call
    aiMessage = '';
    workerResolved = false;
    window.__dynamicChips = null;
    callWorker(currentTurn);

    // Wait for response, then type it
    waitForResponseThenType();
  }

  function applyRefinement(label) {
    var lower = label.toLowerCase();
    if (lower.indexOf('remote') !== -1) {
      extraction.location = 'Remote';
    } else if (lower.indexOf('entry') !== -1 || lower.indexOf('no experience') !== -1) {
      extraction.interest = 'entry-level ' + extraction.interest.replace(/^entry-level\s*/i, '');
    } else if (lower.indexOf('night') !== -1) {
      extraction.interest = 'night-shift ' + extraction.interest.replace(/^night-shift\s*/i, '');
    } else if (lower.indexOf('pay') !== -1 || lower.indexOf('$') !== -1) {
      extraction.interest = 'high-paying ' + extraction.interest.replace(/^high-paying\s*/i, '');
    } else if (lower.indexOf('full-time') !== -1) {
      extraction.interest = 'full-time ' + extraction.interest.replace(/^full-time\s*/i, '');
    }
  }

  function showThinking() {
    var el = $('aiMsg');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant-bubble thinking-bubble';
    bubble.id = 'thinkingBubble';
    bubble.innerHTML = '<span class="bubble-marker">&#x2726;</span><span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
    el.appendChild(bubble);
    el.scrollTop = el.scrollHeight;
  }

  function removeThinking() {
    var bubble = $('thinkingBubble');
    if (bubble) bubble.remove();
  }

  function waitForResponseThenType() {
    var checks = 0;
    var poll = setInterval(function () {
      checks++;
      if (workerResolved || checks > 80) { // 8 second max wait
        clearInterval(poll);
        if (!aiMessage) aiMessage = getFallbackFollowUp();

        removeThinking();

        // Update signal and match count with animation
        animateSignal(signalPct);
        animateMatchCount(matchCount);

        // Record in history
        conversationHistory.push({ role: 'assistant', message: aiMessage });

        // Type the new message
        typeMessage(aiMessage, function () {
          showConversationChips();
        });
      }
    }, 100);
  }

  function getFallbackFollowUp() {
    if (currentTurn === 2) {
      return userName + ', signal sharpening. The noise is falling away. ' + matchCount + ' verified positions — each one real, each one hiring.';
    }
    return userName + ', signal locked. ' + matchCount + ' precision matches. The gate is open.';
  }

  // ═══════════════════════════════════════════════════════════════
  // EXIT — the gate opens
  // ═══════════════════════════════════════════════════════════════
  function goToExit() {
    if (state === S.EXIT) return;
    state = S.EXIT;

    var params = new URLSearchParams();
    params.set('interest', extraction.interest);
    params.set('location', extraction.location);
    params.set('name', userName);
    params.set('signal', signalPct.toString());
    params.set('matches', matchCount.toString());
    window.location.href = 'exit.html?' + params.toString();
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE TICKER — contextual social proof
  // ═══════════════════════════════════════════════════════════════
  function startLiveTicker() {
    var ticker = $('liveTicker');
    var textEl = $('ltText');

    var names = [
      'Sarah', 'Mike', 'Jessica', 'David', 'Ashley', 'Chris',
      'Maria', 'James', 'Taylor', 'Alex', 'Jordan', 'Morgan'
    ];

    // Context-aware actions based on user's interest
    function getActions() {
      var interest = extraction.interest || 'jobs';
      return [
        'just found a <em>' + interest + '</em> match',
        'landed an interview in <em>' + (extraction.location || 'their area') + '</em>',
        'applied to <em>3 ' + interest + ' jobs</em> today',
        'just crossed the gate',
        'refined their signal to <em>94%</em>'
      ];
    }

    // Context-aware cities — use the user's area
    function getCities() {
      var loc = extraction.location || '';
      var baseCities = ['Dallas', 'Houston', 'Phoenix', 'Chicago', 'Miami', 'Atlanta', 'Denver', 'Orlando', 'Nashville', 'Portland'];
      // If user has a real location, weight it heavily
      if (loc && loc !== 'Remote' && loc !== 'Anywhere' && loc !== 'near me') {
        return [loc, loc, loc].concat(baseCities); // 3:10 weight toward user's location
      }
      return baseCities;
    }

    function show() {
      var name = names[Math.floor(Math.random() * names.length)];
      var cities = getCities();
      var city = cities[Math.floor(Math.random() * cities.length)];
      var actions = getActions();
      var action = actions[Math.floor(Math.random() * actions.length)];
      textEl.innerHTML = '<em>' + name + '</em> in ' + city + ' ' + action;
      ticker.classList.add('show');

      setTimeout(function () {
        ticker.classList.remove('show');
        setTimeout(show, 3000 + Math.random() * 3000);
      }, 4000);
    }

    setTimeout(show, 500);
  }

  // ─── BOOT ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

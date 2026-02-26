// ═══════════════════════════════════════════════════════════════
// THE SPIRAL v3 — Unguarded. Conversational. Alive.
// The gate talks back. The user talks back. The signal sharpens.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────
  var WORKER_URL = window.__WORKER_URL__ || '';
  var WORKER_TIMEOUT_MS = 12000;

  // ─── STATES ──────────────────────────────────────────────────
  var S = { PORTAL: 0, PICKS: 1, SCAN: 2, CHAT: 3, EXIT: 4 };
  var state = S.PORTAL;

  // ─── SESSION ─────────────────────────────────────────────────
  var userName = '';
  var selectedInterest = '';
  var selectedLocation = '';
  var detectedLocation = '';
  var extraction = { interest: 'jobs', location: 'near me' };
  var signal = 0;

  // Conversation history — alternating assistant/user for Claude API
  // Each entry: { role: "assistant"|"user", content: "raw string" }
  var rawHistory = [];

  var isWaiting = false; // waiting for Claude response

  // ─── DOM HELPERS ─────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ─── GEO DETECTION ──────────────────────────────────────────
  function detectLocation() {
    if (!WORKER_URL) return;
    fetch(WORKER_URL + '/geo')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.detected && data.locationString) {
          detectedLocation = data.locationString;
          injectDetectedChip(detectedLocation);
        }
      })
      .catch(function () {});
  }

  function injectDetectedChip(loc) {
    var container = $('locationChips');
    if (!container || container.querySelector('[data-detected]')) return;

    var chip = document.createElement('button');
    chip.className = 'pick-chip detected-chip';
    chip.setAttribute('data-value', loc);
    chip.setAttribute('data-detected', 'true');
    chip.textContent = loc;
    container.insertBefore(chip, container.firstChild);
    chip.addEventListener('click', function () { selectChip('location', chip); });

    // Auto-select after a beat
    setTimeout(function () {
      selectChip('location', chip);
      chip.classList.add('pop');
    }, 300);
  }

  // ─── INIT ────────────────────────────────────────────────────
  function init() {
    $('portal').addEventListener('click', enterPortal);

    var nameInput = $('nameInput');
    nameInput.addEventListener('input', updateGoButton);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitPicks();
    });

    // Interest chips
    each('#interestChips .pick-chip', function (chip) {
      chip.addEventListener('click', function () { selectChip('interest', chip); });
    });

    // Location chips (static ones — detected chip added dynamically)
    each('#locationChips .pick-chip', function (chip) {
      chip.addEventListener('click', function () { selectChip('location', chip); });
    });

    // Location text input
    var locInput = $('locationInput');
    if (locInput) {
      locInput.addEventListener('input', function () {
        if (locInput.value.trim()) {
          each('#locationChips .pick-chip', function (c) { c.classList.remove('selected'); });
          selectedLocation = locInput.value.trim();
          updateGoButton();
        }
      });
      locInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitPicks();
      });
    }

    $('goBtn').addEventListener('click', submitPicks);
    $('skipBtn').addEventListener('click', function () { submitPicks(true); });

    // Chat input
    var chatInput = $('chatInput');
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    $('chatSend').addEventListener('click', sendChat);

    // CTA
    $('ctaBtn').addEventListener('click', function (e) {
      e.preventDefault();
      goToExit();
    });
  }

  function each(sel, fn) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) fn(els[i]);
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 0 → 1: PORTAL
  // ═══════════════════════════════════════════════════════════════
  function enterPortal() {
    if (state !== S.PORTAL) return;
    state = S.PICKS;
    if (navigator.vibrate) navigator.vibrate(20);

    $('stage0').classList.add('gone');
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
    var cid = type === 'interest' ? 'interestChips' : 'locationChips';
    each('#' + cid + ' .pick-chip', function (c) { c.classList.remove('selected'); });
    chip.classList.add('selected');

    if (type === 'interest') {
      selectedInterest = chip.getAttribute('data-value');
    } else {
      selectedLocation = chip.getAttribute('data-value');
      var locInput = $('locationInput');
      if (locInput) locInput.value = '';
    }
    updateGoButton();
  }

  function updateGoButton() {
    var btn = $('goBtn');
    btn.disabled = !selectedInterest;
    if (selectedInterest && selectedLocation) btn.classList.add('pulse');
    else btn.classList.remove('pulse');
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 1 → 2: SUBMIT PICKS → SCAN
  // ═══════════════════════════════════════════════════════════════
  function submitPicks(skip) {
    if (state !== S.PICKS) return;

    userName = $('nameInput').value.trim() || 'friend';
    userName = userName.charAt(0).toUpperCase() + userName.slice(1);

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
    extraction.interest = selectedInterest.toLowerCase();
    extraction.location = selectedLocation;

    // Transition to scan
    var s1 = $('stage1');
    s1.style.opacity = '0';
    s1.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      s1.style.display = 'none';
      $('sl1').textContent = 'mapping ' + selectedInterest.toLowerCase() + ' positions...';
      $('sl2').textContent = 'filtering ' + selectedLocation + ' listings...';
      $('stage2').classList.add('active');
      runScan();
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2: SCAN — animation + first Claude call
  // ═══════════════════════════════════════════════════════════════
  function runScan() {
    var lines = ['sl0', 'sl1', 'sl2', 'sl3', 'sl4'];
    var i = 0;
    var scanDone = false;
    var workerDone = false;
    var workerData = null;

    var interval = setInterval(function () {
      if (i >= lines.length) {
        clearInterval(interval);
        scanDone = true;
        if (workerDone) transitionToChat(workerData);
        return;
      }
      var el = $(lines[i]);
      el.classList.add('done');
      el.innerHTML = '<span class="check">&#x2713;</span>' + el.textContent;
      i++;
    }, 700);

    // First Claude call — no history, just context
    callWorker(null, function (data) {
      workerData = data;
      workerDone = true;
      if (scanDone) transitionToChat(data);
    });
  }

  function transitionToChat(data) {
    // Store first assistant response in history
    rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify(data) });

    var s2 = $('stage2');
    s2.style.opacity = '0';
    s2.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      s2.style.display = 'none';
      state = S.CHAT;

      $('bigName').textContent = userName;
      $('stage3').classList.add('active');

      // Update signal
      animateSignal(data.signal || 30);

      // Type the first message
      addAssistantBubble(data.message || getFallback(), function () {
        showSuggestions(data.suggestions);
        enableInput();
      });

      // Start ticker after a beat
      setTimeout(startTicker, 4000);
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════════
  // WORKER CALL — clean, history-aware
  // ═══════════════════════════════════════════════════════════════
  function callWorker(userMessage, callback) {
    if (!WORKER_URL) {
      var fb = getFallbackResponse();
      callback(fb);
      return;
    }

    // If there's a user message, add it to history before calling
    // (The frontend adds the user message; the worker sees the full alternating history)
    var historyToSend = rawHistory.slice(); // copy

    var controller, timeoutId;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, WORKER_TIMEOUT_MS);
    } catch (e) {}

    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: userName,
        interest_hint: extraction.interest,
        location_hint: extraction.location,
        history: historyToSend
      })
    };
    if (controller) opts.signal = controller.signal;

    fetch(WORKER_URL + '/chat', opts)
      .then(function (r) {
        if (timeoutId) clearTimeout(timeoutId);
        return r.json();
      })
      .then(function (data) {
        // Update extraction from Claude's refined understanding
        if (data.extraction) {
          extraction.interest = data.extraction.interest || extraction.interest;
          extraction.location = data.extraction.location || extraction.location;
        }
        callback(data);
      })
      .catch(function () {
        if (timeoutId) clearTimeout(timeoutId);
        callback(getFallbackResponse());
      });
  }

  function getFallback() {
    var msgs = [
      userName + '. ' + capitalize(extraction.interest) + ' in ' + extraction.location + '. The market\'s a maze — but not every wall is real. Let\'s find the actual doors.',
      userName + ', you\'re looking for ' + extraction.interest + ' work. Good. Most people don\'t even know what they\'re looking for. That puts you ahead.',
      userName + '. ' + capitalize(extraction.interest) + '. ' + extraction.location + '. I can work with that. The question is — do you want safe, or do you want right?'
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  function getFallbackResponse() {
    return {
      message: getFallback(),
      extraction: extraction,
      signal: Math.min(99, signal + 15),
      suggestions: ['Show me jobs', 'What pays best?', 'Remote only', 'I\'m flexible'],
      safetyFallbackUsed: true,
      _raw: JSON.stringify({ message: getFallback(), extraction: extraction, signal: signal + 15, suggestions: [] })
    };
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ═══════════════════════════════════════════════════════════════
  // CHAT — the real loop
  // ═══════════════════════════════════════════════════════════════
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

    // Show user bubble
    addUserBubble(text);
    hideSuggestions();
    disableInput();

    // Add to history
    rawHistory.push({ role: 'user', content: text });

    // Show thinking
    showThinking();

    // Call Claude
    callWorker(text, function (data) {
      removeThinking();

      // Store assistant response
      rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify(data) });

      // Update signal
      signal = data.signal || signal;
      animateSignal(signal);

      // Type the response
      addAssistantBubble(data.message, function () {
        showSuggestions(data.suggestions);
        enableInput();
        isWaiting = false;
        updateCTA();
      });
    });
  }

  // ─── CHAT UI PRIMITIVES ────────────────────────────────────

  function addAssistantBubble(text, callback) {
    var area = $('chatArea');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble portal-bubble';
    bubble.innerHTML = '<span class="portal-mark">&#x25CA;</span><span class="bubble-text"></span>';
    area.appendChild(bubble);
    scrollChat();

    // Typewriter
    var el = bubble.querySelector('.bubble-text');
    var i = 0;
    function type() {
      if (i >= text.length) {
        // Highlight name
        el.innerHTML = el.innerHTML.replace(
          new RegExp(userName, 'g'),
          '<span class="hl">' + userName + '</span>'
        );
        if (callback) callback();
        return;
      }
      el.innerHTML = text.substring(0, i + 1) + '<span class="cursor"></span>';
      i++;
      scrollChat();
      setTimeout(type, 14 + Math.random() * 18);
    }
    type();
  }

  function addUserBubble(text) {
    var area = $('chatArea');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble user-bubble';
    bubble.textContent = text;
    area.appendChild(bubble);
    scrollChat();
  }

  function showThinking() {
    var area = $('chatArea');
    var el = document.createElement('div');
    el.className = 'chat-bubble portal-bubble thinking';
    el.id = 'thinking';
    el.innerHTML = '<span class="portal-mark">&#x25CA;</span><span class="dots"><span>.</span><span>.</span><span>.</span></span>';
    area.appendChild(el);
    scrollChat();
  }

  function removeThinking() {
    var el = $('thinking');
    if (el) el.remove();
  }

  function scrollChat() {
    var area = $('chatArea');
    area.scrollTop = area.scrollHeight;
  }

  // ─── SUGGESTIONS ───────────────────────────────────────────

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

  function hideSuggestions() {
    $('suggestRow').classList.remove('visible');
  }

  // ─── INPUT STATE ───────────────────────────────────────────

  function enableInput() {
    $('chatInput').disabled = false;
    $('chatInput').focus();
    $('chatSend').disabled = false;
  }

  function disableInput() {
    $('chatInput').disabled = true;
    $('chatSend').disabled = true;
  }

  // ─── SIGNAL METER ─────────────────────────────────────────

  function animateSignal(target) {
    var fill = $('signalFill');
    var pct = $('signalPct');
    var label = $('signalLabel');
    if (!fill || !pct) return;

    signal = target;
    var current = parseInt(pct.textContent) || 0;
    var start = Date.now();
    var duration = 1200;

    if (label) {
      if (target < 40) label.textContent = 'forming';
      else if (target < 70) label.textContent = 'sharpening';
      else if (target < 90) label.textContent = 'clarifying';
      else label.textContent = 'locked';
    }

    function tick() {
      var p = Math.min((Date.now() - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.floor(current + (target - current) * eased);
      fill.style.width = val + '%';
      pct.textContent = val + '%';

      // Color shift
      if (val < 40) fill.style.background = 'var(--cyan)';
      else if (val < 70) fill.style.background = 'linear-gradient(90deg, var(--cyan), var(--green))';
      else fill.style.background = 'linear-gradient(90deg, var(--cyan), var(--green), var(--gold))';

      if (p < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  // ─── CTA ──────────────────────────────────────────────────

  function updateCTA() {
    var section = $('ctaSection');
    var btn = $('ctaBtn');

    // Always show CTA once conversation starts
    section.classList.add('visible');

    // Intensity based on signal
    if (signal >= 80) {
      btn.textContent = 'SHOW ME MY MATCHES \u2192';
      btn.classList.add('hot');
    } else if (signal >= 50) {
      btn.textContent = 'Show me matches \u2192';
      btn.classList.remove('hot');
    } else {
      btn.textContent = 'See what\u2019s out there \u2192';
      btn.classList.remove('hot');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXIT
  // ═══════════════════════════════════════════════════════════════
  function goToExit() {
    if (state === S.EXIT) return;
    state = S.EXIT;

    var params = new URLSearchParams();
    params.set('interest', extraction.interest);
    params.set('location', extraction.location);
    params.set('name', userName);
    params.set('signal', signal.toString());
    window.location.href = 'exit.html?' + params.toString();
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE TICKER — contextual
  // ═══════════════════════════════════════════════════════════════
  function startTicker() {
    var ticker = $('liveTicker');
    var textEl = $('ltText');

    var names = ['Sarah','Mike','Jessica','David','Ashley','Chris','Maria','James','Taylor','Alex','Jordan','Morgan'];
    var baseCities = ['Dallas','Houston','Phoenix','Chicago','Miami','Atlanta','Denver','Orlando','Nashville','Portland'];

    function getCities() {
      var loc = extraction.location || '';
      if (loc && loc !== 'Remote' && loc !== 'Anywhere' && loc !== 'near me') {
        return [loc, loc, loc].concat(baseCities);
      }
      return baseCities;
    }

    function getActions() {
      var i = extraction.interest || 'jobs';
      return [
        'just found a <em>' + i + '</em> match',
        'landed an interview',
        'applied to <em>3 ' + i + ' jobs</em> today',
        'just crossed the gate',
        'got a callback in <em>2 hours</em>'
      ];
    }

    function show() {
      var n = names[Math.floor(Math.random() * names.length)];
      var cities = getCities();
      var c = cities[Math.floor(Math.random() * cities.length)];
      var actions = getActions();
      var a = actions[Math.floor(Math.random() * actions.length)];
      textEl.innerHTML = '<em>' + n + '</em> in ' + c + ' ' + a;
      ticker.classList.add('show');
      setTimeout(function () {
        ticker.classList.remove('show');
        setTimeout(show, 4000 + Math.random() * 4000);
      }, 4500);
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

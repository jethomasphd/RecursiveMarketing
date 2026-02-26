// ═══════════════════════════════════════════════════════════════
// THE SPIRAL — State machine for the 45-second gate
// Each screen is a turn of the coil.
// Each interaction compresses uncertainty into intent.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── CONFIGURATION ───────────────────────────────────────────
  var WORKER_URL = window.__WORKER_URL__ || '';
  var FALLBACK_EXIT_URL = 'https://jobs.best-jobs-online.com/jobs';
  var BUDGET_MS = 45000;
  var WORKER_TIMEOUT_MS = 8000;

  // ─── STATES ──────────────────────────────────────────────────
  var S = { PORTAL: 0, PICKS: 1, SCAN: 2, REVEAL: 3, EXIT: 4 };
  var state = S.PORTAL;
  var t0 = null;

  // ─── SESSION DATA ────────────────────────────────────────────
  var userName = '';
  var selectedInterest = '';
  var selectedLocation = '';
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

  // ─── TIMING ──────────────────────────────────────────────────
  function elapsed() { return t0 ? Date.now() - t0 : 0; }
  function remaining() { return Math.max(0, BUDGET_MS - elapsed()); }

  // ─── DOM ─────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ─── BUDGET WATCHDOG ─────────────────────────────────────────
  // The coil does not allow detours.
  function startBudgetWatchdog() {
    setInterval(function () {
      if (!t0 || state === S.EXIT || state === S.PORTAL) return;
      var r = remaining();
      if (r < 10000 && state === S.SCAN) {
        // Force reveal if still scanning
        if (!aiMessage) aiMessage = getFallbackMessage();
        workerResolved = true;
      }
      if (r < 5000 && state === S.REVEAL) {
        // Auto-exit under pressure
        goToExit();
      }
    }, 1000);
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

    // Buttons
    $('goBtn').addEventListener('click', submitPicks);
    $('skipBtn').addEventListener('click', function () { submitPicks(true); });

    // Response chips
    var responseChips = document.querySelectorAll('.response-chip');
    for (var k = 0; k < responseChips.length; k++) {
      (function (chip) {
        chip.addEventListener('click', function () { handleResponse(chip); });
      })(responseChips[k]);
    }

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

    if (skip) {
      selectedInterest = selectedInterest || 'Anything';
      selectedLocation = selectedLocation || 'Anywhere';
    }
    if (!selectedInterest) selectedInterest = 'Anything';
    if (!selectedLocation) selectedLocation = 'Anywhere';

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
    callWorker();
  }

  function callWorker() {
    if (!WORKER_URL) {
      // No worker configured — graceful degradation
      aiMessage = getFallbackMessage();
      workerResolved = true;
      return;
    }

    var controller = null;
    var timeoutId = null;

    try {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, WORKER_TIMEOUT_MS);
    } catch (e) {
      // AbortController not supported — proceed without timeout
    }

    var fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: userName,
        interest_hint: selectedInterest,
        location_hint: selectedLocation,
        stage: 'scan',
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
        workerResolved = true;
      })
      .catch(function () {
        // Worker failed — the coil does not break
        if (timeoutId) clearTimeout(timeoutId);
        aiMessage = getFallbackMessage();
        workerResolved = true;
      });
  }

  function waitForWorkerThenReveal() {
    if (workerResolved) {
      setTimeout(goToReveal, 500);
      return;
    }

    // Poll briefly — max 3 seconds extra
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
      userName + ', the market is a maze of ghost postings and dead ends. But not every door is painted on. Your ' + interest + ' search starts now\u2009\u2014\u2009real listings, no phantoms.',
      userName + ', 61% of applicants get ghosted. You won\'t. ' + capitalize(interest) + ' jobs' + loc + '\u2009\u2014\u2009vetted, waiting, yours.',
      userName + ', the system wants you scrolling forever. We cut through. ' + capitalize(interest) + ' opportunities' + loc + '\u2009\u2014\u2009curated, verified, real.'
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2 → 3: REVEAL
  // ═══════════════════════════════════════════════════════════════
  function goToReveal() {
    state = S.REVEAL;

    var s2 = $('stage2');
    s2.style.opacity = '0';
    s2.style.transition = 'opacity 0.4s';

    setTimeout(function () {
      s2.style.display = 'none';

      // Populate reveal
      $('bigName').textContent = userName;
      $('counterContext').textContent = 'in ' + extraction.interest + ' \u00b7 ' + extraction.location;
      $('stage3').classList.add('active');

      // Counter animation
      animateCounter();

      // Type AI message
      setTimeout(function () {
        typeMessage(aiMessage || getFallbackMessage());
      }, 800);

      // Show response chips after message finishes typing (~3s)
      setTimeout(function () {
        $('responseRow').classList.add('visible');
      }, 4000);

      // Live ticker
      setTimeout(startLiveTicker, 5000);
    }, 400);
  }

  // ─── COUNTER ANIMATION ───────────────────────────────────────
  function animateCounter() {
    var el = $('counterNum');
    var target = 500 + Math.floor(Math.random() * 700); // $500-$1200/week
    var duration = 2000;
    var start = Date.now();

    function tick() {
      var progress = Math.min((Date.now() - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = '$' + Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = '$' + target;
    }
    tick();
  }

  // ─── TYPEWRITER ──────────────────────────────────────────────
  function typeMessage(text) {
    var el = $('aiMsg');
    el.innerHTML = '';
    var i = 0;

    function type() {
      if (i >= text.length) {
        // Highlight user name
        var re = new RegExp(userName, 'g');
        el.innerHTML = el.innerHTML.replace(
          re,
          '<span class="hl">' + userName + '</span>'
        );
        return;
      }
      el.innerHTML = text.substring(0, i + 1) + '<span class="typing-cursor"></span>';
      i++;
      setTimeout(type, 18 + Math.random() * 22);
    }
    type();
  }

  // ═══════════════════════════════════════════════════════════════
  // RESPONSE CHIPS — the user's single reply
  // ═══════════════════════════════════════════════════════════════
  function handleResponse(chip) {
    if (navigator.vibrate) navigator.vibrate(10);

    // Highlight selected
    var chips = document.querySelectorAll('.response-chip');
    for (var i = 0; i < chips.length; i++) chips[i].classList.remove('active');
    chip.classList.add('active');

    var action = chip.getAttribute('data-action');

    // Adjust extraction locally — no second LLM call. Keep the coil tight.
    switch (action) {
      case 'remote':
        extraction.location = 'Remote';
        break;
      case 'entry':
        extraction.interest = 'entry-level ' + extraction.interest;
        break;
      case 'night':
        extraction.interest = 'night-shift ' + extraction.interest;
        break;
      case 'highpay':
        extraction.interest = 'high-paying ' + extraction.interest;
        break;
      // 'default' — use extraction as-is
    }

    // Brief flash, then exit
    setTimeout(goToExit, 600);
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
    window.location.href = 'exit.html?' + params.toString();
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE TICKER — social proof stream
  // ═══════════════════════════════════════════════════════════════
  function startLiveTicker() {
    var ticker = $('liveTicker');
    var textEl = $('ltText');

    var names = [
      'Sarah', 'Mike', 'Jessica', 'David', 'Ashley', 'Chris',
      'Maria', 'James', 'Taylor', 'Alex', 'Jordan', 'Morgan'
    ];
    var cities = [
      'Dallas', 'Houston', 'Phoenix', 'Chicago', 'Miami',
      'Atlanta', 'Denver', 'Orlando', 'Nashville', 'Portland'
    ];
    var actions = [
      'just found a match',
      'landed an interview',
      'applied to <em>3 jobs</em> today',
      'just crossed the gate',
      'found verified listings'
    ];

    function show() {
      var name = names[Math.floor(Math.random() * names.length)];
      var city = cities[Math.floor(Math.random() * cities.length)];
      var action = actions[Math.floor(Math.random() * actions.length)];
      textEl.innerHTML = '<em>' + name + '</em> in ' + city + ' ' + action;
      ticker.classList.add('show');

      setTimeout(function () {
        ticker.classList.remove('show');
        setTimeout(show, 4000 + Math.random() * 4000);
      }, 5000);
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

// ═══════════════════════════════════════════════════════════════
// THE SPIRAL v5 — Intelligent job matchmaker.
// Claude + USAJobs → converge on a specific job application.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────
  var WORKER_URL = window.__WORKER_URL__ || '';
  var WORKER_TIMEOUT_MS = 20000;

  // ─── STATES ──────────────────────────────────────────────────
  var S = { PORTAL: 0, PICKS: 1, SCAN: 2, CHAT: 3, EXIT: 4 };
  var state = S.PORTAL;

  // ─── SESSION ─────────────────────────────────────────────────
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
  var topPickJob = null; // THE job Claude recommends

  // ─── DOM ───────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function each(sel, fn) { var els = document.querySelectorAll(sel); for (var i = 0; i < els.length; i++) fn(els[i]); }

  // ─── GEO ───────────────────────────────────────────────────
  function detectLocation() {
    if (!WORKER_URL) return;
    fetch(WORKER_URL + '/geo')
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
    chip.className = 'pick-chip detected-chip';
    chip.setAttribute('data-value', loc);
    chip.setAttribute('data-detected', 'true');
    chip.textContent = loc;
    c.insertBefore(chip, c.firstChild);
    chip.addEventListener('click', function () { selectChip('location', chip); });
    setTimeout(function () { selectChip('location', chip); chip.classList.add('pop'); }, 300);
  }

  // ─── INIT ──────────────────────────────────────────────────
  function init() {
    $('portal').addEventListener('click', enterPortal);
    var ni = $('nameInput');
    ni.addEventListener('input', updateGoButton);
    ni.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPicks(); });

    each('#interestChips .pick-chip', function (c) {
      c.addEventListener('click', function () { selectChip('interest', c); });
    });
    each('#locationChips .pick-chip', function (c) {
      c.addEventListener('click', function () { selectChip('location', c); });
    });

    var li = $('locationInput');
    if (li) {
      li.addEventListener('input', function () {
        if (li.value.trim()) {
          each('#locationChips .pick-chip', function (c) { c.classList.remove('selected'); });
          selectedLocation = li.value.trim();
          updateGoButton();
        }
      });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPicks(); });
    }

    $('goBtn').addEventListener('click', submitPicks);
    $('skipBtn').addEventListener('click', function () { submitPicks(true); });
    $('chatInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    $('chatSend').addEventListener('click', sendChat);
    $('ctaBtn').addEventListener('click', function (e) { e.preventDefault(); goToApply(); });
  }

  // ═══════════════════════════════════════════════════════════
  // PORTAL → PICKS
  // ═══════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════
  // CHIPS
  // ═══════════════════════════════════════════════════════════
  function selectChip(type, chip) {
    if (navigator.vibrate) navigator.vibrate(10);
    var cid = type === 'interest' ? 'interestChips' : 'locationChips';
    each('#' + cid + ' .pick-chip', function (c) { c.classList.remove('selected'); });
    chip.classList.add('selected');
    if (type === 'interest') selectedInterest = chip.getAttribute('data-value');
    else {
      selectedLocation = chip.getAttribute('data-value');
      var li = $('locationInput'); if (li) li.value = '';
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
  // PICKS → SCAN
  // ═══════════════════════════════════════════════════════════
  function submitPicks(skip) {
    if (state !== S.PICKS) return;
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
    state = S.SCAN;
    extraction.interest = selectedInterest.toLowerCase();
    extraction.location = selectedLocation;

    var s1 = $('stage1');
    s1.style.opacity = '0'; s1.style.transition = 'opacity 0.4s';
    setTimeout(function () {
      s1.style.display = 'none';
      $('sl1').textContent = 'searching ' + selectedInterest.toLowerCase() + ' on USAJobs...';
      $('sl2').textContent = 'scanning ' + selectedLocation + ' federal positions...';
      $('stage2').classList.add('active');
      runScan();
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════
  // SCAN — USAJobs search + first Claude call
  // ═══════════════════════════════════════════════════════════
  function runScan() {
    var lines = ['sl0', 'sl1', 'sl2', 'sl3', 'sl4'];
    var i = 0;
    var scanDone = false, workerDone = false, workerData = null;

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

    callWorker(null, false, function (data) {
      workerData = data;
      workerDone = true;
      if (scanDone) transitionToChat(data);
    });
  }

  function transitionToChat(data) {
    cachedJobs = data.jobs || [];
    totalResults = data.totalResults || 0;
    searchUrl = data.searchUrl || '';
    lastSearchKey = extraction.interest + '|' + extraction.location;

    rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify(data) });

    var s2 = $('stage2');
    s2.style.opacity = '0'; s2.style.transition = 'opacity 0.4s';
    setTimeout(function () {
      s2.style.display = 'none';
      state = S.CHAT;
      $('bigName').textContent = userName;
      $('stage3').classList.add('active');

      animateSignal(data.signal || 25);
      updateResultsCount();

      addAssistantBubble(data.message || getFallback(), function () {
        showJobCards(data.showJobs || []);
        showSuggestions(data.suggestions);
        enableInput();
        updateCTA(data);
      });

      setTimeout(startTicker, 5000);
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════
  // WORKER CALL
  // ═══════════════════════════════════════════════════════════
  function callWorker(userMessage, forceSearch, callback) {
    if (!WORKER_URL) { callback(getFallbackResponse()); return; }

    var controller, timeoutId;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, WORKER_TIMEOUT_MS);
    } catch (e) {}

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

    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (controller) opts.signal = controller.signal;

    fetch(WORKER_URL + '/chat', opts)
      .then(function (r) { if (timeoutId) clearTimeout(timeoutId); return r.json(); })
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
        // Track top pick
        if (data.topPickJob) {
          topPickJob = data.topPickJob;
        }
        callback(data);
      })
      .catch(function () {
        if (timeoutId) clearTimeout(timeoutId);
        callback(getFallbackResponse());
      });
  }

  function getFallback() {
    return userName + ', scanning the federal job board. Government positions are real — no ghost listings, no bait-and-switch. Let me find what fits.';
  }

  function getFallbackResponse() {
    return {
      message: getFallback(), extraction: extraction, signal: 20,
      topPick: null, topPickJob: null, showJobs: [],
      suggestions: ['What did you find?', 'Remote positions', 'Best paying', 'Broaden search'],
      jobs: cachedJobs || [], totalResults: totalResults, searchUrl: searchUrl,
      safetyFallbackUsed: true, _raw: JSON.stringify({ message: getFallback() })
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CHAT LOOP
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

    var currentKey = extraction.interest + '|' + extraction.location;
    var needSearch = currentKey !== lastSearchKey;

    callWorker(text, needSearch, function (data) {
      removeThinking();
      rawHistory.push({ role: 'assistant', content: data._raw || JSON.stringify(data) });

      signal = data.signal || signal;
      animateSignal(signal);
      updateResultsCount();
      lastSearchKey = extraction.interest + '|' + extraction.location;

      if (data.refineSearch) {
        lastSearchKey = '';
      }

      addAssistantBubble(data.message, function () {
        // Show job cards Claude selected
        if (data.showJobs && data.showJobs.length > 0) {
          showJobCards(data.showJobs);
        }

        // If Claude converged on a top pick, show the featured card
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

  // ─── CHAT UI ────────────────────────────────────────────────

  function addAssistantBubble(text, callback) {
    var area = $('chatArea');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble portal-bubble';
    bubble.innerHTML = '<span class="pmark">&#x25CA;</span><span class="btxt"></span>';
    area.appendChild(bubble);
    scrollChat();

    var el = bubble.querySelector('.btxt');
    var i = 0;
    function type() {
      if (i >= text.length) {
        el.innerHTML = el.innerHTML.replace(new RegExp(userName, 'g'), '<span class="hl">' + userName + '</span>');
        if (callback) callback();
        return;
      }
      el.innerHTML = text.substring(0, i + 1) + '<span class="cur"></span>';
      i++;
      scrollChat();
      setTimeout(type, 12 + Math.random() * 16);
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

  function showThinking() {
    var area = $('chatArea');
    var el = document.createElement('div');
    el.className = 'chat-bubble portal-bubble thinking'; el.id = 'thinking';
    el.innerHTML = '<span class="pmark">&#x25CA;</span><span class="dots"><span>.</span><span>.</span><span>.</span></span>';
    area.appendChild(el);
    scrollChat();
  }

  function removeThinking() { var el = $('thinking'); if (el) el.remove(); }

  function scrollChat() { var a = $('chatArea'); a.scrollTop = a.scrollHeight; }

  // ─── JOB CARDS ──────────────────────────────────────────────

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
        (meta.length ? '<div class="jc-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
        '<div class="jc-apply">View &amp; Apply &#x2192;</div>';

      container.appendChild(card);
    }

    area.appendChild(container);
    scrollChat();
  }

  // Featured job — the one Claude converged on
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
      '<div class="fj-badge">&#x25CA; TOP MATCH</div>' +
      '<div class="fj-title">' + esc(job.title) + '</div>' +
      '<div class="fj-org">' + esc(job.org) + '</div>' +
      '<div class="fj-dept">' + esc(job.dept) + '</div>' +
      '<div class="fj-loc">' + esc(job.location) + '</div>' +
      (salary ? '<div class="fj-salary">' + esc(salary) + '</div>' : '') +
      (job.closing ? '<div class="fj-closing">Apply by ' + esc(job.closing) + '</div>' : '') +
      '<div class="fj-apply">APPLY NOW &#x2192;</div>';

    area.appendChild(card);
    scrollChat();
  }

  function formatSalary(min, max, period) {
    if (!min && !max) return '';
    var fmt = function (n) {
      var num = parseInt(n);
      return isNaN(num) ? n : '$' + num.toLocaleString('en-US');
    };
    var range = min && max ? fmt(min) + ' – ' + fmt(max) : fmt(min || max);
    var per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '';
    return range + per;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ─── SUGGESTIONS ────────────────────────────────────────────

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

  // ─── INPUT ──────────────────────────────────────────────────

  function enableInput() {
    $('chatInput').disabled = false;
    $('chatInput').focus();
    $('chatSend').disabled = false;
  }

  function disableInput() {
    $('chatInput').disabled = true;
    $('chatSend').disabled = true;
  }

  // ─── SIGNAL ─────────────────────────────────────────────────

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
      if (v < 40) fill.style.background = 'var(--cyan)';
      else if (v < 70) fill.style.background = 'linear-gradient(90deg,var(--cyan),var(--green))';
      else fill.style.background = 'linear-gradient(90deg,var(--cyan),var(--green),var(--gold))';
      if (p < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  // ─── RESULTS COUNT ──────────────────────────────────────────

  function updateResultsCount() {
    var el = $('resultsCount');
    if (!el) return;
    if (totalResults > 0) {
      el.textContent = totalResults + ' federal positions found';
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  // ─── CTA ────────────────────────────────────────────────────

  function updateCTA(data) {
    var section = $('ctaSection');
    var btn = $('ctaBtn');
    var fine = $('ctaFine');

    section.classList.add('visible');

    if (data && data.topPickJob) {
      // Converged — show specific job apply button
      var job = data.topPickJob;
      btn.textContent = 'APPLY: ' + job.title + ' \u2192';
      btn.classList.add('hot');
      btn.setAttribute('data-url', job.applyUrl || job.url || '');
      if (fine) fine.textContent = job.org + ' \u00b7 ' + formatSalary(job.salaryMin, job.salaryMax, job.salaryPeriod);
    } else if (signal >= 60 && topPickJob) {
      // Previously converged
      btn.textContent = 'APPLY: ' + topPickJob.title + ' \u2192';
      btn.classList.add('hot');
      btn.setAttribute('data-url', topPickJob.applyUrl || topPickJob.url || '');
      if (fine) fine.textContent = topPickJob.org + ' \u00b7 ' + formatSalary(topPickJob.salaryMin, topPickJob.salaryMax, topPickJob.salaryPeriod);
    } else if (totalResults > 0) {
      // Not converged yet — show browse option
      btn.textContent = 'Browse all ' + totalResults + ' positions \u2192';
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

  // ─── APPLY / EXIT ──────────────────────────────────────────

  function goToApply() {
    var btn = $('ctaBtn');
    var url = btn.getAttribute('data-url');

    if (url) {
      // Open the job application in a new tab
      window.open(url, '_blank', 'noopener');
    } else if (topPickJob) {
      window.open(topPickJob.applyUrl || topPickJob.url, '_blank', 'noopener');
    } else if (searchUrl) {
      window.open(searchUrl, '_blank', 'noopener');
    } else {
      window.open('https://www.usajobs.gov', '_blank', 'noopener');
    }
  }

  // ─── TICKER ─────────────────────────────────────────────────

  function startTicker() {
    var ticker = $('liveTicker'), textEl = $('ltText');
    var names = ['Sarah','Mike','Jessica','David','Ashley','Chris','Maria','James','Taylor','Alex'];
    var agencies = ['VA','DoD','HHS','USDA','DHS','SSA','EPA','NASA','DOJ','Treasury'];

    function getActions() {
      var int = extraction.interest || 'federal';
      return [
        'just applied to a <em>' + int + '</em> position',
        'found <em>a match</em> through the portal',
        'got referred for a <em>GS-11</em> role',
        'landed an interview with <em>' + agencies[Math.floor(Math.random() * agencies.length)] + '</em>',
        'just crossed the gate'
      ];
    }

    function show() {
      var n = names[Math.floor(Math.random() * names.length)];
      var loc = extraction.location !== 'anywhere' ? extraction.location : 'DC';
      var a = getActions();
      textEl.innerHTML = '<em>' + n + '</em> in ' + loc + ' ' + a[Math.floor(Math.random() * a.length)];
      ticker.classList.add('show');
      setTimeout(function () {
        ticker.classList.remove('show');
        setTimeout(show, 6000 + Math.random() * 5000);
      }, 4500);
    }
    setTimeout(show, 500);
  }

  // ─── BOOT ──────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

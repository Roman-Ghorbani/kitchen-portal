/**
 * Shared console behaviour for /admin and /post.
 *
 *   Panel   - console chrome, icons, health, dirty tracking, TV simulator bridge
 *   Studio  - the announcement editor & studio with live sync, expiry presets, tabs
 */

/* ==========================================================================
   PANEL - console chrome & TV simulator bridge
   ========================================================================== */
window.Panel = (function () {
  var PATHS = {
    board: 'M3 4h18v12H3zM8 20h8M12 16v4',
    menu: 'M4 2v7a3 3 0 0 0 6 0V2M7 2v20M18 2c-1.7 1.5-2.5 4-2.5 7 0 2 .6 3 2.5 3.2V22',
    mega: 'M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6M20 6.5a8 8 0 0 1 0 11',
    broom: 'M19 3l-8 8M12.5 6.5l5 5M11 11l-6 6c-1 1-1 2.5 0 3.5s2.5 1 3.5 0l6-6zM6 15h6',
    plate: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
    ticker: 'M3 8h18M3 12h12M3 16h18',
    sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 1v2M12 21v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M1 12h2M21 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5',
    gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z',
    eye: 'M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
    caret: 'M9 6l6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    up: 'M12 19V5M5 12l7-7 7 7',
    down: 'M12 5v14M19 12l-7 7-7-7',
    image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
    save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 14h8v7H8z',
    check: 'M20 6L9 17l-5-5',
    pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
    play: 'M5 3l14 9-14 9V3z',
    sparkles: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83'
  };

  function icon(name, cls) {
    var d = PATHS[name] || PATHS.board;
    return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  }

  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = '<span></span>';
    el.firstChild.textContent = msg;
    if (actionLabel) {
      var b = document.createElement('button');
      b.textContent = actionLabel;
      b.onclick = function () { hide(); action(); };
      el.appendChild(b);
    }
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, actionLabel ? 8000 : 3200);
    function hide() { el.classList.remove('on'); }
  }

  var dirty = false;
  function markDirty() {
    dirty = true;
    var el = document.getElementById('dirty');
    if (el) el.classList.add('on');
    syncLiveSimulator();
  }
  function markClean() {
    dirty = false;
    var el = document.getElementById('dirty');
    if (el) el.classList.remove('on');
  }
  function isDirty() { return dirty; }

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  function status(msg, kind) {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'bad' ? 'var(--bad)' : kind === 'busy' ? 'var(--brand)' : 'var(--ok)';
  }

  async function health() {
    var el = document.getElementById('hb');
    if (!el) return;
    try {
      var h = await (await fetch('/api/health')).json();
      if (h.secondsAgo === null) {
        el.className = 'hb hb-warn';
        el.textContent = 'Server up, TV has not checked in';
      } else if (h.secondsAgo <= 10) {
        el.className = 'hb hb-ok';
        el.textContent = 'TV is live';
      } else if (h.secondsAgo <= 120) {
        el.className = 'hb hb-warn';
        el.textContent = 'TV quiet for ' + h.secondsAgo + 's';
      } else {
        var mins = Math.round(h.secondsAgo / 60);
        el.className = 'hb hb-bad';
        el.textContent = 'TV offline ' + (mins < 60 ? mins + ' min' : Math.round(mins / 60) + ' hr');
      }
      el.title = h.secondsAgo === null
        ? 'The server is running but the display has not polled since the server started.'
        : 'The display last checked in ' + h.secondsAgo + ' seconds ago.';
    } catch (err) {
      el.className = 'hb hb-bad';
      el.textContent = 'Cannot reach the Pi';
    }
  }

  // ---------- SIMULATOR CONTROLLER & LIVE BRIDGE ----------
  var livePayloadGetter = null;
  function setPayloadGetter(fn) { livePayloadGetter = fn; }

  function syncLiveSimulator() {
    if (!livePayloadGetter) return;
    try {
      var cfg = livePayloadGetter();
      var iframes = document.querySelectorAll('.preview-frame iframe');
      iframes.forEach(function (f) {
        if (f.contentWindow) {
          f.contentWindow.postMessage({ type: 'PREVIEW_CONFIG', config: cfg }, '*');
        }
      });
    } catch (err) {}
  }

  function fitPreview(frame) {
    if (!frame) return;
    var f = frame.querySelector('iframe');
    if (!f) return;
    var s = frame.clientWidth / 1920;
    f.style.transform = 'scale(' + s + ')';
  }
  function watchPreview(frame) {
    fitPreview(frame);
    window.addEventListener('resize', function () { fitPreview(frame); });
    if (window.ResizeObserver) new ResizeObserver(function () { fitPreview(frame); }).observe(frame);
  }

  var simState = { paused: false, page: 0, showSafe: false, showBezel: true };

  function mountSimulator(containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML =
      '<div class="tv-sim">'
      + '<div class="tv-sim-bar">'
        + '<span class="title">Insignia TV Live Simulator</span>'
        + '<span class="tv-sim-tag" id="sim-page-indicator">Live Board</span>'
        + '<div class="ctrls">'
          + '<button type="button" id="sim-prev-page" title="Previous Announcement Slide">&larr; Slide</button>'
          + '<button type="button" id="sim-next-page" title="Next Announcement Slide">Slide &rarr;</button>'
          + '<button type="button" id="sim-safe-btn" title="Toggle 4% overscan safe boundary">Safe Area</button>'
          + '<button type="button" id="sim-bezel-btn" class="on" title="Toggle TV Bezel">Bezel</button>'
          + '<button type="button" id="sim-pause-btn" title="Pause / Resume Rotation">' + icon('pause') + '</button>'
        + '</div>'
      + '</div>'
      + '<div class="tv-bezel" id="sim-bezel-box">'
        + '<div class="preview-frame" id="sim-frame">'
          + '<div class="safe-overlay" id="sim-safe-overlay"></div>'
          + '<iframe src="/" title="TV Simulator" loading="eager"></iframe>'
        + '</div>'
        + '<div class="tv-bezel-btn"></div>'
      + '</div>'
      + '</div>';

    var frame = containerEl.querySelector('#sim-frame');
    watchPreview(frame);

    var iframe = frame.querySelector('iframe');
    iframe.addEventListener('load', function () {
      syncLiveSimulator();
    });

    var currentPage = 0;
    var prevPageBtn = containerEl.querySelector('#sim-prev-page');
    var nextPageBtn = containerEl.querySelector('#sim-next-page');
    if (prevPageBtn) prevPageBtn.addEventListener('click', function () {
      currentPage = Math.max(0, currentPage - 1);
      if (iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'SET_ANN_PAGE', page: currentPage }, '*');
    });
    if (nextPageBtn) nextPageBtn.addEventListener('click', function () {
      currentPage++;
      if (iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'SET_ANN_PAGE', page: currentPage }, '*');
    });

    var safeBtn = containerEl.querySelector('#sim-safe-btn');
    var safeOverlay = containerEl.querySelector('#sim-safe-overlay');
    safeBtn.addEventListener('click', function () {
      simState.showSafe = !simState.showSafe;
      safeBtn.classList.toggle('on', simState.showSafe);
      safeOverlay.classList.toggle('on', simState.showSafe);
    });

    var bezelBtn = containerEl.querySelector('#sim-bezel-btn');
    var bezelBox = containerEl.querySelector('#sim-bezel-box');
    bezelBtn.addEventListener('click', function () {
      simState.showBezel = !simState.showBezel;
      bezelBtn.classList.toggle('on', simState.showBezel);
      bezelBox.classList.toggle('nobezel', !simState.showBezel);
      fitPreview(frame);
    });

    var pauseBtn = containerEl.querySelector('#sim-pause-btn');
    pauseBtn.addEventListener('click', function () {
      simState.paused = !simState.paused;
      pauseBtn.innerHTML = simState.paused ? icon('play') : icon('pause');
      pauseBtn.classList.toggle('on', simState.paused);
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'PAUSE_ROTATION', paused: simState.paused }, '*');
      }
    });
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function uploadImage(file, done, onStatus) {
    if (!file) return;
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      var max = 1400, scale = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var dataUrl = c.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(img.src);
      if (onStatus) onStatus('Uploading picture...');
      fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: dataUrl })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.url) done(j.url, w, h);
        else toast('Upload failed: ' + (j.error || 'unknown'));
      }).catch(function () { toast('Upload failed. Is the Pi reachable?'); });
    };
    img.onerror = function () { toast('That file could not be read as an image.'); };
    img.src = URL.createObjectURL(file);
  }

  return {
    icon: icon, toast: toast, markDirty: markDirty, markClean: markClean, isDirty: isDirty,
    status: status, health: health, fitPreview: fitPreview, watchPreview: watchPreview,
    uploadImage: uploadImage, todayIso: todayIso,
    mountSimulator: mountSimulator, setPayloadGetter: setPayloadGetter, syncLiveSimulator: syncLiveSimulator
  };
})();

/* ==========================================================================
   STUDIO - the announcement editor
   ========================================================================== */
window.Studio = (function () {
  var esc = AnnRender.esc;
  var S = {
    items: [],
    settings: { layout: 'auto', pageSeconds: 15, adaptiveTimer: true, minPageSeconds: 8, maxPageSeconds: 30, density: 'comfortable', autoFill: true, showProgress: true },
    listEl: null, countEl: null, onChange: function () {},
    open: -1, filter: '', currentTab: 'active', dragFrom: -1
  };

  var TEMPLATES = [
    { name: 'Photo / Flyer Spotlight', a: { title: 'Spotlight Notice', body: 'Add full description or details here.', label: 'Spotlight', soloPage: true, accent: 'purple', imageLayout: 'auto' } },
    { name: 'Chapter meeting', a: { title: 'Chapter Meeting', body: 'Sunday at 7:00 PM in the Chapter Room. Attendance is mandatory.', label: 'Chapter', when: 'Sun 7:00 PM', accent: 'gold', pinned: true } },
    { name: 'Social / Date party', a: { title: 'Social Event', body: 'Where it is and what to wear.', label: 'Social', when: 'Fri 9 PM', accent: 'blue' } },
    { name: 'Urgent notice', a: { title: 'Heads up', body: 'What changed and what to do about it.', emphasis: 'urgent', accent: 'red' } },
    { name: 'Kitchen reminder', a: { title: 'Kitchen Notice', body: 'Keep prep areas clean and dishes racked.', label: 'Kitchen', accent: 'green' } }
  ];

  var SIZES = [
    ['fill', 'Fill All Available Space (Max Size)'],
    ['xl', 'Extra Large (Full Height)'],
    ['large', 'Large (75% Height)'],
    ['medium', 'Medium (50% Height)'],
    ['small', 'Small Thumbnail']
  ];
  var LAYOUTS = [
    ['auto', 'Auto — smart detect from photo shape'],
    ['side', 'Side-by-Side (Large Photo Left, Text Right)'],
    ['top', 'Stacked (Title on Top, Full Photo Below)'],
    ['bg', 'Full Poster (Background with Overlay)'],
    ['none', 'Do not show photo']
  ];

  function changed() { Panel.markDirty(); S.onChange(); }

  function init(opts) {
    S.listEl = opts.list;
    S.countEl = opts.count || null;
    S.onChange = opts.onChange || function () {};
  }

  function load(items, settings) {
    S.items = (items || []).map(function (a) { return AnnRender.blank(a); });
    if (settings) S.settings = Object.assign(S.settings, settings);
  }
  function items() { return S.items; }
  function settings() { return S.settings; }

  function add(seed, openIt) {
    S.items.unshift(AnnRender.blank(seed));
    S.open = 0;
    changed();
    render();
    if (openIt !== false && S.listEl) {
      var first = S.listEl.querySelector('.acard input[data-f="title"]');
      if (first) first.focus();
    }
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= S.items.length) return;
    var t = S.items[i]; S.items[i] = S.items[j]; S.items[j] = t;
    if (S.open === i) S.open = j; else if (S.open === j) S.open = i;
    changed(); render();
  }

  function reorder(from, to) {
    if (from === to || from < 0 || to < 0) return;
    var it = S.items.splice(from, 1)[0];
    S.items.splice(to, 0, it);
    S.open = -1;
    changed(); render();
  }

  function remove(i) {
    var gone = S.items[i], at = i;
    S.items.splice(i, 1);
    if (S.open === i) S.open = -1; else if (S.open > i) S.open--;
    changed(); render();
    Panel.toast('Deleted "' + (gone.title || gone.body || 'announcement').slice(0, 32) + '"', 'Undo', function () {
      S.items.splice(at, 0, gone);
      changed(); render();
    });
  }

  function clearAllExpired() {
    var now = Date.now();
    var before = S.items.length;
    S.items = S.items.filter(function (a) { return AnnRender.stateOf(a, now) !== 'expired'; });
    var purged = before - S.items.length;
    if (purged > 0) {
      S.open = -1;
      changed(); render();
      Panel.toast('Removed ' + purged + ' expired announcement' + (purged === 1 ? '' : 's') + '.');
    } else {
      Panel.toast('No expired announcements to clear.');
    }
  }

  function duplicate(i) {
    S.items.splice(i + 1, 0, AnnRender.blank(JSON.parse(JSON.stringify(S.items[i]))));
    S.open = i + 1;
    changed(); render();
  }

  function set(i, field, value) {
    S.items[i][field] = value;
    changed();
  }

  function setTab(tabName) {
    S.currentTab = tabName;
    render();
  }

  function chipsFor(a) {
    var now = Date.now();
    var st = AnnRender.stateOf(a, now);
    var label = AnnRender.countdownLabel(a, now);
    var out = '';

    if (st === 'live') out += '<span class="chip chip-live">' + esc(label) + '</span>';
    else if (st === 'scheduled') out += '<span class="chip chip-sched">' + esc(label) + '</span>';
    else if (st === 'expired') out += '<span class="chip chip-exp">' + esc(label) + '</span>';
    else out += '<span class="chip chip-exp">Draft</span>';

    if (a.emphasis === 'urgent') out += '<span class="chip chip-urgent">Urgent</span>';
    else if (a.emphasis === 'highlight') out += '<span class="chip chip-hl">Highlight</span>';
    if (a.soloPage || a.span === 'page') out += '<span class="chip chip-hl" style="background:#ede9fe;color:#5b21b6">Full-Page Poster</span>';
    if (a.pinned) out += '<span class="chip chip-pin">Pinned</span>';
    return out;
  }

  function matches(a, q) {
    if (!q) return true;
    return ((a.title || '') + ' ' + (a.body || '') + ' ' + (a.label || '')).toLowerCase().indexOf(q) !== -1;
  }

  function tabMatches(a, tab) {
    var now = Date.now();
    var st = AnnRender.stateOf(a, now);
    if (tab === 'active') return st === 'live';
    if (tab === 'scheduled') return st === 'scheduled';
    if (tab === 'expired') return st === 'expired';
    return true;
  }

  function renderTabBar(containerEl) {
    if (!containerEl) return;
    var now = Date.now();
    var counts = { all: S.items.length, active: 0, scheduled: 0, expired: 0 };
    S.items.forEach(function (a) {
      var st = AnnRender.stateOf(a, now);
      if (st === 'live') counts.active++;
      else if (st === 'scheduled') counts.scheduled++;
      else if (st === 'expired') counts.expired++;
    });

    containerEl.innerHTML =
      '<div class="tab-bar">'
      + '<button type="button" class="tab-btn' + (S.currentTab === 'active' ? ' on' : '') + '" data-tab="active">Active on TV <span class="badge">' + counts.active + '</span></button>'
      + '<button type="button" class="tab-btn' + (S.currentTab === 'scheduled' ? ' on' : '') + '" data-tab="scheduled">Scheduled <span class="badge">' + counts.scheduled + '</span></button>'
      + '<button type="button" class="tab-btn' + (S.currentTab === 'expired' ? ' on' : '') + '" data-tab="expired">Expired <span class="badge">' + counts.expired + '</span></button>'
      + '<button type="button" class="tab-btn' + (S.currentTab === 'all' ? ' on' : '') + '" data-tab="all">All <span class="badge">' + counts.all + '</span></button>'
      + (counts.expired > 0 ? '<button type="button" class="danger sm" style="margin-left:auto" id="btn-purge-expired">Clear Expired (' + counts.expired + ')</button>' : '')
      + '</div>';

    containerEl.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.dataset.tab); });
    });
    var purgeBtn = containerEl.querySelector('#btn-purge-expired');
    if (purgeBtn) purgeBtn.addEventListener('click', clearAllExpired);
  }

  function render() {
    if (!S.listEl) return;
    var q = S.filter.trim().toLowerCase();
    var shown = 0;

    var tabsEl = document.getElementById('ann-tabs');
    if (tabsEl) renderTabBar(tabsEl);

    if (!S.items.length) {
      S.listEl.innerHTML = '<div class="empty-state"><h3>Nothing on the board yet</h3>'
        + '<p>Click "+ New announcement" to post a notice. It will reach the TV instantly.</p></div>';
      if (S.countEl) S.countEl.textContent = '';
      return;
    }

    S.listEl.innerHTML = S.items.map(function (a, i) {
      var inTab = tabMatches(a, S.currentTab);
      var inSearch = matches(a, q);
      var visible = inTab && inSearch;
      if (visible) shown++;
      var accent = AnnRender.accentOf(a, i);

      return '<div class="acard' + (S.open === i ? ' open' : '') + (visible ? '' : ' hidden') + '"'
        + ' data-i="' + i + '" draggable="true" style="--acc:var(--acc-' + accent + ')">'
        + head(a, i) + body(a, i) + '</div>';
    }).join('');

    if (S.countEl) {
      S.countEl.textContent = shown + ' of ' + S.items.length + (S.items.length === 1 ? ' notice' : ' notices');
    }
    wire();
  }

  function head(a, i) {
    var label = a.title || a.body || '';
    return '<div class="acard-head" data-act="toggle">'
      + '<span class="acard-grip" data-act="grip" title="Drag to reorder">' + Panel.icon('grip') + '</span>'
      + (a.image ? '<img class="acard-thumb" src="' + esc(a.image) + '" alt="">' : '')
      + '<div class="acard-title">' + (label ? esc(label.slice(0, 70)) : '<span class="empty">Untitled announcement</span>') + '</div>'
      + '<div class="acard-chips">' + chipsFor(a) + '</div>'
      + '<span class="acard-caret">' + Panel.icon('caret') + '</span>'
      + '</div>';
  }

  function opts(list, current) {
    return list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (current === v ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
  }

  function body(a, i) {
    var swatches = '<button type="button" class="swatch auto' + (!a.accent ? ' on' : '') + '" data-act="accent" data-v="" title="Automatic color"></button>'
      + AnnRender.ACCENTS.map(function (c) {
        return '<button type="button" class="swatch' + (a.accent === c ? ' on' : '') + '" data-act="accent" data-v="' + c + '"'
          + ' style="--sw:var(--acc-' + c + ')" title="' + c + '"></button>';
      }).join('');

    var emph = [['normal', 'Normal'], ['highlight', 'Highlight'], ['urgent', 'Urgent Alert']].map(function (e) {
      return '<button type="button" data-act="emph" data-v="' + e[0] + '"'
        + ((a.emphasis || 'normal') === e[0] ? ' class="on"' : '') + '>' + e[1] + '</button>';
    }).join('');

    var picture = a.image
      ? '<div class="drop" data-act="drop"><div class="drop-preview">'
          + '<img src="' + esc(a.image) + '" alt="">'
          + '<div class="drop-meta"><b>Picture attached</b><br>'
          + (a.imageW ? a.imageW + ' x ' + a.imageH + ' — ' + esc(AnnRender.pickImageLayout(a)) : 'Click or drop to replace')
          + '</div></div><input type="file" accept="image/*"></div>'
      : '<div class="drop" data-act="drop">' + Panel.icon('image') + ' Click, drop or paste a flyer/image'
          + '<input type="file" accept="image/*"></div>';

    var imgControls = a.image
      ? '<div class="row fg">'
        + '<div><label>Layout</label><select data-f="imageLayout">' + opts(LAYOUTS, a.imageLayout || 'auto') + '</select></div>'
        + '<div><label>Size</label><select data-f="imageSize">' + opts(SIZES, a.imageSize || 'fill') + '</select></div>'
        + '<div><label>Fit</label><select data-f="imageFit">'
          + opts([['contain', 'Show whole photo (No cropping)'], ['cover', 'Fill frame (Edge-to-edge crop)']], a.imageFit || 'contain') + '</select></div>'
        + '</div>'
        + '<div class="preset-pills" style="margin-top:.4rem">'
          + '<span class="note" style="margin-right:.3rem">Photo Presets:</span>'
          + '<button type="button" class="preset-pill" data-preset="photo-huge">⚡ Maximize Size</button>'
          + '<button type="button" class="preset-pill" data-preset="photo-side">Side-by-Side</button>'
          + '<button type="button" class="preset-pill" data-preset="photo-bg">Full Background</button>'
          + '<button type="button" class="preset-pill" data-preset="photo-contain">Fit Entire Image</button>'
        + '</div>'
      : '';

    return '<div class="acard-body"><div class="editor-grid">'
      + '<div class="fg"><label>Headline</label><input type="text" data-f="title" value="' + esc(a.title) + '" placeholder="What is happening"></div>'
      + '<div class="fg"><label>Details / Message</label><textarea data-f="body" placeholder="Where, when, details, or notes">' + esc(a.body) + '</textarea></div>'
      + '<div class="row fg">'
        + '<div><label>Tag / Category</label><input type="text" data-f="label" value="' + esc(a.label) + '" placeholder="Rush, Social, Meeting..."></div>'
        + '<div><label>When Subtitle</label><input type="text" data-f="when" value="' + esc(a.when) + '" placeholder="Sun 7 PM"></div>'
      + '</div>'
      + '<div class="fg"><label>Color Accent</label><div class="swatches">' + swatches + '</div></div>'
      + '<div class="fg"><label>Emphasis</label><div class="seg">' + emph + '</div></div>'
      + '<div class="fg"><label>Attached Picture / Flyer</label>' + picture + '</div>'
      + imgControls
      + '<div class="card" style="background:#f8fafc;padding:.9rem;margin-top:.6rem">'
        + '<label style="font-weight:750">Auto-Remove &amp; Scheduling</label>'
        + '<div class="row fg">'
          + '<div><label>Show from (starts)</label><input type="datetime-local" data-f="starts" value="' + esc(a.starts) + '"></div>'
          + '<div><label>Show until (expires)</label><input type="datetime-local" data-f="ends" value="' + esc(a.ends) + '"></div>'
        + '</div>'
        + '<div class="preset-pills">'
          + '<span class="note" style="margin-right:.3rem">Quick Expiry:</span>'
          + '<button type="button" class="preset-pill" data-preset="tonight">Tonight (11:59 PM)</button>'
          + '<button type="button" class="preset-pill" data-preset="dinner">After Dinner (8 PM)</button>'
          + '<button type="button" class="preset-pill" data-preset="sunday">End of Week (Sun)</button>'
          + '<button type="button" class="preset-pill" data-preset="tomorrow">Tomorrow Night</button>'
          + '<button type="button" class="preset-pill" data-preset="clear">No Expiry</button>'
        + '</div>'
      + '</div>'
      + '<div class="row fg" style="margin-top:.8rem">'
        + '<label class="switch" style="border:1px solid var(--line);border-radius:10px;padding:.55rem .75rem;background:#f8fafc;flex:1">'
          + '<input type="checkbox" data-f="soloPage"' + (a.soloPage || a.span === 'page' ? ' checked' : '') + '> <b>Full-Page Spotlight</b> (uses entire TV slide for large photo &amp; spacious text)</label>'
        + '<label class="switch" style="border:1px solid var(--line);border-radius:10px;padding:.55rem .75rem;background:#f8fafc;flex:1">'
          + '<input type="checkbox" data-f="pinned"' + (a.pinned ? ' checked' : '') + '> <b>Pin to front</b> of the board</label>'
      + '</div>'
      + '<div class="acard-tools">'
        + '<button type="button" class="ghost sm" data-act="up"' + (i === 0 ? ' disabled' : '') + '>' + Panel.icon('up') + 'Up</button>'
        + '<button type="button" class="ghost sm" data-act="down"' + (i === S.items.length - 1 ? ' disabled' : '') + '>' + Panel.icon('down') + 'Down</button>'
        + '<button type="button" class="ghost sm" data-act="dup">' + Panel.icon('copy') + 'Duplicate</button>'
        + (a.image ? '<button type="button" class="ghost sm" data-act="unimg">Remove picture</button>' : '')
        + '<button type="button" class="danger sm" style="margin-left:auto" data-act="del">' + Panel.icon('trash') + 'Delete</button>'
      + '</div>'
      + '</div></div>';
  }

  function applyPreset(i, preset) {
    var now = new Date();
    var isoDate = function (d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    if (preset === 'photo-huge') {
      set(i, 'soloPage', true);
      set(i, 'imageLayout', 'side');
      set(i, 'imageSize', 'fill');
      set(i, 'imageFit', 'contain');
    } else if (preset === 'photo-side') {
      set(i, 'imageLayout', 'side');
      set(i, 'imageSize', 'fill');
      set(i, 'imageFit', 'contain');
    } else if (preset === 'photo-bg') {
      set(i, 'imageLayout', 'bg');
      set(i, 'imageSize', 'fill');
      set(i, 'imageFit', 'cover');
    } else if (preset === 'photo-contain') {
      set(i, 'imageFit', 'contain');
      set(i, 'imageSize', 'fill');
    } else if (preset === 'tonight') {
      set(i, 'ends', isoDate(now) + 'T23:59');
    } else if (preset === 'dinner') {
      set(i, 'ends', isoDate(now) + 'T20:00');
    } else if (preset === 'sunday') {
      var d = new Date(now);
      var day = d.getDay();
      var diff = (7 - day) % 7; // days until Sunday
      d.setDate(d.getDate() + diff);
      set(i, 'ends', isoDate(d) + 'T23:59');
    } else if (preset === 'tomorrow') {
      var d2 = new Date(now);
      d2.setDate(d2.getDate() + 1);
      set(i, 'ends', isoDate(d2) + 'T23:59');
    } else if (preset === 'clear') {
      set(i, 'ends', '');
    }
    render();
  }

  function repaintHead(i) {
    var card = S.listEl.querySelector('.acard[data-i="' + i + '"]');
    if (!card) return;
    var a = S.items[i];
    card.style.setProperty('--acc', 'var(--acc-' + AnnRender.accentOf(a, i) + ')');
    var t = card.querySelector('.acard-title');
    var label = a.title || a.body || '';
    if (t) t.innerHTML = label ? esc(label.slice(0, 70)) : '<span class="empty">Untitled announcement</span>';
    var c = card.querySelector('.acard-chips');
    if (c) c.innerHTML = chipsFor(a);
  }

  function wire() {
    S.listEl.querySelectorAll('.acard').forEach(function (card) {
      var i = +card.dataset.i;

      card.querySelector('.acard-head').addEventListener('click', function (e) {
        if (e.target.closest('[data-act="grip"]')) return;
        S.open = S.open === i ? -1 : i;
        render();
      });

      card.querySelectorAll('[data-f]').forEach(function (input) {
        var f = input.dataset.f;
        var ev = input.type === 'checkbox' || input.tagName === 'SELECT' || input.type === 'date' || input.type === 'datetime-local' ? 'change' : 'input';
        input.addEventListener(ev, function () {
          set(i, f, input.type === 'checkbox' ? input.checked : input.value);
          repaintHead(i);
        });
      });

      card.querySelectorAll('[data-preset]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          applyPreset(i, btn.dataset.preset);
        });
      });

      card.querySelectorAll('[data-act]').forEach(function (el) {
        var act = el.dataset.act;
        if (act === 'toggle' || act === 'grip' || act === 'drop') return;
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          if (act === 'accent') {
            set(i, 'accent', el.dataset.v);
            card.querySelectorAll('[data-act="accent"]').forEach(function (s) { s.classList.remove('on'); });
            el.classList.add('on');
            repaintHead(i);
          } else if (act === 'emph') {
            set(i, 'emphasis', el.dataset.v);
            card.querySelectorAll('[data-act="emph"]').forEach(function (s) { s.classList.remove('on'); });
            el.classList.add('on');
            repaintHead(i);
          } else if (act === 'up') move(i, -1);
          else if (act === 'down') move(i, 1);
          else if (act === 'dup') duplicate(i);
          else if (act === 'del') remove(i);
          else if (act === 'unimg') { set(i, 'image', ''); set(i, 'imageW', 0); set(i, 'imageH', 0); render(); }
        });
      });

      var drop = card.querySelector('[data-act="drop"]');
      if (drop) wireDrop(drop, i);

      card.addEventListener('dragstart', function (e) {
        if (!e.target.closest('.acard-grip')) { e.preventDefault(); return; }
        S.dragFrom = i;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) {}
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
        S.listEl.querySelectorAll('.acard').forEach(function (c) { c.classList.remove('drop-before', 'drop-after'); });
      });
      card.addEventListener('dragover', function (e) {
        if (S.dragFrom < 0 || S.dragFrom === i) return;
        e.preventDefault();
        var r = card.getBoundingClientRect();
        var after = e.clientY > r.top + r.height / 2;
        card.classList.toggle('drop-after', after);
        card.classList.toggle('drop-before', !after);
      });
      card.addEventListener('dragleave', function () { card.classList.remove('drop-before', 'drop-after'); });
      card.addEventListener('drop', function (e) {
        if (S.dragFrom < 0) return;
        e.preventDefault();
        var r = card.getBoundingClientRect();
        var to = e.clientY > r.top + r.height / 2 ? i + 1 : i;
        if (S.dragFrom < to) to--;
        var from = S.dragFrom;
        S.dragFrom = -1;
        reorder(from, to);
      });
    });
  }

  function wireDrop(el, i) {
    var input = el.querySelector('input[type=file]');
    function take(file) {
      Panel.uploadImage(file, function (url, w, h) {
        set(i, 'image', url); set(i, 'imageW', w); set(i, 'imageH', h);
        render();
        Panel.status('Picture uploaded.', 'ok');
      }, function (m) { Panel.status(m, 'busy'); });
    }
    el.addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
    input.addEventListener('change', function () { if (input.files[0]) take(input.files[0]); });
    el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', function () { el.classList.remove('over'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) take(f);
    });
    el.addEventListener('paste', function (e) {
      var it = (e.clipboardData || {}).items || [];
      for (var k = 0; k < it.length; k++) {
        if (it[k].type.indexOf('image') === 0) { take(it[k].getAsFile()); e.preventDefault(); return; }
      }
    });
    el.tabIndex = 0;
  }

  function templateBar(el) {
    el.innerHTML = TEMPLATES.map(function (t, k) {
      return '<button type="button" class="ghost sm" data-t="' + k + '">' + esc(t.name) + '</button>';
    }).join('');
    el.querySelectorAll('[data-t]').forEach(function (b) {
      b.addEventListener('click', function () { add(JSON.parse(JSON.stringify(TEMPLATES[+b.dataset.t].a))); });
    });
  }

  function setFilter(q) { S.filter = q; render(); }

  /** Shared widget-level controls for announcement panel behavior */
  function renderSettings(el) {
    var s = S.settings;
    el.innerHTML =
      '<div class="fg"><label>How announcements are arranged</label><div class="seg" id="ss-layout">'
      + [['auto', 'Automatic (1 or 2 col)'], ['stack', 'One column'], ['grid2', 'Two columns']].map(function (o) {
          return '<button type="button" data-v="' + o[0] + '"' + (s.layout === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
        }).join('')
      + '</div></div>'
      + '<div class="fg"><label>Base page duration <b id="ss-secs">' + s.pageSeconds + 's</b></label>'
      + '<input type="range" id="ss-range" min="5" max="60" step="1" value="' + s.pageSeconds + '" style="width:100%">'
      + '</div>'
      + '<div class="toggles">'
      + '<label class="switch"><input type="checkbox" id="ss-adaptive"' + (s.adaptiveTimer !== false ? ' checked' : '') + '> Adaptive Reading Time (give dense notices more time)</label>'
      + '<label class="switch"><input type="checkbox" id="ss-fill"' + (s.autoFill !== false ? ' checked' : '') + '> Grow text to fill the panel</label>'
      + '<label class="switch"><input type="checkbox" id="ss-prog"' + (s.showProgress !== false ? ' checked' : '') + '> Show the page timer bar</label>'
      + '</div>';

    el.querySelectorAll('#ss-layout button').forEach(function (b) {
      b.addEventListener('click', function () {
        s.layout = b.dataset.v;
        el.querySelectorAll('#ss-layout button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        changed();
      });
    });
    el.querySelector('#ss-range').addEventListener('input', function () {
      s.pageSeconds = +this.value;
      el.querySelector('#ss-secs').textContent = s.pageSeconds + 's';
      changed();
    });
    el.querySelector('#ss-adaptive').addEventListener('change', function () { s.adaptiveTimer = this.checked; changed(); });
    el.querySelector('#ss-fill').addEventListener('change', function () { s.autoFill = this.checked; changed(); });
    el.querySelector('#ss-prog').addEventListener('change', function () { s.showProgress = this.checked; changed(); });
  }

  return {
    init: init, load: load, items: items, settings: settings, render: render,
    add: add, setFilter: setFilter, setTab: setTab, templateBar: templateBar,
    renderSettings: renderSettings, renderTabBar: renderTabBar, changed: changed,
    clearAllExpired: clearAllExpired
  };
})();


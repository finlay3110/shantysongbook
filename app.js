/* ============================================================
   UCN SONGBOOK — APP LOGIC

   Songs are loaded from songs.json at startup via fetch(), which keeps
   the app and the data separate:
     index.html / app.js — the app (rarely changes)
     songs.json          — the data (edit this to add songs)

   fetch() needs a web server, so opening index.html straight off disk
   will not work. Use the Netlify URL, or run any static server locally.

   Lyric parsing lives in lyrics.js, shared with pdf-export.js so the
   app and the PDF can never disagree about what counts as a chorus.
   ============================================================ */
(function () {
  'use strict';

  var SONGS = [];
  var songById = Object.create(null);

  /* ── STATE ──────────────────────────────────────────────── */
  var state = {
    category: 'All',
    query: '',
    currentSong: null,
    favourites: [],
    highlightChorus: true,
    chorusDisplay: 'once',
    fontSize: 16,
    font: 'system',
    theme: 'dark',
    wakeLockEnabled: true,
    scrollSpeed: 26
  };

  function readState() {
    try {
      var s = JSON.parse(localStorage.getItem('ucn_s') || '{}');
      if (Array.isArray(s.f)) state.favourites = s.f;
      if (s.hc !== undefined) state.highlightChorus = !!s.hc;
      if (s.cd) state.chorusDisplay = s.cd;
      if (s.fs) state.fontSize = s.fs;
      if (s.fn) state.font = s.fn;
      if (s.th) state.theme = s.th;
      if (s.wk !== undefined) state.wakeLockEnabled = !!s.wk;
      if (s.ss) state.scrollSpeed = s.ss;
    } catch (e) { /* corrupt or unavailable storage — defaults are fine */ }
  }

  function saveState() {
    try {
      localStorage.setItem('ucn_s', JSON.stringify({
        f: state.favourites, hc: state.highlightChorus, cd: state.chorusDisplay,
        fs: state.fontSize, fn: state.font, th: state.theme,
        wk: state.wakeLockEnabled, ss: state.scrollSpeed
      }));
    } catch (e) { /* private mode / quota — settings just won't persist */ }
  }

  /* ── HELPERS ────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  /* Escapes quotes as well as angle brackets — the old version did not,
     and its output was being interpolated into HTML attributes. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Renders an icon from the <symbol> sprite in index.html. */
  function icon(name, cls) {
    return '<svg class="' + (cls || 'icn') + '" aria-hidden="true" focusable="false"><use href="#i-' +
      name + '"/></svg>';
  }

  var CAT_ICON_NAMES = {
    'Patriotic Songs': 'flag', 'Bar/Drinking Songs': 'beer', 'Crew Ballads': 'drum',
    'Accompanied Songs': 'musicnote', 'Songs About Us': 'starOutline',
    'Fragments and Works in Progress': 'notepad', 'Traditional Songs': 'anchor',
    'Movie/TV': 'clapper', 'Improvised Songs': 'sparkle', 'Folk & Other': 'guitar'
  };
  function catIconName(cat) { return CAT_ICON_NAMES[cat] || 'musicnote'; }

  /* Case- and accent-insensitive folding that preserves string length, so
     match offsets found in the folded text still line up with the original
     and can be highlighted without re-scanning. */
  function fold(str) {
    var out = '', s = String(str).toLowerCase();
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '’' || c === '‘' || c === 'ʼ' || c === '`' || c === '´') { out += "'"; continue; }
      if (c === '“' || c === '”') { out += '"'; continue; }
      if (c === '–' || c === '—') { out += '-'; continue; }
      if (c.charCodeAt(0) < 128) { out += c; continue; }
      var d = c.normalize ? c.normalize('NFD').replace(/[̀-ͯ]/g, '') : c;
      out += d.length ? d.charAt(0) : c;
    }
    return out;
  }

  /* Escaped HTML with <mark> around every occurrence of the query. */
  function highlight(raw, foldedQuery) {
    var text = String(raw == null ? '' : raw);
    if (!foldedQuery) return esc(text);
    var hay = fold(text), out = '', from = 0, at;
    while ((at = hay.indexOf(foldedQuery, from)) > -1) {
      out += esc(text.slice(from, at)) + '<mark>' + esc(text.slice(at, at + foldedQuery.length)) + '</mark>';
      from = at + foldedQuery.length;
    }
    return out + esc(text.slice(from));
  }

  /* One line of lyrics around the match, for songs that matched only on
     their lyrics — otherwise the card gives no clue why it is in the list. */
  function lyricSnippet(song, foldedQuery) {
    var at = song._f.lyrics.indexOf(foldedQuery);
    if (at < 0) return '';
    var raw = song.lyrics;
    var start = raw.lastIndexOf('\n', at) + 1;
    var end = raw.indexOf('\n', at);
    if (end < 0) end = raw.length;
    return highlight(raw.slice(start, end).trim(), foldedQuery);
  }

  function toast(msg, isError) {
    var host = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, isError ? 6000 : 3200);
  }

  /* ── SEARCH & FILTERING ─────────────────────────────────── */
  /* Punctuation-free copy used only as a matching fallback, so typing
     "barretts" or "nelsons blood" finds "Barrett's" and "Nelson's Blood".
     It cannot be used for highlighting — dropping characters shifts every
     offset — so `_f` (same length as the original) stays the primary index. */
  function loosen(s) { return fold(s).replace(/['\-.,!?]/g, ''); }

  function indexSongs() {
    songById = Object.create(null);
    SONGS.forEach(function (s) {
      songById[s.id] = s;
      s._f = {
        title: fold(s.title || ''),
        tune: fold(s.tune || ''),
        words: fold(s.words || ''),
        lyrics: fold(s.lyrics || '')
      };
      s._l = {
        title: loosen(s.title || ''),
        tune: loosen(s.tune || ''),
        words: loosen(s.words || ''),
        lyrics: loosen(s.lyrics || '')
      };
    });
  }

  /* Title matches rank above tune/author, which rank above lyrics-only
     matches, so searching "grog" still puts the song called Grog first. */
  function filteredSongs() {
    var q = fold(state.query.trim());
    var pool = SONGS.filter(function (s) {
      if (state.category === 'Favourites') return state.favourites.indexOf(s.id) > -1;
      if (state.category !== 'All' && s.category !== state.category) return false;
      return true;
    });
    if (!q) return pool;

    var lq = loosen(state.query.trim());
    var scored = [];
    pool.forEach(function (s, i) {
      var rank = -1;
      if (s._f.title.indexOf(q) > -1) rank = 0;
      else if (s._f.tune.indexOf(q) > -1 || s._f.words.indexOf(q) > -1) rank = 1;
      else if (s._f.lyrics.indexOf(q) > -1) rank = 2;
      /* Punctuation-insensitive fallback, ranked last: it finds the song
         but cannot highlight, so exact matches always sort above it. */
      else if (lq && (s._l.title.indexOf(lq) > -1 || s._l.tune.indexOf(lq) > -1 ||
                      s._l.words.indexOf(lq) > -1 || s._l.lyrics.indexOf(lq) > -1)) rank = 3;
      if (rank > -1) scored.push({ s: s, rank: rank, i: i });
    });
    scored.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
    return scored.map(function (x) { x.s._rank = x.rank; return x.s; });
  }

  /* ── LIST ───────────────────────────────────────────────── */
  function renderList() {
    var songs = filteredSongs();
    var el = $('song-list');
    var q = fold(state.query.trim());

    $('list-meta').textContent = songs.length === SONGS.length
      ? SONGS.length + ' songs'
      : songs.length + ' of ' + SONGS.length + ' songs';

    /* Either filter alone is worth offering to clear — this used to
       require both a query AND a category before it would appear. */
    $('clear-all-btn').classList.toggle('vis', !!state.query || state.category !== 'All');

    if (!songs.length) {
      el.innerHTML = state.category === 'Favourites'
        ? '<div class="no-res"><div class="nr-icon" style="color:var(--star)">' + icon('starOutline', 'icn icn-lg') +
          '</div><div>No favourites yet</div><div style="font-size:.8rem;margin-top:6px;color:var(--text-dim);">Tap the star on any song to add it here</div></div>'
        : '<div class="no-res"><div class="nr-icon">' + icon('searchSlash', 'icn icn-lg') +
          '</div><div>No songs found</div></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var isFav = state.favourites.indexOf(s.id) > -1;
      var snip = (q && s._rank === 2) ? lyricSnippet(s, q) : '';

      html += '<div class="song-card' + (isFav ? ' fav' : '') + '">' +
        '<button class="cmain" data-id="' + s.id + '">' +
          '<span class="ci">' + icon(catIconName(s.category)) + '</span>' +
          '<span class="cb">' +
            '<span class="ct">' + highlight(s.title, q) +
              (s.category === 'Traditional Songs' ? '<span class="trad-badge">trad</span>' : '') +
            '</span>' +
            '<span class="cs">' + icon('musicnote') + ' ' + highlight(s.tune || 'Tune unknown', q) + '</span>' +
            (s.source_book
              ? '<span class="cp">' + icon('book') + ' ' + esc(s.source_book) +
                (s.source_page != null ? ', p.' + esc(s.source_page) : '') + '</span>'
              : '') +
            (snip ? '<span class="csnip">' + icon('musicnote') + ' ' + snip + '</span>' : '') +
          '</span>' +
        '</button>' +
        '<button class="cstar' + (isFav ? ' active' : '') + '" data-fav="' + s.id + '"' +
          ' aria-pressed="' + (isFav ? 'true' : 'false') + '"' +
          ' aria-label="' + (isFav ? 'Remove ' : 'Add ') + esc(s.title) + (isFav ? ' from' : ' to') + ' favourites">' +
          icon(isFav ? 'starFilled' : 'starOutline') +
        '</button>' +
      '</div>';
    }
    el.innerHTML = html;
  }

  /* Categories are computed from the songs, so a new category in
     songs.json appears on its own. 'Favourites' is a pseudo-category
     inserted after 'All'. Built once — selecting a pill only toggles
     classes, because rebuilding the strip threw away its horizontal
     scroll position and jumped the pills around under the user's thumb. */
  function buildCategories() {
    var seen = [], i;
    for (i = 0; i < SONGS.length; i++) {
      if (seen.indexOf(SONGS[i].category) === -1) seen.push(SONGS[i].category);
    }
    var cats = ['All', 'Favourites'].concat(seen);
    var html = '';
    for (i = 0; i < cats.length; i++) {
      var c = cats[i], label;
      if (c === 'All') label = 'All';
      else if (c === 'Favourites') label = icon('starFilled') + ' Favourites';
      else {
        label = icon(catIconName(c)) + ' ' +
          esc(c.split('/')[0].replace(' Songs', '').replace(' Ballads', '').replace(' in Progress', '').trim());
      }
      html += '<button class="cpill' + (state.category === c ? ' active' : '') +
        (c === 'Favourites' ? ' fav-pill' : '') + '" role="tab" data-cat="' + esc(c) +
        '" aria-selected="' + (state.category === c ? 'true' : 'false') + '">' + label + '</button>';
    }
    $('cat-tabs').innerHTML = html;
  }

  function syncCategoryPills() {
    var pills = $('cat-tabs').querySelectorAll('.cpill');
    for (var i = 0; i < pills.length; i++) {
      var on = pills[i].dataset.cat === state.category;
      pills[i].classList.toggle('active', on);
      pills[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  /* ── LYRIC RENDERING ────────────────────────────────────── */
  function chorusBlockHtml(block, q) {
    var label = block.label && !/^chorus$/i.test(block.label) ? block.label : 'Chorus';
    return '<div class="lyric-chorus' + (state.highlightChorus ? '' : ' no-highlight') + '">' +
      '<div class="chorus-label">' + icon('musicnote') + ' ' + esc(label) + '</div>' +
      block.lines.map(function (l) {
        return '<p>' + (l ? highlight(l, q) : '&nbsp;') + '</p>';
      }).join('') + '</div>';
  }

  function renderLyrics(lyrics) {
    var blocks = window.UCN_parseLyrics(lyrics);
    var q = fold(state.query.trim());
    var html = '';

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === 'label') {
        html += '<div class="lyric-section-label">' + esc(b.text) + '</div>';
      } else if (b.type === 'chorus') {
        html += chorusBlockHtml(b, q);
      } else if (b.type === 'repeat') {
        var target = state.chorusDisplay === 'full' ? window.UCN_resolveRepeat(blocks, i) : null;
        html += target
          ? chorusBlockHtml(target, q)
          : '<p class="lyric-instruction">' + icon('repeat') + ' ' + esc(b.text) + '</p>';
      } else {
        html += '<div class="lyric-block">' + b.lines.map(function (l) {
          return '<p>' + (l ? highlight(l, q) : '&nbsp;') + '</p>';
        }).join('') + '</div>';
      }
    }
    return html;
  }

  /* ── DETAIL VIEW ────────────────────────────────────────── */
  function renderSong(id) {
    var song = songById[id];
    if (!song) return false;
    state.currentSong = id;

    var q = fold(state.query.trim());
    var trad = song.category === 'Traditional Songs' ? '<span class="trad-badge">traditional</span>' : '';
    var source = song.source_book
      ? '<div class="ir source"><span>' + icon('book') + '</span><span>' + esc(song.source_book) +
        (song.source_page != null ? ', p.' + esc(song.source_page) : '') + '</span></div>'
      : '';

    $('song-info').innerHTML =
      '<h1>' + highlight(song.title, q) + trad + '</h1>' +
      '<div class="ir"><span>' + icon('musicnote') + '</span><span>' + highlight(song.tune || 'Tune unknown', q) + '</span></div>' +
      (song.words ? '<div class="ir"><span>' + icon('pencil') + '</span><span>' + highlight(song.words, q) + '</span></div>' : '') +
      source;

    $('lw').innerHTML = renderLyrics(song.lyrics);
    $('lw').scrollTop = 0;
    document.title = song.title + ' — UCN Songbook';
    $('detail-view').setAttribute('aria-label', song.title);
    updateFavBtn();
    return true;
  }

  function showDetail(id) {
    if (!renderSong(id)) return;
    $('list-view').hidden = true;
    $('detail-view').classList.add('vis');
    $('lw').focus();
    requestWakeLock();
  }

  function showList() {
    stopAutoScroll();
    releaseWakeLock();
    $('detail-view').classList.remove('vis');
    $('list-view').hidden = false;
    state.currentSong = null;
    document.title = 'UCN Songbook';
  }

  function updateFavBtn() {
    var btn = $('btn-fav');
    var isFav = state.favourites.indexOf(state.currentSong) > -1;
    btn.innerHTML = icon(isFav ? 'starFilled' : 'starOutline');
    btn.classList.toggle('active', isFav);
    btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    btn.setAttribute('aria-label', isFav ? 'Remove from favourites' : 'Add to favourites');
  }

  function toggleFav(id) {
    var i = state.favourites.indexOf(id);
    if (i === -1) state.favourites.push(id); else state.favourites.splice(i, 1);
    saveState();
    renderList();
    if (state.currentSong === id) updateFavBtn();
  }

  /* Avoids handing out the same song twice in a row, which happens
     surprisingly often once a category filter narrows the pool. */
  var lastRandom = null;
  function randomSong() {
    var pool = filteredSongs();
    if (!pool.length) { toast('Nothing to pick from — try clearing the filters.'); return; }
    var choices = pool.length > 1 ? pool.filter(function (s) { return s.id !== lastRandom; }) : pool;
    var pick = choices[Math.floor(Math.random() * choices.length)];
    lastRandom = pick.id;
    navigateToSong(pick.id);
  }

  /* ── ROUTING ────────────────────────────────────────────────
     The app used to have no history at all, so the browser/Android back
     button left the site entirely instead of returning to the list, and
     a song could not be linked to. Songs live in the hash (#/song/45);
     the search and category live in the query string and are written
     with replaceState so filtering does not fill up the back stack. */
  function songIdFromHash() {
    var m = /^#\/song\/(\d+)/.exec(location.hash);
    return m ? +m[1] : null;
  }

  function syncFilterUrl() {
    var p = new URLSearchParams();
    if (state.query) p.set('q', state.query);
    if (state.category !== 'All') p.set('cat', state.category);
    var qs = p.toString();
    try {
      history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) { /* file:// or sandboxed — routing is cosmetic here */ }
  }

  function navigateToSong(id) {
    if (songIdFromHash() === id) { showDetail(id); return; }
    location.hash = '#/song/' + id;   // pushes a history entry; route() runs on hashchange
  }

  function route() {
    var id = songIdFromHash();
    if (id != null && songById[id]) showDetail(id);
    else showList();
  }

  function readFiltersFromUrl() {
    var p = new URLSearchParams(location.search);
    var q = p.get('q'), cat = p.get('cat');
    if (q) { state.query = q; $('search-input').value = q; $('xcbtn').classList.add('vis'); }
    if (cat) state.category = cat;
  }

  /* ── PANELS ─────────────────────────────────────────────────
     Each panel pushes a history entry so the Android back gesture
     closes the sheet rather than leaving the song. Focus moves into
     the panel, is trapped while it is open, and is restored on close. */
  var openPanelName = null, panelReturnFocus = null, suppressRoute = false;
  var PANELS = {
    settings: { panel: 'spanel', overlay: 'sov' },
    about: { panel: 'apanel', overlay: 'aov' },
    export: { panel: 'epanel', overlay: 'eov' }
  };

  /* `a[href]` rather than `[href]`: the icon sprite fills these panels with
     SVG <use href="..."> nodes, which match [href] but cannot take focus —
     focusing one silently left focus outside the dialog. getClientRects()
     rather than offsetParent, because offsetParent is undefined on SVG
     elements (so `!== null` kept every one of them) and null for anything
     inside a position:fixed panel. */
  function focusables(el) {
    return Array.prototype.filter.call(
      el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      function (n) { return n.getClientRects().length > 0; }
    );
  }

  function openPanel(name) {
    if (openPanelName) closePanel();
    var cfg = PANELS[name];
    if (!cfg) return;
    openPanelName = name;
    panelReturnFocus = document.activeElement;
    var panel = $(cfg.panel);
    $(cfg.overlay).classList.add('vis');
    panel.classList.add('vis');
    panel.setAttribute('aria-hidden', 'false');
    var f = focusables(panel);
    if (f.length) f[0].focus();
    try { history.pushState({ ucnPanel: name }, ''); } catch (e) {}
  }

  function closePanel(fromPopstate) {
    if (!openPanelName) return;
    var cfg = PANELS[openPanelName];
    var panel = $(cfg.panel);
    panel.classList.remove('vis');
    panel.setAttribute('aria-hidden', 'true');
    $(cfg.overlay).classList.remove('vis');
    openPanelName = null;
    if (panelReturnFocus && panelReturnFocus.focus) panelReturnFocus.focus();
    panelReturnFocus = null;
    /* Closing by tap or Escape should also drop the history entry the
       panel pushed, so a later back press doesn't reopen nothing. */
    if (!fromPopstate) { suppressRoute = true; history.back(); }
  }

  /* ── WAKE LOCK ──────────────────────────────────────────────
     Phones locking mid-verse is the most likely real annoyance when
     singing off a screen. Best effort: unsupported browsers just skip. */
  var wakeLock = null;
  function requestWakeLock() {
    if (!state.wakeLockEnabled || !('wakeLock' in navigator) || !state.currentSong) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* denied, low battery, or not visible */ });
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.currentSong) requestWakeLock();
  });

  /* ── AUTO-SCROLL ────────────────────────────────────────────
     Hands-free scrolling for the long ones. Speed is in px/second and
     accumulates fractionally, so slow speeds still move smoothly. */
  var scrollRAF = null, scrollAcc = 0, scrollLast = 0;
  function autoScrollActive() { return scrollRAF !== null; }

  function stepScroll(ts) {
    var lw = $('lw');
    if (!scrollLast) scrollLast = ts;
    var dt = Math.min((ts - scrollLast) / 1000, 0.25);
    scrollLast = ts;
    scrollAcc += state.scrollSpeed * dt;
    var whole = Math.floor(scrollAcc);
    if (whole > 0) {
      scrollAcc -= whole;
      var before = lw.scrollTop;
      lw.scrollTop = before + whole;
      if (lw.scrollTop <= before) { stopAutoScroll(); return; }   // hit the bottom
    }
    scrollRAF = requestAnimationFrame(stepScroll);
  }

  function startAutoScroll() {
    if (scrollRAF !== null || !state.currentSong) return;
    scrollAcc = 0; scrollLast = 0;
    scrollRAF = requestAnimationFrame(stepScroll);
    var b = $('btn-scroll');
    b.innerHTML = icon('pause');
    b.classList.add('active');
    b.setAttribute('aria-label', 'Stop auto-scroll');
  }

  function stopAutoScroll() {
    if (scrollRAF !== null) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
    var b = $('btn-scroll');
    b.innerHTML = icon('play');
    b.classList.remove('active');
    b.setAttribute('aria-label', 'Start auto-scroll');
  }

  /* ── SETTINGS ───────────────────────────────────────────── */
  function applyTheme(t) {
    state.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    setActive('.thbtn', 'th', t);
    var dark = t === 'dark' || (t === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1B2A5E' : '#1B2A5E');
    saveState();
  }

  function setActive(sel, dataKey, value) {
    document.querySelectorAll(sel).forEach(function (b) {
      b.classList.toggle('active', b.dataset[dataKey] === value);
    });
  }

  function applyFont(f) {
    state.font = f;
    document.documentElement.removeAttribute('data-font');
    if (f !== 'system') document.documentElement.setAttribute('data-font', f);
    setActive('.fontbtn', 'font', f);
    saveState();
  }

  function applyFontSize(sz) {
    state.fontSize = Math.max(12, Math.min(28, sz));
    document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
    $('size-val').textContent = state.fontSize + 'px';
    saveState();
  }

  function applyChorusDisplay(v) {
    state.chorusDisplay = v;
    setActive('.cdbtn', 'cd', v);
    if (state.currentSong) renderSong(state.currentSong);
    saveState();
  }

  function applyScrollSpeed(v) {
    state.scrollSpeed = Math.max(8, Math.min(90, +v || 26));
    $('scroll-speed').value = state.scrollSpeed;
    $('scroll-speed-val').textContent = state.scrollSpeed;
    saveState();
  }

  /* ── PDF EXPORT ─────────────────────────────────────────────
     Lazy-loads pdf-export.js (jsPDF + fonts + QR/logo, ~900KB) the first
     time an export is actually requested, so browsing never pays that
     cost. Netlify serves it as a sibling file — no CDN involved. */
  var pdfModuleLoaded = false, pdfModuleLoading = false;

  function loadPdfExportModule(onReady, onError) {
    if (pdfModuleLoaded) { onReady(); return; }
    if (pdfModuleLoading) return;          // a load is already in flight
    pdfModuleLoading = true;
    var s = document.createElement('script');
    s.src = 'pdf-export.js';
    s.onload = function () { pdfModuleLoading = false; pdfModuleLoaded = true; onReady(); };
    s.onerror = function () { pdfModuleLoading = false; onError(); };
    document.head.appendChild(s);
  }

  function runExport(songs, label) {
    if (!songs.length) { toast('No songs to export.', true); return; }
    var btn = $('btn-export-pdf');
    btn.disabled = true;
    btn.innerHTML = icon('spinnerArc');
    btn.classList.add('spin');

    function finish() {
      btn.disabled = false;
      btn.innerHTML = icon('download');
      btn.classList.remove('spin');
    }

    loadPdfExportModule(function () {
      /* Let the browser paint the loading state before the synchronous
         (1-2s for a full songbook) PDF build blocks the main thread. */
      setTimeout(function () {
        try {
          window.UCN_generateSongbookPDF(songs);
          toast('Exported ' + songs.length + ' song' + (songs.length === 1 ? '' : 's') + ' — ' + label + '.');
        } catch (e) {
          toast('Could not generate the PDF: ' + e.message, true);
        }
        finish();
      }, 30);
    }, function () {
      toast('Could not load the PDF export module. Check that pdf-export.js is deployed alongside index.html.', true);
      finish();
    });
  }

  function openExportSheet() {
    var filtered = filteredSongs();
    var favs = SONGS.filter(function (s) { return state.favourites.indexOf(s.id) > -1; });
    $('exp-all-c').textContent = SONGS.length + ' songs';
    $('exp-filter-c').textContent = filtered.length + ' song' + (filtered.length === 1 ? '' : 's') +
      (state.query || state.category !== 'All' ? '' : ' (no filter set)');
    $('exp-favs-c').textContent = favs.length + ' song' + (favs.length === 1 ? '' : 's');
    $('exp-favs').disabled = !favs.length;
    $('exp-filter').disabled = !filtered.length;
    openPanel('export');
  }

  /* ── SHARE ──────────────────────────────────────────────── */
  function shareCurrentSong() {
    var song = songById[state.currentSong];
    if (!song) return;
    var url = location.origin + location.pathname + '#/song/' + song.id;
    if (navigator.share) {
      navigator.share({ title: song.title, text: song.title + ' — UCN Songbook', url: url })
        .catch(function () { /* user dismissed the sheet */ });
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(function () { toast('Link copied to clipboard.'); })
        .catch(function () { toast(url); });
      return;
    }
    toast(url);
  }

  /* ── MAINTAINER TOOLS ───────────────────────────────────────
     Ten taps on the logo opens the song entry generator.

     Hidden, not secured. The app is static files that every visitor
     downloads, so there is no such thing as a real lock here — what keeps
     people out is that the generator lives at an unguessable filename.
     The gesture just means nobody finds it by accident. Never put
     anything behind this that would matter if it got out.
     ─────────────────────────────────────────────────────────── */
  var TOOL_URL = 'tools/gen-187ab8a3.html';
  var TAPS_NEEDED = 10;
  var TAP_WINDOW = 1500;                      /* ms allowed between taps */
  var tapCount = 0, lastTap = 0;

  function onLogoTap() {
    var now = Date.now();
    /* Reset unless this tap followed the last one closely, so ordinary
       stray taps can never accumulate into the gesture. */
    tapCount = (now - lastTap < TAP_WINDOW) ? tapCount + 1 : 1;
    lastTap = now;
    if (tapCount < TAPS_NEEDED) return;       /* nothing shown until the last tap */
    tapCount = 0;
    window.open(TOOL_URL, '_blank', 'noopener');
  }

  /* ── EVENTS ─────────────────────────────────────────────── */
  function bindEvents() {
    $('tog-chorus').addEventListener('change', function (e) {
      state.highlightChorus = e.target.checked;
      if (state.currentSong) renderSong(state.currentSong);
      saveState();
    });
    $('tog-wake').addEventListener('change', function (e) {
      state.wakeLockEnabled = e.target.checked;
      if (state.wakeLockEnabled) requestWakeLock(); else releaseWakeLock();
      saveState();
    });
    $('scroll-speed').addEventListener('input', function (e) { applyScrollSpeed(e.target.value); });

    document.querySelectorAll('.fontbtn').forEach(function (b) {
      b.addEventListener('click', function () { applyFont(b.dataset.font); });
    });
    document.querySelectorAll('.thbtn').forEach(function (b) {
      b.addEventListener('click', function () { applyTheme(b.dataset.th); });
    });
    document.querySelectorAll('.cdbtn').forEach(function (b) {
      b.addEventListener('click', function () { applyChorusDisplay(b.dataset.cd); });
    });
    $('size-up').addEventListener('click', function () { applyFontSize(state.fontSize + 2); });
    $('size-down').addEventListener('click', function () { applyFontSize(state.fontSize - 2); });

    $('btn-settings').addEventListener('click', function () { openPanel('settings'); });
    document.querySelector('.logo').addEventListener('click', onLogoTap);
    $('btn-about').addEventListener('click', function () { openPanel('about'); });
    $('btn-export-pdf').addEventListener('click', function () {
      if (!$('btn-export-pdf').disabled) openExportSheet();
    });
    $('sov').addEventListener('click', function () { closePanel(); });
    $('aov').addEventListener('click', function () { closePanel(); });
    $('eov').addEventListener('click', function () { closePanel(); });

    $('exp-all').addEventListener('click', function () { closePanel(); runExport(SONGS.slice(), 'whole songbook'); });
    $('exp-filter').addEventListener('click', function () { closePanel(); runExport(filteredSongs(), 'current filter'); });
    $('exp-favs').addEventListener('click', function () {
      closePanel();
      runExport(SONGS.filter(function (s) { return state.favourites.indexOf(s.id) > -1; }), 'favourites');
    });

    $('btn-back').addEventListener('click', function () { history.back(); });
    $('btn-rand').addEventListener('click', randomSong);
    $('btn-drand').addEventListener('click', randomSong);
    $('btn-share').addEventListener('click', shareCurrentSong);
    $('btn-fav').addEventListener('click', function () { toggleFav(state.currentSong); });
    $('btn-scroll').addEventListener('click', function () {
      if (autoScrollActive()) stopAutoScroll(); else startAutoScroll();
    });
    /* Any manual scrub takes over from the auto-scroll. */
    ['touchstart', 'wheel'].forEach(function (evt) {
      $('lw').addEventListener(evt, function () { if (autoScrollActive()) stopAutoScroll(); }, { passive: true });
    });

    $('search-input').addEventListener('input', function (e) {
      state.query = e.target.value;
      $('xcbtn').classList.toggle('vis', !!state.query);
      renderList();
      $('song-list').scrollTop = 0;
      syncFilterUrl();
    });
    $('xcbtn').addEventListener('click', function () {
      state.query = '';
      $('search-input').value = '';
      $('xcbtn').classList.remove('vis');
      renderList();
      syncFilterUrl();
      $('search-input').focus();
    });
    $('clear-all-btn').addEventListener('click', function () {
      state.query = '';
      state.category = 'All';
      $('search-input').value = '';
      $('xcbtn').classList.remove('vis');
      syncCategoryPills();
      renderList();
      syncFilterUrl();
    });
    $('cat-tabs').addEventListener('click', function (e) {
      var pill = e.target.closest('.cpill');
      if (!pill) return;
      state.category = pill.dataset.cat;
      syncCategoryPills();
      renderList();
      $('song-list').scrollTop = 0;
      syncFilterUrl();
    });
    $('song-list').addEventListener('click', function (e) {
      var fav = e.target.closest('[data-fav]');
      if (fav) { toggleFav(+fav.dataset.fav); return; }
      var card = e.target.closest('[data-id]');
      if (card) navigateToSong(+card.dataset.id);
    });

    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', function () {
      /* A panel is on top: back closes it and goes no further. */
      if (openPanelName) { closePanel(true); return; }
      if (suppressRoute) { suppressRoute = false; return; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (openPanelName) { e.preventDefault(); closePanel(); return; }
        if (autoScrollActive()) { e.preventDefault(); stopAutoScroll(); return; }
        if (state.currentSong != null) { e.preventDefault(); history.back(); return; }
        if (state.query) { e.preventDefault(); $('xcbtn').click(); }
        return;
      }
      if (e.key === 'Tab' && openPanelName) {
        var f = focusables($(PANELS[openPanelName].panel));
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (openPanelName || e.metaKey || e.ctrlKey || e.altKey) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('search-input').focus(); $('search-input').select(); }
      else if ((e.key === 'r' || e.key === 'R') && !typing) { e.preventDefault(); randomSong(); }
      else if (e.key === ' ' && !typing && state.currentSong != null) {
        e.preventDefault();
        if (autoScrollActive()) stopAutoScroll(); else startAutoScroll();
      }
    });
  }

  /* ── SETTINGS UI INIT ───────────────────────────────────── */
  function initSettingsUi() {
    $('tog-chorus').checked = state.highlightChorus;
    $('tog-wake').checked = state.wakeLockEnabled;
    applyTheme(state.theme);
    applyFont(state.font);
    applyFontSize(state.fontSize);
    applyChorusDisplay(state.chorusDisplay);
    applyScrollSpeed(state.scrollSpeed);
  }

  /* ── BOOT ───────────────────────────────────────────────────
     Fetch songs.json, then start. On success the songs are cached to
     localStorage so a later visit with no signal (a LARP event, a pub
     basement) still works: it falls back to the last good copy and says
     so, instead of showing a blank error. The service worker precaches
     the app shell itself, which is what makes that fallback reachable
     at all — before it, an offline visit never got far enough to read
     the cache. */
  function boot() {
    var listEl = $('song-list');
    var CACHE_KEY = 'ucn_songs_cache';
    var CACHE_TIME_KEY = 'ucn_songs_cache_time';
    var SONGS_MODIFIED_KEY = 'ucn_songs_modified';

    function useSongs(data, fromCache) {
      SONGS = data;
      indexSongs();
      buildCategories();
      renderList();
      route();

      /* The About panel used to carry a hand-typed "Updated 26 June 2026"
         that nobody would remember to change. Prefer songs.json's
         Last-Modified — that is genuinely when the songs last changed —
         and fall back to when this device last cached them. */
      var modified = localStorage.getItem(SONGS_MODIFIED_KEY);
      var when = localStorage.getItem(CACHE_TIME_KEY);
      var stamp = modified ? new Date(modified) : (when ? new Date(+when) : null);
      $('about-updated').textContent = stamp && !isNaN(stamp)
        ? 'Songs updated ' + stamp.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
        : '';

      if (fromCache && !document.querySelector('.offline-banner')) {
        var banner = document.createElement('div');
        banner.className = 'offline-banner';
        banner.innerHTML = icon('warning') + ' Offline — showing songs saved from ' +
          esc(when ? new Date(+when).toLocaleDateString() : 'a previous visit');
        listEl.parentNode.insertBefore(banner, listEl);
      }
    }

    $('list-meta').textContent = '';
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading songs…</span></div>';

    fetch('songs.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' — is songs.json deployed alongside this file?');
        var lm = r.headers.get('Last-Modified');
        if (lm) { try { localStorage.setItem(SONGS_MODIFIED_KEY, lm); } catch (e) {} }
        return r.json();
      })
      .then(function (data) {
        if (!Array.isArray(data) || !data.length) throw new Error('songs.json is empty or not an array');
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
          localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
        } catch (e) { /* quota — the app still works, just no offline copy */ }
        useSongs(data, false);
      })
      .catch(function (err) {
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}
        if (cached && cached.length) { useSongs(cached, true); return; }

        $('list-meta').textContent = '';
        listEl.innerHTML =
          '<div class="load-error">' +
          '<div class="err-icon">' + icon('warning', 'icn icn-lg') + '</div>' +
          '<p>Could not load songs.</p>' +
          '<code>' + esc(err.message) + '</code>' +
          '<p style="margin-top:12px;font-size:.8rem;">Make sure <strong>songs.json</strong> is in the same folder as this file on Netlify.</p>' +
          '</div>';
      });
  }

  /* ── SERVICE WORKER ─────────────────────────────────────── */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* Registration failing is not fatal — the app just loses offline support. */
      });
    });
  }

  readState();
  initSettingsUi();
  readFiltersFromUrl();
  bindEvents();
  boot();
  registerServiceWorker();
})();

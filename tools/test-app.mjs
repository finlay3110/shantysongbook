#!/usr/bin/env node
/* ============================================================
   BROWSER TESTS

   The app has no framework and no build step, so these drive the real
   thing in a real browser: they serve the repo over HTTP and check
   behaviour that has actually broken before — chorus rendering, routing
   and history, filters, search, focus management, offline, and the
   layout measurements the design work is meant to hold to.

   Run:  node tools/test-app.mjs
         node tools/test-app.mjs --headed     (watch it happen)

   Needs Playwright:  npm install
   Exits non-zero if any check fails.
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADED = process.argv.includes('--headed');

/* Use a preinstalled Chromium when the environment provides one (some
   sandboxes ship a browser whose build number Playwright does not expect);
   otherwise fall back to Playwright's own, as CI does after
   `npx playwright install chromium`. */
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'
};

/* ── Tiny static server (no dependencies) ─────────────────── */
function serve() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Last-Modified': info.mtime.toUTCString(),
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ── Assertions ───────────────────────────────────────────── */
let passed = 0;
const failures = [];
function ok(name, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(name) { console.log(`\n${name}`); }

const { server, port } = await serve();
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: !HEADED });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });

const consoleErrors = [];
ctx.on('page', (pg) => {
  pg.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
});

const openApp = async (path = '/index.html') => {
  const pg = await ctx.newPage();
  await pg.goto(BASE + path);
  await pg.waitForFunction(() => window.__ucnReady === true || document.querySelectorAll('.song-card').length > 0,
    { timeout: 15000 });
  return pg;
};

try {
  /* ── Lyric rendering ────────────────────────────────────── */
  section('Lyric rendering (the bug that started all this)');
  {
    const pg = await openApp();
    /* Songs whose chorus headings the old parser did not recognise. */
    for (const [id, expected] of [[45, 2], [27, 4], [69, 4], [23, 2], [4, 1]]) {
      await pg.evaluate((i) => { location.hash = '#/song/' + i; }, id);
      await pg.waitForTimeout(120);
      const boxes = await pg.$$eval('.lyric-chorus', (e) => e.length);
      const leaked = await pg.$$eval('.lyric-block p',
        (ps) => ps.map((x) => x.textContent).filter((t) => /^\[.*\]$/.test(t)));
      ok(`song ${id} renders ${expected} chorus box(es), no bracket text leaks into lyrics`,
        boxes === expected && leaked.length === 0, `got ${boxes} boxes, leaks ${JSON.stringify(leaked)}`);
    }
    /* Song 45 is the one with two named choruses. */
    await pg.evaluate(() => { location.hash = '#/song/45'; });
    await pg.waitForTimeout(150);
    const labels = await pg.$$eval('.chorus-label', (e) => e.map((x) => x.textContent.trim()));
    ok('multi-chorus songs show their real labels', labels.some((l) => /Chorus 1/.test(l)) && labels.some((l) => /Chorus 2/.test(l)),
      JSON.stringify(labels));
    await pg.close();
  }

  /* ── Routing and history ────────────────────────────────── */
  section('Routing and history');
  {
    const pg = await openApp('/index.html#/song/45');
    const title = await pg.$eval('.sinfo h1', (e) => e.textContent);
    ok('deep link opens the song directly', title.includes('Captain Jones'), title);
    await pg.close();
  }
  {
    const pg = await openApp();
    await pg.click('.cmain');
    await pg.waitForTimeout(200);
    const opened = await pg.$eval('#detail-view', (e) => e.classList.contains('vis'));
    await pg.goBack();
    await pg.waitForTimeout(250);
    const returned = await pg.$$eval('.song-card', (c) => c.length) > 0;
    ok('browser back returns to the list instead of leaving the app', opened && returned && pg.url().includes('index.html'));
    await pg.close();
  }
  {
    const pg = await openApp();
    await pg.click('#btn-about');
    await pg.waitForTimeout(400);
    const open = await pg.$eval('#apanel', (e) => e.classList.contains('vis'));
    await pg.goBack();
    await pg.waitForTimeout(350);
    const closed = await pg.$eval('#apanel', (e) => !e.classList.contains('vis'));
    ok('browser back closes an open sheet without navigating away', open && closed);
    await pg.close();
  }

  /* ── Filters and search ─────────────────────────────────── */
  section('Filters and search');
  {
    const pg = await openApp();
    const display = () => pg.$eval('#clear-all-btn', (e) => getComputedStyle(e).display);
    await pg.fill('#search-input', 'the');
    await pg.waitForTimeout(120);
    const withQuery = await display();
    await pg.fill('#search-input', '');
    await pg.$eval('[data-cat="Patriotic Songs"]', (e) => e.click());
    await pg.waitForTimeout(120);
    const withCat = await display();
    ok('"Clear filters" shows for a query alone AND a category alone',
      withQuery !== 'none' && withCat !== 'none', `query=${withQuery} category=${withCat}`);

    await pg.$eval('[data-cat="All"]', (e) => e.click());
    await pg.$eval('#cat-tabs', (e) => { e.scrollLeft = 300; });
    await pg.waitForTimeout(80);
    const before = await pg.$eval('#cat-tabs', (e) => e.scrollLeft);
    await pg.$eval('[data-cat="Movie/TV"]', (e) => e.click());
    await pg.waitForTimeout(120);
    const after = await pg.$eval('#cat-tabs', (e) => e.scrollLeft);
    ok('category strip keeps its scroll position when a pill is tapped', before === after, `${before} -> ${after}`);
    await pg.$eval('[data-cat="All"]', (e) => e.click());

    await pg.fill('#search-input', 'airlock');
    await pg.waitForTimeout(150);
    const lyricHits = await pg.$$eval('.song-card', (e) => e.length);
    const snippets = await pg.$$eval('.csnip', (e) => e.length);
    ok('search covers lyrics and shows a snippet for lyric-only matches', lyricHits > 0 && snippets > 0,
      `${lyricHits} hits, ${snippets} snippets`);

    await pg.fill('#search-input', 'captain');
    await pg.waitForTimeout(150);
    const first = await pg.$eval('.song-card .ct', (e) => e.textContent);
    const marks = await pg.$$eval('.ct mark', (e) => e.length);
    ok('title matches rank first and are highlighted', /captain/i.test(first) && marks > 0, `first="${first}"`);

    await pg.fill('#search-input', 'barretts');
    await pg.waitForTimeout(150);
    ok('search ignores punctuation ("barretts" finds "Barrett\'s")',
      await pg.$$eval('.song-card', (e) => e.length) > 0);
    await pg.close();
  }

  /* ── Accessibility ──────────────────────────────────────── */
  section('Accessibility');
  {
    const pg = await openApp();
    const unnamed = await pg.evaluate(() => [...document.querySelectorAll('button')]
      .filter((b) => !b.getAttribute('aria-label') && !b.textContent.trim()).length);
    ok('every button has an accessible name', unnamed === 0, `${unnamed} unnamed`);

    ok('favourite stars expose aria-pressed',
      (await pg.$eval('.cstar', (e) => e.getAttribute('aria-pressed'))) !== null);

    await pg.evaluate(() => document.querySelector('.cmain').focus());
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(200);
    ok('song rows are keyboard-operable', await pg.$eval('#detail-view', (e) => e.classList.contains('vis')));
    await pg.goBack();
    await pg.waitForTimeout(200);

    await pg.click('#btn-settings');
    await pg.waitForTimeout(400);
    const focusMovedIn = await pg.evaluate(() => document.getElementById('spanel').contains(document.activeElement));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(400);
    const closed = await pg.$eval('#spanel', (e) => !e.classList.contains('vis'));
    const restored = await pg.evaluate(() => document.activeElement.id);
    ok('sheets move focus in, close on Escape, and restore focus',
      focusMovedIn && closed && restored === 'btn-settings', `focusIn=${focusMovedIn} restored=${restored}`);

    await pg.keyboard.press('/');
    await pg.waitForTimeout(120);
    ok('"/" focuses the search box', (await pg.evaluate(() => document.activeElement.id)) === 'search-input');
    await pg.close();
  }

  /* ── Layout ─────────────────────────────────────────────────
     The design targets, asserted rather than eyeballed. */
  section('Layout');
  {
    const pg = await ctx.newPage();
    for (const [label, width, height, budget] of [['iPhone SE', 375, 667, 185], ['iPhone 14', 390, 844, 185]]) {
      await pg.setViewportSize({ width, height });
      await pg.goto(`${BASE}/index.html#/song/62`);
      await pg.waitForTimeout(400);
      const chrome = await pg.evaluate(() => {
        const h = (s) => {
          const el = document.querySelector(s);
          if (!el) return 0;
          const r = el.getBoundingClientRect();
          return r.height > 0 && getComputedStyle(el).display !== 'none' ? Math.round(r.height) : 0;
        };
        return h('.hdr') + h('.portal-bar') + h('.dbar') + h('.sinfo');
      });
      ok(`${label}: chrome above the lyrics is ${chrome}px (budget ${budget}px)`, chrome <= budget);
    }

    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.goto(`${BASE}/index.html#/song/62`);
    await pg.waitForTimeout(400);
    const lineWidth = await pg.evaluate(() => {
      const p = document.querySelector('.lyric-block p');
      return p ? Math.round(p.getBoundingClientRect().width) : 0;
    });
    ok(`desktop lyric measure is ${lineWidth}px (readable range, <= 640px)`, lineWidth > 0 && lineWidth <= 640);

    const noHScroll = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok('no horizontal overflow at 1440px', noHScroll);
    await pg.close();
  }

  /* ── Print ──────────────────────────────────────────────── */
  section('Print');
  {
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/index.html#/song/62`);
    await pg.waitForTimeout(400);
    await pg.emulateMedia({ media: 'print' });
    const printed = await pg.evaluate(() => {
      const lw = document.querySelector('.lw');
      const verses = document.querySelectorAll('.lyric-block, .lyric-chorus').length;
      return { clipped: getComputedStyle(lw).overflowY === 'auto', verses,
               chromeVisible: getComputedStyle(document.querySelector('.hdr')).display !== 'none' };
    });
    ok('print does not clip the lyrics to one screenful', !printed.clipped);
    ok('print hides the app chrome', !printed.chromeVisible);
    ok(`print keeps every block of the song (${printed.verses})`, printed.verses > 5);
    await pg.emulateMedia({ media: 'screen' });
    await pg.close();
  }

  /* ── Offline ────────────────────────────────────────────── */
  section('Offline');
  {
    const warm = await openApp();
    await warm.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
    await warm.waitForTimeout(1500);
    const cached = await warm.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      return (await c.keys()).length;
    });
    ok(`service worker precaches the app shell (${cached} entries)`, cached >= 12);
    await warm.close();

    await ctx.setOffline(true);
    const cold = await ctx.newPage();
    await cold.goto(`${BASE}/index.html#/song/45`);
    await cold.waitForFunction(() => document.querySelector('#detail-view')?.classList.contains('vis'),
      { timeout: 15000 }).catch(() => {});
    const offlineTitle = await cold.$eval('.sinfo h1', (e) => e.textContent).catch(() => '');
    ok('app boots and deep-links with no network at all', offlineTitle.includes('Captain Jones'), offlineTitle);
    ok('choruses still render offline', (await cold.$$eval('.lyric-chorus', (e) => e.length)) === 2);
    ok('the dyslexia font is available offline',
      await cold.evaluate(() => fetch('fonts/opendyslexic-latin-400-normal.woff2').then((r) => r.ok).catch(() => false)));
    await cold.close();
    await ctx.setOffline(false);
  }

  section('Console');
  ok('no page or console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFailures:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

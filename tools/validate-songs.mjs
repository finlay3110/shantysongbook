#!/usr/bin/env node
/* ============================================================
   songs.json VALIDATOR

   songs.json is hand-edited and the app trusts its shape completely,
   so a typo ships straight to everyone. This checks the things that
   have actually gone wrong or would break the app:

     - JSON parses, is a non-empty array
     - required fields present and the right type
     - ids unique
     - categories are known AND have an icon mapped in app.js
     - source_book / source_page agree with each other
     - every song's lyrics parse into blocks with no bracketed label
       leaking into the rendered lyrics (the bug that silently removed
       chorus highlighting from five songs)

   Run:  node tools/validate-songs.mjs
   Exits non-zero on errors; warnings alone do not fail the build.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = (await import('node:module')).createRequire(import.meta.url);
const { parseLyrics } = require(join(ROOT, 'lyrics.js'));

const VALID_CATEGORIES = [
  'Patriotic Songs', 'Bar/Drinking Songs', 'Crew Ballads', 'Accompanied Songs',
  'Songs About Us', 'Fragments and Works in Progress', 'Traditional Songs',
  'Movie/TV', 'Improvised Songs', 'Folk & Other'
];

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ── Load ─────────────────────────────────────────────────── */
let songs;
try {
  songs = JSON.parse(readFileSync(join(ROOT, 'songs.json'), 'utf8'));
} catch (e) {
  console.error(`songs.json is not valid JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(songs) || songs.length === 0) {
  console.error('songs.json must be a non-empty array.');
  process.exit(1);
}

/* ── Categories must have an icon in app.js ───────────────── */
const appSrc = readFileSync(join(ROOT, 'app.js'), 'utf8');
const iconMapBlock = appSrc.slice(
  appSrc.indexOf('var CAT_ICON_NAMES'),
  appSrc.indexOf('function catIconName')
);
const mappedCategories = [...iconMapBlock.matchAll(/'([^']+)'\s*:\s*'[^']+'/g)].map((m) => m[1]);

/* ── Per-song checks ──────────────────────────────────────── */
const seenIds = new Map();
const seenTitles = new Map();

for (const [i, s] of songs.entries()) {
  const at = `song #${i} (${JSON.stringify(s?.title ?? '<no title>')})`;

  if (typeof s !== 'object' || s === null) { err(`${at}: not an object`); continue; }

  if (!Number.isInteger(s.id)) err(`${at}: "id" must be an integer`);
  else if (seenIds.has(s.id)) err(`${at}: duplicate id ${s.id}, already used by "${seenIds.get(s.id)}"`);
  else seenIds.set(s.id, s.title);

  for (const field of ['title', 'category', 'words', 'tune', 'lyrics']) {
    if (typeof s[field] !== 'string' || !s[field].trim()) {
      err(`${at}: "${field}" must be a non-empty string`);
    }
  }

  if (typeof s.title === 'string') {
    const key = s.title.trim().toLowerCase();
    if (seenTitles.has(key)) warn(`${at}: duplicate title, also song id ${seenTitles.get(key)}`);
    else seenTitles.set(key, s.id);
  }

  if (typeof s.category === 'string') {
    if (!VALID_CATEGORIES.includes(s.category)) {
      err(`${at}: unknown category ${JSON.stringify(s.category)}. Valid: ${VALID_CATEGORIES.join(', ')}`);
    } else if (!mappedCategories.includes(s.category)) {
      err(`${at}: category ${JSON.stringify(s.category)} has no icon in CAT_ICON_NAMES (app.js) — it would fall back to a generic note`);
    }
  }

  const hasBook = s.source_book != null && s.source_book !== '';
  const hasPage = s.source_page != null && s.source_page !== '';
  if (hasBook && !hasPage) warn(`${at}: has source_book but no source_page`);
  if (hasPage && !hasBook) err(`${at}: has source_page but no source_book — the page number will not be shown`);
  if (hasPage && !Number.isInteger(s.source_page)) err(`${at}: "source_page" must be an integer or null`);

  for (const key of Object.keys(s)) {
    if (!['id', 'title', 'category', 'words', 'tune', 'lyrics', 'source_book', 'source_page'].includes(key)) {
      warn(`${at}: unexpected field ${JSON.stringify(key)} — the app ignores it`);
    }
  }

  /* ── Lyric structure ───────────────────────────────────────
     A heading only takes effect on the FIRST line of a block (blocks are
     separated by a blank line). A structural heading found anywhere else
     means a blank line is missing above it, and the reader will see
     "[Chorus 1:]" printed as though it were a lyric.

     Bracketed lines that are not structural — "[Improvise 2 lines about
     the [ITEM]]" — are deliberate stage directions and are left alone. */
  const STRUCTURAL_HEADING = /^\[?\s*(pre-?chorus|chorus|refrain|verse|bridge|intro|outro|coda|spoken)\b/i;

  if (typeof s.lyrics === 'string' && s.lyrics.trim()) {
    const blocks = parseLyrics(s.lyrics);
    if (!blocks.length) err(`${at}: lyrics parsed into no blocks`);

    for (const b of blocks) {
      if (b.type !== 'verse') continue;
      for (const [li, line] of b.lines.entries()) {
        const t = String(line).trim();
        const looksLikeHeading = /^\[.+\]$/.test(t) || /^[^:]{1,40}:$/.test(t);
        if (li > 0 && looksLikeHeading && STRUCTURAL_HEADING.test(t)) {
          err(`${at}: ${JSON.stringify(t)} renders as a lyric line, not a heading — it needs a blank line above it`);
        }
      }
    }

    /* A "repeat chorus" marker with no chorus anywhere in the song has
       nothing to point at. */
    const hasChorus = blocks.some((b) => b.type === 'chorus');
    const repeatsChorus = blocks.some((b) => b.type === 'repeat' && /chorus|refrain/i.test(b.text));
    if (repeatsChorus && !hasChorus) {
      warn(`${at}: has a "repeat chorus" marker but no chorus block`);
    }
  }
}

/* ── Report ───────────────────────────────────────────────── */
for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error:   ${e}`);

const counts = `${songs.length} songs, ${new Set(songs.map((s) => s.category)).size} categories`;
if (errors.length) {
  console.error(`\nsongs.json FAILED validation — ${errors.length} error(s), ${warnings.length} warning(s). (${counts})`);
  process.exit(1);
}
console.log(`songs.json OK — ${counts}, ${warnings.length} warning(s).`);

/* ============================================================
   SHARED LYRIC PARSER
   Turns the raw `lyrics` string from songs.json into a flat list of
   typed blocks. Both renderers consume this and nothing else:

     app.js        — draws them as HTML in the app
     pdf-export.js — draws them into the exported PDF

   Both files used to carry their own copy of this logic, which drifted
   and meant a parsing bug had to be found and fixed twice. Keep the
   parsing here; keep the drawing in the renderers.

   Block types returned:
     {type:'verse',  lines:[...]}                  — ordinary verse lines
     {type:'chorus', label:'Chorus 1', lines:[..]} — highlighted chorus box
     {type:'label',  text:'Verse 2'}               — small section heading
     {type:'repeat', text:'Repeat chorus',
                     ref:'2'|null}                 — italic repeat marker

   HEADER RECOGNITION
   A block's first line is treated as a header if it is either
     - fully bracketed:            [Chorus 1:]   [Verse 2]   [Refrain]
     - a structural word + colon:  Chorus:   Verse 2:   Spoken:
     - a bare chorus word:         Chorus    Refrain 2
   The colon form deliberately requires a structural keyword, so an
   ordinary lyric line that happens to end in a colon ("and this is what
   he said:") stays a lyric line.

   The previous implementation only accepted `Chorus:` / `[Chorus]` with
   nothing between the bracket and the digits, and only honoured a
   header at all when its block was <= 2 lines. That silently dropped
   chorus styling from five songs — [Chorus 1:], [Chorus singers:],
   [Second Chorus], [Final Chorus] and [Alternative blame chorus:] all
   rendered as plain verses with the brackets showing. tools/validate-songs.mjs
   now guards against that regressing.
   ============================================================ */
(function (root) {
  'use strict';

  var BRACKETED = /^\[(.+)\]$/;
  var COLON_HEADER = /^([^:]{1,40}):[ \t]*(.*)$/;
  /* Words that mark structure rather than lyrics. Kept deliberately
     narrow — every addition risks swallowing a real lyric line that
     happens to end in a colon. */
  var STRUCTURAL = /\b(chorus|refrain|verse|bridge|intro|outro|coda|spoken|coro|middle\s*8)\b/i;
  var BARE_CHORUS = /^(chorus|refrain)\s*\d*$/i;
  var CHORUSY = /\b(chorus|refrain|coro)\b/i;
  var REPEAT = /^repeat\b/i;

  function tidyLabel(s) {
    return String(s).trim().replace(/[:\s]+$/, '').trim();
  }

  /* Does this line introduce a block, and if so under what label?
     Returns {label, rest} where `rest` is any content that followed a
     colon on the same line ("Chorus: away boys away"), or null. */
  function readHeader(line) {
    var m = line.match(BRACKETED);
    if (m) return { label: tidyLabel(m[1]), rest: '' };

    m = line.match(COLON_HEADER);
    if (m && STRUCTURAL.test(m[1])) {
      return { label: tidyLabel(m[1]), rest: m[2].trim() };
    }

    if (BARE_CHORUS.test(line.trim())) return { label: tidyLabel(line), rest: '' };
    return null;
  }

  /* "Repeat Chorus 2" -> "2"; "Repeat chorus" -> null. Lets a repeat
     marker point at a specific chorus in songs that have several. */
  function chorusRef(label) {
    var m = String(label).match(/(?:chorus|refrain)\s*(\d+)/i);
    return m ? m[1] : null;
  }

  function trimBlankEdges(lines) {
    var a = 0, b = lines.length;
    while (a < b && !String(lines[a]).trim()) a++;
    while (b > a && !String(lines[b - 1]).trim()) b--;
    return lines.slice(a, b);
  }

  function parseLyrics(lyrics) {
    var out = [];
    if (!lyrics) return out;

    var blocks = String(lyrics).replace(/\r\n?/g, '\n').split('\n\n');

    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n');
      var first = (lines[0] || '').trim();
      if (!first) continue;

      var hdr = readHeader(first);
      var body = hdr
        ? trimBlankEdges((hdr.rest ? [hdr.rest] : []).concat(lines.slice(1)))
        : null;

      /* Repeat marker — a header (or bare line) that starts with "repeat"
         and carries no lyrics of its own. */
      var repeatLabel = hdr ? hdr.label : first;
      if (REPEAT.test(repeatLabel) && (!body || !body.length)) {
        out.push({
          type: 'repeat',
          text: hdr ? hdr.label : first.replace(/\s+$/, ''),
          ref: chorusRef(repeatLabel)
        });
        continue;
      }

      if (hdr) {
        if (CHORUSY.test(hdr.label) && body.length) {
          out.push({ type: 'chorus', label: hdr.label, lines: body });
          continue;
        }
        /* A header with lyrics under it becomes a heading plus a verse;
           a header on its own is just a heading. */
        out.push({ type: 'label', text: hdr.label });
        if (body.length) out.push({ type: 'verse', lines: body });
        continue;
      }

      out.push({ type: 'verse', lines: lines });
    }

    return out;
  }

  /* Which chorus should a "Repeat chorus" marker expand to when the
     reader has asked to see choruses written out every time?
     An explicit reference wins ("Repeat Chorus 2"); otherwise the first
     chorus, which is what an unqualified "repeat chorus" means in every
     song in the book. */
  function resolveRepeat(blocks, index) {
    var marker = blocks[index];
    if (!marker || marker.type !== 'repeat') return null;
    /* "Repeat indefinitely" / "Repeat with a new [ITEM] each round" are
       instructions about the song, not a cue to reprint the chorus. */
    if (!CHORUSY.test(marker.text)) return null;

    var choruses = [], i;
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'chorus') choruses.push(blocks[i]);
    }
    if (!choruses.length) return null;

    if (marker.ref) {
      for (i = 0; i < choruses.length; i++) {
        if (chorusRef(choruses[i].label) === marker.ref) return choruses[i];
      }
    }
    return choruses[0];
  }

  root.UCN_parseLyrics = parseLyrics;
  root.UCN_resolveRepeat = resolveRepeat;

  /* Also reachable from node (tools/validate-songs.mjs) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseLyrics: parseLyrics, resolveRepeat: resolveRepeat };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

# UCN Songbook

A fan-made digital songbook for the **United Confederation Navy (UCN)** community — a Bridge Command LARP group. Browse, search, and export the full songbook as a print-ready PDF, right from your phone or desktop.

🔗 **Live app:** [shantysongbook.netlify.app](https://shantysongbook.netlify.app)

> **Disclaimer:** This is a fan-made project and is not approved by or affiliated with Bridge Command / The London Space Elevator Limited. The UCN logo is the property of Bridge Command / The London Space Elevator Limited. Song lyrics are the property of their respective copyright holders; UCN-themed songs are reproduced here as original fan parodies.

---

## Features

- 🔍 **Search** by title, tune, author **or lyrics** — punctuation- and accent-insensitive, with matches highlighted and a snippet shown for lyric matches
- 🗂️ **Category filters** (Patriotic, Bar/Drinking, Traditional, Improvised, and more)
- ⭐ **Favourites** with a dedicated filter tab
- 🎨 **Chorus highlighting**, adjustable text size, light/dark/auto themes, and a dyslexia-friendly font option
- 🔗 **Shareable links** — every song has its own URL (`#/song/45`), and the back button works the way you expect
- 📖 **Source book & page references** for songs from the physical booklets
- 🎵 **Auto-scroll** and **keep-screen-awake** for singing hands-free
- 📄 **PDF export** — the whole songbook, the current filter, or just your favourites, with cover page, table of contents, per-section divider pages and a corner-frame design on every page
- 📱 **Installable and fully offline** — add it to your home screen and it works with no signal at all

---

## File structure

```
├── index.html                 # Markup, the SVG icon sprite, and PWA wiring
├── styles.css                 # All styling, including the light/dark themes
├── app.js                     # App logic — search, filtering, routing, settings
├── lyrics.js                  # Shared lyric parser (used by the app AND the PDF)
├── songs.json                 # All song data — edit this file to add/update songs
├── pdf-export.js              # PDF export engine (jsPDF + fonts + logo/QR assets)
│                              # Lazily loaded only when someone exports,
│                              # so normal browsing never downloads it
├── sw.js                      # Service worker — precaches the app for offline use
├── manifest.webmanifest       # Makes the app installable to a home screen
├── fonts/                     # Self-hosted Exo 2 + OpenDyslexic (OFL, see LICENSE.md)
├── icons/                     # App icons for install / home screen / favicon
└── tools/
    ├── gen-187ab8a3.html       # Song entry generator (see "Maintainer tools")
    └── validate-songs.mjs      # Checks songs.json before it ships (see below)
```

Everything except `tools/` must be deployed together in the same folder — the app fetches `songs.json` at runtime and loads `pdf-export.js` on demand. The `tools/` folder is for maintainers only and has no effect on the live app.

There is **no build step**. Plain HTML, CSS and JavaScript, edited and deployed as-is.

---

## Adding a new song

Songs live in `songs.json` as a plain JSON array. To add one:

1. Open `songs.json`
2. Paste a new entry before the closing `]`, separated from the previous entry by a comma
3. **Run `node tools/validate-songs.mjs`** — catches the mistakes that silently break rendering
4. Commit and push — Netlify redeploys automatically

Step 3 also runs automatically on every push via GitHub Actions (`.github/workflows/validate.yml`).

### Song entry format

```json
{
  "id": 75,
  "title": "Song Title",
  "category": "Bar/Drinking Songs",
  "words": "Author Name",
  "tune": "Original Tune; Composer",
  "lyrics": "Verse one line one\nVerse one line two\n\nChorus:\nChorus line one\nChorus line two\n\nRepeat chorus",
  "source_book": "UCN Songbook",
  "source_page": 12
}
```

**Field reference:**

| Field | Description |
|---|---|
| `id` | Unique number — always increment from the last song in the file |
| `title` | Song title as shown in the app |
| `category` | Must exactly match one of the categories listed below |
| `words` | Lyric author / credit |
| `tune` | Original tune the song is sung to |
| `lyrics` | Full lyrics as a single string (see formatting rules below) |
| `source_book` | Name of the physical booklet, or `null` if none |
| `source_page` | Page number in that booklet (integer), or `null` |

**Valid categories:**
`Patriotic Songs` · `Bar/Drinking Songs` · `Crew Ballads` · `Accompanied Songs` · `Songs About Us` · `Fragments and Works in Progress` · `Traditional Songs` · `Movie/TV` · `Improvised Songs` · `Folk & Other`

Adding a brand-new category also needs an icon adding to `CAT_ICON_NAMES` in `app.js` — the validator will tell you if you forget.

### Lyrics formatting

Blocks are separated by a **blank line** (`\n\n`). The first line of a block can be a heading:

| Syntax | Result |
|---|---|
| `\n` | New line |
| `\n\n` | Blank line / new block |
| `Chorus:` | Highlighted chorus box |
| `[Chorus]`, `[Chorus 1:]`, `[Second Chorus]`, `[Refrain]` | Also a chorus box, labelled with whatever you wrote |
| `Repeat chorus` alone on a line | Italic repeat marker |
| `[Repeat Chorus 2]` | Repeat marker pointing at a specific chorus |
| `[Verse 2]`, `[Bridge]`, `[Outro]` | Small labelled section heading — the lines under it stay ordinary lyrics |

A heading only works as the **first line of a block**, so always leave a blank line above it. The validator catches it when you forget.

A companion song-entry generator is included — see **Maintainer tools** below. Fill in the
fields, and copy the formatted output straight into `songs.json`.

---

## Offline & installing

The app registers a service worker (`sw.js`) that precaches the shell — HTML, CSS, JS, fonts, icons and `songs.json` — so it opens with no connection at all. On a phone, use "Add to Home Screen" and it behaves like an app.

- `songs.json` is fetched network-first, so song edits appear as soon as there is a connection, falling back to the cached copy.
- `pdf-export.js` (~900KB) is deliberately **not** precached. It is cached the first time someone exports, and works offline after that.

> **When you change `index.html`, `app.js`, `lyrics.js` or `styles.css`, bump `VERSION` at the top of `sw.js`.** Otherwise returning visitors keep the old cached copy.

---

## PDF Export

The export button offers three scopes — the whole songbook, the current filter, or just your favourites — and generates:

- Cover page with logo and a QR code linking back to the live app
- Table of contents with clickable links and real page numbers
- A dedicated divider page per category, each with its own mini table of contents
- Every song on its own page, with automatic page-break handling for long songs
- Custom embedded fonts (Exo 2 + Orbitron), with automatic fallback to a standard font if embedding fails
- Built entirely with [jsPDF](https://github.com/parallax/jsPDF) (MIT licensed, embedded directly — no external CDN calls)

---

## Notes for maintainers

**Lyric parsing lives in one place.** `lyrics.js` turns a song's `lyrics` string into typed blocks (`verse`, `chorus`, `label`, `repeat`), and both the app and the PDF exporter render from that. The two used to carry separate copies of this logic, which drifted — a chorus-detection bug had to be found and fixed in both, and it wasn't. If you change how lyrics are interpreted, change it in `lyrics.js` only.

**Keyboard shortcuts:** `/` focuses search, `r` opens a random song, `Space` toggles auto-scroll in a song, `Esc` backs out.

---

## Maintainer tools

The song entry generator is reachable from the app by a hidden gesture:

**Tap the UCN logo in the header ten times.** Taps have to be quick — leave more than 1.5
seconds between two of them and the count starts over. The generator opens in a new tab.

Nothing appears until the tenth tap, so nobody discovers it by fumbling.

### What this is not

It is a doorway nobody trips over by accident, **not security**. The songbook is plain
files that every visitor downloads, so anyone who opens the browser's developer tools can
read the address and go straight there. The only thing genuinely keeping people out is that
the generator has an unguessable filename (`tools/gen-187ab8a3.html`).

If that address ever gets out, rename the file and update `TOOL_URL` in `app.js` to match.

**Never put anything behind this that would matter if it leaked.**

---

## Credits

- **Made by:** Sub Lt Tetra — Discord: `finlay3110`
- **Original Songbook:** Compiled by Lt. Cmdr. Jim — Ship's Councillor
- **Traditional Songs booklet:** Lt. Dorward
- **Fonts:** Exo 2 and OpenDyslexic, both SIL Open Font License 1.1 — see [`fonts/LICENSE.md`](fonts/LICENSE.md)

## Requesting updates or reporting an issue

Post in the `#songbook` channel on the BC Discord server, or DM Tetra directly.

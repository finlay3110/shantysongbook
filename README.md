# UCN Songbook

A fan-made digital songbook for the **United Confederation Navy (UCN)** community — a Bridge Command LARP group. Browse, search, and export the full songbook as a print-ready PDF, right from your phone or desktop.

🔗 **Live app:** [shantysongbook.netlify.app](https://shantysongbook.netlify.app)

> **Disclaimer:** This is a fan-made project and is not approved by or affiliated with Bridge Command / The London Space Elevator Limited. The UCN logo is the property of Bridge Command / The London Space Elevator Limited. Song lyrics are the property of their respective copyright holders; UCN-themed songs are reproduced here as original fan parodies.

---

## Features

- 🔍 **Search** by title, tune, or author
- 🗂️ **Category filters** (Patriotic, Bar/Drinking, Traditional, Improvised, and more)
- ⭐ **Favourites** with a dedicated filter tab
- 🎨 **Chorus highlighting**, adjustable text size, and a dyslexia-friendly font option
- 📖 **Source book & page references** for songs from the physical booklets
- 📄 **Full PDF export** — generates a complete print-ready songbook with a cover page, table of contents, per-section divider pages (each with its own mini table of contents), and a corner-frame design on every page
- 📱 Built mobile-first for use during events, with an offline cache fallback if the connection drops

---

## File structure

```
├── index.html        # The app itself — search, browse, settings, About panel
├── songs.json         # All song data — edit this file to add/update songs
├── pdf-export.js       # PDF export engine (jsPDF + fonts + logo/QR assets)
│                        # Lazily loaded only when someone clicks "Export PDF",
│                        # so normal browsing never downloads it
└── tools/
    └── ucn_song_generator.html   # Standalone helper for formatting new song
                                    # entries. NOT linked from the app — open
                                    # it directly in a browser when adding songs.
```

All three root-level files must be deployed together in the same folder — the app fetches `songs.json` at runtime, and dynamically loads `pdf-export.js` on demand. The `tools/` folder is for maintainers only; it isn't referenced anywhere in `index.html` and has no effect on the live app if deployed alongside it.

---

## Adding a new song

Songs live in `songs.json` as a plain JSON array. To add one:

1. Open `songs.json`
2. Paste a new entry before the closing `]`, separated from the previous entry by a comma
3. Commit and push — Netlify redeploys automatically

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

**Lyrics formatting:**

| Syntax | Result |
|---|---|
| `\n` | New line |
| `\n\n` | Blank line / verse break |
| `Chorus:` at the start of a block | Renders as a highlighted chorus box |
| `Repeat chorus` alone on a line | Renders as an italic repeat marker |
| `[Label]` alone on a line | Renders as a small labelled section (e.g. `[Verse 1]`, `[Bridge]`) |

A companion song-entry generator tool is included in [`tools/ucn_song_generator.html`](tools/ucn_song_generator.html) — open it directly in a browser (it's not linked from the live app), fill in the fields, and copy the formatted output straight into `songs.json`.

---

## PDF Export

Clicking the export button in the app generates a complete PDF songbook:

- Cover page with logo and a QR code linking back to the live app
- Table of contents with clickable links and real page numbers
- A dedicated divider page per category, each with its own mini table of contents
- Every song on its own page, with automatic page-break handling for long songs
- Custom embedded fonts (Exo 2 + Orbitron), with automatic fallback to a standard font if embedding fails for any reason
- Built entirely with [jsPDF](https://github.com/parallax/jsPDF) (MIT licensed, embedded directly — no external CDN calls)

---

## Credits

- **Made by:** Sub Lt Tetra — Discord: `finlay3110`
- **Original Songbook:** Compiled by Lt. Cmdr. Jim — Ship's Councillor
- **Traditional Songs booklet:** Lt. Dorward

## Requesting updates or reporting an issue

Post in the `#songbook` channel on the BC Discord server, or DM Tetra directly.

# Ulysses

A full-featured writing app inspired by [Ulysses](https://ulysses.app), built with vanilla JavaScript and deployed on Cloudflare. Your data lives in the cloud (Cloudflare D1) — log in from any browser, any device, and pick up where you left off.

## Deployment (Cloudflare)

### Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- A Cloudflare account

### Setup

1. **Create the D1 database:**
   ```bash
   wrangler d1 create ulysses-db
   ```
   Copy the `database_id` from the output and paste it into `wrangler.toml`.

2. **Create the tables:**
   ```bash
   wrangler d1 execute ulysses-db --file=schema.sql --remote
   ```

3. **Set your access token** (this is your login password):
   ```bash
   npx wrangler pages secret put AUTH_TOKEN
   ```
   Enter any password you want. You'll use this to sign in.

4. **Deploy:**
   ```bash
   wrangler pages deploy . --project-name=ulysses-app
   ```

5. **Open your app** at `https://ulysses-app.pages.dev` and sign in with your token.

### Local Development

For local testing with the D1 database:

```bash
wrangler pages dev .
```

This starts a local server with D1 bindings. Set `AUTH_TOKEN` in a `.dev.vars` file:

```
AUTH_TOKEN=your-local-password
```

## Features

### Cloud Storage

- All data stored in Cloudflare D1 (SQLite at the edge)
- Token-based authentication — only you can access your data
- Log in from any browser on any device
- Full data backup/restore via JSON export

### Three-Panel Layout

- **Library** (left) — Groups/folders for organizing your writing, plus smart filters
- **Sheet List** (center) — All sheets in the selected group, with previews
- **Editor** (right) — Distraction-free Markdown editor powered by CodeMirror 6

Each panel can be toggled independently with keyboard shortcuts or trackpad swipe gestures.

### Markdown Editor

- Full Markdown syntax highlighting (headings, bold, italic, links, code, lists)
- Auto-save every 500ms to D1 — your work is never lost
- Line wrapping with a comfortable 720px max-width
- Typewriter mode — keeps the active line vertically centered
- Split view — side-by-side editor + live Markdown preview
- Find & Replace (Cmd+F) with regex support, case sensitivity, and replace all

### Library & Organization

- Create nested groups (folders and sub-folders)
- Drag and drop to reorder sheets and move them between groups
- Rename and delete groups via right-click context menu
- Smart filters: **All**, **Last 7 Days**, **Favorites**, **Trash**
- Sheet sorting: manual, by date modified, or by title

### Sheet Management

- Multi-select with Cmd+Click (toggle) and Shift+Click (range)
- Merge multiple sheets into one (with undo)
- Duplicate sheets
- Move sheets between groups
- Favorite sheets (gold star, accessible via Favorites filter)
- Soft delete to Trash with undo toast — restore anytime
- Permanent delete and empty trash from the Trash filter

### Tags

- Create colored tags from a 12-color palette
- Click a tag to toggle it on the current sheet
- Right-click a tag to rename or delete it
- Tags display as pills in the status bar

### Writing Goals

- Set goals per sheet: target a number of words, characters, sentences, paragraphs, or pages
- Three modes: **About** (within 10% tolerance), **At Least** (minimum), **At Most** (maximum)
- Optional deadline with daily target calculation
- Progress ring in the status bar: blue (in progress), green (complete), red (exceeded)
- Live preview in the goal setup modal

### Attachments

- Per-sheet notes field for annotations and metadata
- Image attachments stored as base64 in D1
- Add images via file picker or paste from clipboard
- Slide-in panel from the right side of the editor

### Search

- **Cmd+F** — Find & Replace within the current sheet (CodeMirror built-in)
- **Cmd+Shift+F** — Global search across all sheets with keyboard navigation

### Export

- Export the current sheet as Markdown, HTML, PDF, or DOCX
- Full data backup: export all groups, sheets, tags, and goals as JSON
- Import backup to restore everything

### Themes

- Light and dark mode with a single toggle
- All colors defined as CSS custom properties for easy customization

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Cmd+N | New sheet |
| Cmd+F | Find & Replace |
| Cmd+Shift+F | Global search |
| Cmd+1 | Toggle library panel |
| Cmd+2 | Toggle sheets panel |
| Cmd+3 | Focus mode (hide both panels) |
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+K | Insert link |
| Cmd+Shift+K | Inline code |
| Cmd+E | Export |
| Escape | Close any overlay/modal |

### Trackpad Gestures

Two-finger horizontal swipe anywhere on screen:
- Swipe left — collapse panels (sheets first, then library)
- Swipe right — expand panels (library first, then sheets)

### Undo Toasts

Destructive actions (trash, merge, tag delete) show a brief notification at the bottom of the screen with an **Undo** button. Click it within 5 seconds to reverse the action.

## Tech Stack

- **Vanilla JS** with ES Modules — no framework, no build step
- **Cloudflare Pages** — static file hosting
- **Cloudflare D1** — SQLite database at the edge (replaces IndexedDB)
- **Cloudflare Pages Functions** — serverless API for CRUD operations
- **CodeMirror 6** — Markdown editor (from esm.sh CDN)
- **marked.js** — Markdown to HTML rendering (from CDN)
- **html2pdf.js** — PDF export (from CDN)
- **docx** — DOCX export (from CDN)
- **Plain CSS** with custom properties for theming

## File Structure

```
ulysses_app/
├── index.html              # App shell
├── wrangler.toml           # Cloudflare Pages config + D1 binding
├── schema.sql              # D1 database schema
├── css/
│   └── styles.css          # All styles + theme variables
├── js/
│   ├── app.js              # Init, auth check, event bus wiring
│   ├── auth.js             # Login/logout, token management
│   ├── db.js               # API client (fetch → D1 via Workers)
│   ├── editor.js           # CodeMirror 6 setup, typewriter mode
│   ├── library.js          # Groups sidebar, smart filters
│   ├── sheets.js           # Sheet list, multi-select, context menus
│   ├── tags.js             # Tag management
│   ├── goals.js            # Writing goals with progress ring
│   ├── search.js           # Global full-text search
│   ├── export.js           # PDF, DOCX, HTML, MD export + backup
│   ├── theme.js            # Dark/light toggle
│   ├── split-view.js       # Side-by-side editor + preview
│   ├── attachments.js      # Notes + image attachments panel
│   ├── keyboard.js         # Keyboard shortcuts + swipe gestures
│   └── utils.js            # Event bus, helpers, modals, undo toast
└── functions/
    └── api/
        └── [[path]].js     # Catch-all API handler (D1 CRUD)
```

## Architecture

```
Browser (any device)
  ↓ HTTPS
Cloudflare Pages (static files)
  ↓ /api/* routes
Pages Functions (Workers)
  ↓ SQL queries
Cloudflare D1 (SQLite)
```

All API calls include a Bearer token for authentication. The token is set as a Cloudflare Pages secret and validated on every request.

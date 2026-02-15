# Ulysses

A full-featured writing app inspired by [Ulysses](https://ulysses.app), built with vanilla JavaScript and deployed on Cloudflare. Your notes are stored as portable `.md` files in Cloudflare R2 (source of truth), with D1 as a fast index for queries.

## Architecture

```
Browser (any device)
  ↓ HTTPS
Cloudflare Pages (static files)
  ↓ /api/* routes
Pages Functions (Workers)
  ↓ reads/writes
Cloudflare R2 (markdown files)    ← source of truth
Cloudflare D1 (SQLite index)      ← fast queries
```

Every sheet is a `.md` file with YAML frontmatter:

```markdown
---
id: abc123-def456
tags:
  - philosophy
  - draft
favorite: true
created: 2026-02-15T00:00:00.000Z
modified: 2026-02-15T12:00:00.000Z
---
# My Sheet Title

Content here...
```

Files are organized by user and group:

```
ulysses-sheets/
  <userId>/
    Notes/
      Inbox/
        my-note.md
    Projects/
      My Book/
        chapter-1.md
```

All mutations (create, edit, delete, move, trash, tag, goal) sync to R2 automatically. D1 can be rebuilt from R2 at any time via `pull`.

## Deployment

### Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- A Cloudflare account

### Setup

1. **Create the D1 database:**
   ```bash
   wrangler d1 create ulysses-db
   ```
   Copy the `database_id` into `wrangler.toml`.

2. **Create the R2 bucket:**
   ```bash
   wrangler r2 bucket create ulysses-sheets
   ```

3. **Create the tables:**
   ```bash
   wrangler d1 execute ulysses-db --file=schema.sql --remote
   ```

4. **Set your access token** (login password):
   ```bash
   npx wrangler pages secret put AUTH_TOKEN
   ```

5. **Deploy:**
   ```bash
   wrangler pages deploy . --project-name=ulysses-app
   ```

6. **Open your app** at `https://ulysses-app.pages.dev` and sign in.

### Local Development

```bash
wrangler pages dev .
```

Set `AUTH_TOKEN` in a `.dev.vars` file:

```
AUTH_TOKEN=your-local-password
```

## CLI

A helper script for quick operations from the terminal:

```bash
./ulysses-cli.sh login                          # Authenticate
./ulysses-cli.sh sheet "Inbox" "Title" "Content" # Create a sheet
./ulysses-cli.sh project "Name"                  # Create a project
./ulysses-cli.sh group "Name"                    # Create a group (Notes)
./ulysses-cli.sh tag "Name" "#color"             # Create a tag
./ulysses-cli.sh delete-sheet "Title"             # Delete a sheet
./ulysses-cli.sh delete-group "Name"              # Delete a group
./ulysses-cli.sh edit-sheet "Title" "New content"  # Edit a sheet
./ulysses-cli.sh list-groups                      # List all groups
./ulysses-cli.sh list-sheets "Group"              # List sheets in group
./ulysses-cli.sh sync                             # Bidirectional R2 sync
./ulysses-cli.sh push                             # Push D1 → R2
./ulysses-cli.sh pull                             # Pull R2 → D1
```

All write commands go through the API, so R2 is updated automatically.

## Features

### R2-First Storage

- Every sheet is a portable `.md` file with YAML frontmatter
- R2 (object storage) is the source of truth
- D1 (SQLite) serves as a fast index for search, filters, and counts
- D1 can be fully rebuilt from R2 files via `pull`
- Auto-sync: every create/edit/delete/move/trash/tag/goal writes to R2
- Access your files with any tool: wrangler CLI, rclone, S3-compatible clients
- Per-user path isolation in the R2 bucket

### Instant Loading

- **localStorage cache** — renders instantly from cache (zero API calls)
- **Background refresh** — fresh data loads silently; UI updates only if changed
- **Auto-polling** — detects external changes (CLI, other devices) every 10 seconds
- **Single bootstrap API** — all startup data in one call
- **Module preloading** — CodeMirror preloaded via `<link rel="modulepreload">`

### Three-Panel Layout

- **Library** (left) — Groups organized into Projects and Notes, smart filters, keywords
- **Sheet List** (center) — Sheets with title previews and metadata
- **Editor** (right) — Markdown editor powered by CodeMirror 6

Each panel toggleable with keyboard shortcuts, trackpad swipes, or arrow keys.

### Markdown Editor

- Full Markdown syntax highlighting
- Checkbox/task list support with clickable widgets (`- [ ]` / `- [x]`)
- Auto-save every 500ms
- Typewriter mode, focus mode, split view (editor + live preview)
- Find & Replace with regex support
- Fullscreen mode

### Library & Organization

- Nested groups (folders and sub-folders)
- Two sections: **Projects** and **Notes**
- Drag and drop to reorder and nest groups
- Custom icons with color picker
- Smart filters: All, Last 7 Days, Favorites, Trash (live counts)
- Multiple sort modes: manual, date modified, date created, title

### Sheet Management

- Multi-select with Cmd+Click and Shift+Click
- Merge, duplicate, move, favorite, trash with undo
- Open in new window, deep linking
- Context menus for all operations

### Keywords (Tags)

- Colored keywords from a 12-color palette
- Sidebar keyword list sorted by usage
- Autocomplete assignment with create-on-the-fly
- Filter sheets by keyword (sidebar click or tag filter bar)

### Writing Goals

- Per-sheet goals: words, characters, sentences, paragraphs, or pages
- Three modes: About, At Least, At Most
- Optional deadline with daily target
- Progress ring in status bar (blue/green/red)

### Attachments

- Per-sheet notes field
- Image attachments (file picker or clipboard paste)
- Keywords section
- Slide-in panel from the right

### Statistics

- Live word count badge with progress ring
- Expandable stats: words, characters, sentences, paragraphs, reading time

### Search

- **Cmd+F** — Find & Replace within current sheet
- **Cmd+Shift+F** — Global search across all sheets

### Export

- Export as Markdown, HTML, PDF, or DOCX
- Full data backup/restore via JSON

### Themes

- Light and dark mode
- CSS custom properties for easy customization

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Cmd+N | New sheet |
| Cmd+F | Find & Replace |
| Cmd+Shift+F | Global search |
| Cmd+1 | Toggle library panel |
| Cmd+2 | Toggle sheets panel |
| Cmd+3 | Focus mode |
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+K | Insert link |
| Cmd+Shift+K | Inline code |
| Cmd+E | Export |
| Cmd+Shift+O | Open in new window |
| Escape | Close overlay / exit editor |
| Enter | Re-enter editor |
| Arrow keys | Navigate sheets / toggle panels |

### Mobile Support

- Responsive three-panel navigation
- Markup bar with formatting buttons and stats
- Touch-friendly context menus and modals

## Tech Stack

- **Vanilla JS** with ES Modules — no framework, no build step
- **Cloudflare Pages** — static hosting
- **Cloudflare R2** — object storage for `.md` files (source of truth)
- **Cloudflare D1** — SQLite index for fast queries
- **Cloudflare Pages Functions** — serverless API
- **CodeMirror 6** — Markdown editor (esm.sh CDN)
- **marked.js** — Markdown rendering (CDN)
- **html2pdf.js** — PDF export (CDN)
- **docx** — DOCX export (CDN)

## File Structure

```
ulysses_app/
├── index.html              # App shell
├── wrangler.toml           # Cloudflare config (D1 + R2 bindings)
├── schema.sql              # D1 database schema
├── ulysses-cli.sh          # CLI helper script
├── css/
│   └── styles.css          # Styles + theme variables
├── js/
│   ├── app.js              # Init, bootstrap, event wiring, polling
│   ├── auth.js             # Login/logout, token management
│   ├── db.js               # API client (fetch → Workers)
│   ├── editor.js           # CodeMirror 6, checkboxes, typewriter
│   ├── library.js          # Groups sidebar, sections, filters
│   ├── sheets.js           # Sheet list, multi-select, caching
│   ├── tags.js             # Keywords sidebar + assignment
│   ├── goals.js            # Writing goals
│   ├── search.js           # Global search
│   ├── export.js           # PDF, DOCX, HTML, MD + backup
│   ├── icons.js            # Icon picker
│   ├── theme.js            # Dark/light toggle
│   ├── split-view.js       # Editor + preview
│   ├── attachments.js      # Notes, images, keywords panel
│   ├── outline.js          # Document heading outline
│   ├── markup-bar.js       # Mobile toolbar
│   ├── keyboard.js         # Shortcuts + swipe gestures
│   └── utils.js            # Event bus, helpers, modals
└── functions/
    └── api/
        └── [[path]].js     # API handler (D1 + R2 sync)
```

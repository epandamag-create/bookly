# Karakeep — Local-First Bookmark Manager

A fast, minimal, and reliable desktop bookmark manager built with **Tauri 2.x**. Inspired by [Karakeep](https://github.com/karakeep-app/karakeep), reimagined as a local-first desktop app.

![Dark Mode Only](https://img.shields.io/badge/theme-dark%20mode-0f0f0f)
![Tauri 2.x](https://img.shields.io/badge/tauri-2.x-blue)
![SQLite](https://img.shields.io/badge/storage-SQLite-green)

---

## Features

- **Bookmark Types**: Links, Notes, Images
- **Auto Metadata Extraction**: OG tags, title, description, images (via Rust HTTP)
- **AI Auto-Tagging & Summaries**: Powered by Claude (Anthropic API)
- **Fuzzy Search**: Full-text search via Fuse.js across title, description, tags, URL
- **Tag Filtering**: Filter by bookmark type or by tag
- **Keyboard Shortcuts**: `/` search, `n` new bookmark, `Esc` close
- **Local-First**: All data stored in SQLite, no server required
- **Dark Mode**: Premium dark UI with Syne/Literata/DM Mono fonts

---

## Prerequisites

### 1. Install Rust

```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Windows — download from https://rustup.rs
```

### 2. Install System Dependencies

**macOS:**
```bash
xcode-select --install
```

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget \
  file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Fedora:**
```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget \
  file libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "C Development Tools and Libraries"
```

**Windows:**
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### 3. Install Node.js

Download LTS from [nodejs.org](https://nodejs.org/) (v18+)

---

## Setup & Run

```bash
# Clone or copy the project
cd karakeep-tauri

# Install JavaScript dependencies
npm install

# Run in development mode
npm run dev
```

The first run will compile Rust dependencies (~2-5 minutes). Subsequent runs are fast.

### Build for Production

```bash
npm run build
```

The binary will be in `src-tauri/target/release/`.

---

## Configuration

### AI Integration (Optional)

1. Open the app
2. Click **⚙ Settings** in the sidebar
3. Enter your [Anthropic API key](https://console.anthropic.com/)
4. Click **Test Connection** to verify
5. Save

Once configured, new bookmarks will automatically receive AI-generated tags and summaries.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Window                          │
│  ┌──────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ Sidebar   │  │  Content Grid  │  │ Detail Panel   │  │
│  │           │  │                │  │                │  │
│  │ • Filters │  │  Bookmark      │  │ • Title        │  │
│  │ • Tags    │  │  Cards         │  │ • Summary      │  │
│  │ • Settings│  │                │  │ • Tags         │  │
│  └──────────┘  └────────────────┘  └────────────────┘  │
│                                                          │
│  ┌────────────────── JS Modules ──────────────────────┐  │
│  │  app.js ──→ state.js ←──→ events.js (pub/sub)     │  │
│  │              ↕                                      │  │
│  │  ui.js ←── bookmarks.js ──→ db.js (SQLite)        │  │
│  │              ↕           ↕                          │  │
│  │         crawler.js    ai.js (Claude API)           │  │
│  │              ↕           ↕                          │  │
│  └──────────────┼───────────┼─────────────────────────┘  │
│                  │           │                            │
│  ┌───────────── Tauri IPC ──┼────────────────────────┐  │
│  │    invoke('fetch_url')   invoke('call_anthropic')  │  │
│  └──────────────┼───────────┼─────────────────────────┘  │
│                  │           │                            │
│  ┌───────── Rust Backend ───┼────────────────────────┐  │
│  │  reqwest HTTP client     │  Anthropic API proxy   │  │
│  │  (CORS-free fetching)    │  (key hidden from JS)  │  │
│  └──────────────────────────┼────────────────────────┘  │
│                              │                           │
│  ┌─── tauri-plugin-sql ─────┼────────────────────────┐  │
│  │  SQLite: karakeep.db                               │  │
│  │  Tables: bookmarks, settings                       │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Module Responsibilities

| Module | Role |
|---|---|
| `app.js` | Bootstrap: init DB → load settings → init UI → load bookmarks |
| `events.js` | Pub/sub event bus for decoupled communication |
| `state.js` | Single source of truth; emits events on changes |
| `db.js` | SQLite abstraction; all queries encapsulated here |
| `bookmarks.js` | CRUD + business logic; bridges DB, crawler, AI |
| `crawler.js` | Metadata extraction via Tauri Rust HTTP |
| `ai.js` | Anthropic API; async tagging + summaries |
| `search.js` | Fuse.js fuzzy search with 300ms debounce |
| `ui.js` | All DOM rendering; subscribes to state events |
| `main.rs` | Tauri commands: `fetch_url`, `call_anthropic` |

### Data Flow: Adding a Bookmark

```
User clicks "New" → Modal opens
  → User enters URL + saves
    → bookmarks.js: addBookmark()
      → crawler.js: fetchMetadata(url)
        → Tauri invoke('fetch_url') → Rust reqwest → HTML
        → Parse OG tags → return { title, description, image_url }
      → db.js: createBookmark() → SQLite INSERT
      → state.js: setState({ bookmarks }) → events emit
      → ui.js: renderGrid() (immediate, with metadata)
      → ai.js: processBookmarkWithAI() (async, non-blocking)
        → Tauri invoke('call_anthropic') → Rust reqwest → API
        → Tags + Summary returned
        → db.js: updateBookmark() → SQLite UPDATE
        → state.js: updateBookmarkInState()
        → ui.js: updateCardInPlace() (partial DOM update)
```

### Data Flow: AI Processing

```
AI is ALWAYS async and NEVER blocks the UI:

1. Bookmark saved to DB immediately
2. Card appears in grid right away
3. AI spinner shows on card
4. In background: tags request → summary request
5. On success: card updates with tags + summary
6. On failure: card shows ⚠️ icon, retry available
7. If no API key: AI skipped silently
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `n` | New bookmark |
| `Esc` | Close modal / panel / clear search |

---

## Tech Stack

- **Frontend**: Vanilla HTML + CSS + JS (no framework)
- **Desktop**: Tauri 2.x (Rust)
- **Database**: SQLite via tauri-plugin-sql
- **Search**: Fuse.js
- **AI**: Anthropic Claude (claude-3-5-haiku)
- **HTTP**: reqwest (Rust, CORS-free)
- **Fonts**: Syne, Literata, DM Mono

---

## License

MIT

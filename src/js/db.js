/**
 * db.js — SQLite abstraction layer
 * All database queries are encapsulated here.
 * Uses @tauri-apps/plugin-sql when in Tauri, or falls back to in-memory for dev
 */

let db = null;
let isMemoryMode = false;

// In-memory fallback for browser dev
const memoryStore = {
  bookmarks: [],
  settings: [],
  _nextId: 1,
};

/**
 * Initialize database connection
 */
export async function initDB() {
  try {
    // Check if Tauri SQL plugin is available
    if (window.__TAURI__ && window.__TAURI__.sql) {
      const Database = window.__TAURI__.sql.Database || window.__TAURI__.sql.default;
      if (Database) {
        db = await Database.load('sqlite:karakeep.db');
        await runMigrations();
        console.log('[DB] SQLite connected via Tauri plugin');
        return;
      }
    }
  } catch (err) {
    console.warn('[DB] Tauri SQL not available, trying alternative import:', err.message);
  }

  // Try dynamic import
  try {
    const mod = await import('@tauri-apps/plugin-sql');
    const Database = mod.default || mod.Database;
    db = await Database.load('sqlite:karakeep.db');
    await runMigrations();
    console.log('[DB] SQLite connected via dynamic import');
    return;
  } catch (err) {
    console.warn('[DB] Dynamic import failed:', err.message);
  }

  // Fallback to in-memory mode for browser development
  console.warn('[DB] Using in-memory fallback (no persistence)');
  isMemoryMode = true;
}

/**
 * Run database migrations
 */
async function runMigrations() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'link',
      url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT,
      image_url TEXT,
      tags TEXT DEFAULT '[]',
      summary TEXT,
      ai_processed INTEGER DEFAULT 0,
      ai_failed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Create index for search performance
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_bookmarks_type ON bookmarks(type)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at DESC)
  `);
}

// === BOOKMARK QUERIES ===

/**
 * Get all bookmarks ordered by creation date
 */
export async function getAllBookmarks() {
  if (isMemoryMode) {
    return [...memoryStore.bookmarks].sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
  }
  return await db.select('SELECT * FROM bookmarks ORDER BY created_at DESC');
}

/**
 * Get a single bookmark by ID
 */
export async function getBookmarkById(id) {
  if (isMemoryMode) {
    return memoryStore.bookmarks.find(b => b.id === id) || null;
  }
  const rows = await db.select('SELECT * FROM bookmarks WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Create a new bookmark
 * @returns {object} created bookmark with id
 */
export async function createBookmark({ type, url, title, description, content, image_url, tags }) {
  const tagsJson = JSON.stringify(tags || []);

  if (isMemoryMode) {
    const bookmark = {
      id: memoryStore._nextId++,
      type: type || 'link',
      url: url || null,
      title: title || 'Untitled',
      description: description || null,
      content: content || null,
      image_url: image_url || null,
      tags: tagsJson,
      summary: null,
      ai_processed: 0,
      ai_failed: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryStore.bookmarks.push(bookmark);
    return bookmark;
  }

  const result = await db.execute(
    `INSERT INTO bookmarks (type, url, title, description, content, image_url, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [type || 'link', url || null, title || 'Untitled', description || null, content || null, image_url || null, tagsJson]
  );

  return await getBookmarkById(result.lastInsertId);
}

/**
 * Update a bookmark
 */
export async function updateBookmark(id, fields) {
  if (fields.tags && Array.isArray(fields.tags)) {
    fields.tags = JSON.stringify(fields.tags);
  }

  if (isMemoryMode) {
    const idx = memoryStore.bookmarks.findIndex(b => b.id === id);
    if (idx === -1) return null;
    Object.assign(memoryStore.bookmarks[idx], fields, { updated_at: new Date().toISOString() });
    return { ...memoryStore.bookmarks[idx] };
  }

  const setClauses = [];
  const values = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(fields)) {
    setClauses.push(`${key} = $${paramIdx}`);
    values.push(value);
    paramIdx++;
  }

  setClauses.push(`updated_at = datetime('now')`);
  values.push(id);

  await db.execute(
    `UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    values
  );

  return await getBookmarkById(id);
}

/**
 * Delete a bookmark
 */
export async function deleteBookmark(id) {
  if (isMemoryMode) {
    memoryStore.bookmarks = memoryStore.bookmarks.filter(b => b.id !== id);
    return true;
  }
  await db.execute('DELETE FROM bookmarks WHERE id = $1', [id]);
  return true;
}

// === SETTINGS QUERIES ===

/**
 * Get a setting value by key
 */
export async function getSetting(key) {
  if (isMemoryMode) {
    const entry = memoryStore.settings.find(s => s.key === key);
    return entry ? entry.value : null;
  }
  const rows = await db.select('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

/**
 * Set a setting value
 */
export async function setSetting(key, value) {
  if (isMemoryMode) {
    const idx = memoryStore.settings.findIndex(s => s.key === key);
    if (idx >= 0) {
      memoryStore.settings[idx].value = value;
    } else {
      memoryStore.settings.push({ key, value });
    }
    return;
  }
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

/**
 * Get all settings as an object
 */
export async function getAllSettings() {
  if (isMemoryMode) {
    const obj = {};
    for (const s of memoryStore.settings) {
      obj[s.key] = s.value;
    }
    return obj;
  }
  const rows = await db.select('SELECT key, value FROM settings');
  const obj = {};
  for (const row of rows) {
    obj[row.key] = row.value;
  }
  return obj;
}

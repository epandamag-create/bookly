/**
 * app.js — Application bootstrap
 * Initializes all modules in correct order
 */

import { initDB, getSetting } from './db.js';
import { setState } from './state.js';
import { loadBookmarks } from './bookmarks.js';
import { initUI } from './ui.js';
import events, { Events } from './events.js';

async function bootstrap() {
  console.log('[App] Karakeep starting...');

  try {
    // 1. Initialize database
    await initDB();

    // 2. Load settings
    const apiKey = await getSetting('anthropic_api_key') || '';
    setState({ settings: { anthropic_api_key: apiKey } });

    // 3. Initialize UI (bind events, subscribe to state)
    initUI();

    // 4. Load bookmarks from DB
    await loadBookmarks();

    console.log('[App] Karakeep ready');
  } catch (err) {
    console.error('[App] Bootstrap failed:', err);
    events.emit(Events.TOAST, {
      message: 'Application failed to start. Check console.',
      type: 'error',
    });
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

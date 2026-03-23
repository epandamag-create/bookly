/**
 * state.js — Centralized state management
 * Single source of truth; all changes go through setState
 */

import events, { Events } from './events.js';

const initialState = {
  bookmarks: [],
  filteredBookmarks: [],
  selectedBookmark: null,
  filter: { type: 'all', tag: null },
  searchQuery: '',
  tags: [],
  settings: { anthropic_api_key: '' },
  isLoading: true,
};

let _state = { ...initialState };

/**
 * Get a shallow copy of current state (or a specific key)
 */
export function getState(key) {
  if (key) return _state[key];
  return { ..._state };
}

/**
 * Update state and notify subscribers
 * @param {Partial<typeof initialState>} partial
 */
export function setState(partial) {
  const prev = { ..._state };
  Object.assign(_state, partial);

  // Emit granular events based on what changed
  if (partial.bookmarks !== undefined) {
    events.emit(Events.BOOKMARKS_LOADED, _state.bookmarks);
    recalcFilteredBookmarks();
    recalcTags();
  }

  if (partial.filter !== undefined || partial.searchQuery !== undefined) {
    recalcFilteredBookmarks();
  }

  if (partial.selectedBookmark !== undefined) {
    if (_state.selectedBookmark) {
      events.emit(Events.BOOKMARK_SELECTED, _state.selectedBookmark);
    } else {
      events.emit(Events.BOOKMARK_DESELECTED);
    }
  }

  if (partial.settings !== undefined) {
    events.emit(Events.SETTINGS_UPDATED, _state.settings);
  }
}

/**
 * Update a single bookmark in state (after AI update, edit, etc.)
 */
export function updateBookmarkInState(bookmark) {
  const idx = _state.bookmarks.findIndex(b => b.id === bookmark.id);
  if (idx === -1) return;

  _state.bookmarks[idx] = { ..._state.bookmarks[idx], ...bookmark };

  // If this is the selected bookmark, update that too
  if (_state.selectedBookmark && _state.selectedBookmark.id === bookmark.id) {
    _state.selectedBookmark = { ..._state.selectedBookmark, ...bookmark };
    events.emit(Events.BOOKMARK_SELECTED, _state.selectedBookmark);
  }

  recalcFilteredBookmarks();
  recalcTags();
  events.emit(Events.BOOKMARK_UPDATED, _state.bookmarks[idx]);
}

/**
 * Remove a bookmark from state
 */
export function removeBookmarkFromState(id) {
  _state.bookmarks = _state.bookmarks.filter(b => b.id !== id);

  if (_state.selectedBookmark && _state.selectedBookmark.id === id) {
    _state.selectedBookmark = null;
    events.emit(Events.BOOKMARK_DESELECTED);
  }

  recalcFilteredBookmarks();
  recalcTags();
  events.emit(Events.BOOKMARK_DELETED, id);
}

/**
 * Recalculate filtered bookmarks based on current filter + search
 */
function recalcFilteredBookmarks() {
  let result = [..._state.bookmarks];

  // Apply type filter
  if (_state.filter.type !== 'all') {
    result = result.filter(b => b.type === _state.filter.type);
  }

  // Apply tag filter
  if (_state.filter.tag) {
    result = result.filter(b => {
      const tags = parseTags(b.tags);
      return tags.includes(_state.filter.tag);
    });
  }

  // Search is handled by search.js which sets filteredBookmarks directly
  // But if there's no search query, we use the filtered result
  if (!_state.searchQuery) {
    _state.filteredBookmarks = result;
    events.emit(Events.FILTER_CHANGED, _state.filteredBookmarks);
  }
}

/**
 * Recalculate all unique tags
 */
function recalcTags() {
  const tagSet = new Set();
  for (const b of _state.bookmarks) {
    const tags = parseTags(b.tags);
    tags.forEach(t => tagSet.add(t));
  }
  _state.tags = [...tagSet].sort();
  events.emit(Events.TAGS_UPDATED, _state.tags);
}

/**
 * Parse tags from JSON string or array
 */
function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export { parseTags };

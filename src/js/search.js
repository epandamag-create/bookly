/**
 * search.js — Fuzzy search via Fuse.js
 * Debounced full-text search across title, description, tags
 */

import { getState, setState, parseTags } from './state.js';
import events, { Events } from './events.js';

let fuseInstance = null;
let debounceTimer = null;

const DEBOUNCE_MS = 300;

const FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 0.4 },
    { name: 'description', weight: 0.25 },
    { name: '_tagsFlat', weight: 0.25 },
    { name: 'url', weight: 0.1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

/**
 * Initialize or rebuild the Fuse index
 */
export function buildSearchIndex(bookmarks) {
  // Prepare data: flatten tags for searchability
  const prepared = bookmarks.map(b => ({
    ...b,
    _tagsFlat: parseTags(b.tags).join(' '),
  }));

  fuseInstance = new Fuse(prepared, FUSE_OPTIONS);
}

/**
 * Perform search with debounce
 * @param {string} query
 */
export function search(query) {
  clearTimeout(debounceTimer);

  const trimmed = query.trim();
  setState({ searchQuery: trimmed });

  if (!trimmed) {
    // Empty query — show all filtered bookmarks
    const { filter, bookmarks } = getState();
    let result = [...bookmarks];

    if (filter.type !== 'all') {
      result = result.filter(b => b.type === filter.type);
    }
    if (filter.tag) {
      result = result.filter(b => parseTags(b.tags).includes(filter.tag));
    }

    setState({ filteredBookmarks: result });
    events.emit(Events.SEARCH_CHANGED, result);
    return;
  }

  debounceTimer = setTimeout(() => {
    if (!fuseInstance) return;

    const results = fuseInstance.search(trimmed);
    let filtered = results.map(r => r.item);

    // Apply current filters on top of search results
    const { filter } = getState();
    if (filter.type !== 'all') {
      filtered = filtered.filter(b => b.type === filter.type);
    }
    if (filter.tag) {
      filtered = filtered.filter(b => parseTags(b.tags).includes(filter.tag));
    }

    setState({ filteredBookmarks: filtered });
    events.emit(Events.SEARCH_CHANGED, filtered);
  }, DEBOUNCE_MS);
}

/**
 * Clear search
 */
export function clearSearch() {
  clearTimeout(debounceTimer);
  search('');
}

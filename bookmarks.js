/**
 * bookmarks.js — Bookmark CRUD and business logic
 * Bridges DB, crawler, AI, and state
 */

import * as db from './db.js';
import { fetchMetadata, isValidUrl } from './crawler.js';
import { processBookmarkWithAI } from './ai.js';
import { getState, setState, updateBookmarkInState, removeBookmarkFromState } from './state.js';
import { buildSearchIndex } from './search.js';
import events, { Events } from './events.js';

/**
 * Load all bookmarks from DB and update state
 */
export async function loadBookmarks() {
  try {
    const bookmarks = await db.getAllBookmarks();
    setState({ bookmarks, isLoading: false });
    buildSearchIndex(bookmarks);
  } catch (err) {
    console.error('[Bookmarks] Failed to load:', err);
    setState({ bookmarks: [], isLoading: false });
    events.emit(Events.TOAST, { message: 'Failed to load bookmarks', type: 'error' });
  }
}

/**
 * Add a new bookmark
 * 1. If link — fetch metadata
 * 2. Save to DB immediately
 * 3. Fire AI processing async (don't wait)
 */
export async function addBookmark({ type, url, title, description, content, tags }) {
  let image_url = null;

  // For links, try to fetch metadata if title is empty
  if (type === 'link' && url && isValidUrl(url)) {
    if (!title) {
      events.emit(Events.TOAST, { message: 'Fetching metadata...', type: 'info' });
      const meta = await fetchMetadata(url);
      title = title || meta.title;
      description = description || meta.description;
      image_url = meta.image_url;
    }
  }

  // For image type, use content as image_url
  if (type === 'image' && content && isValidUrl(content)) {
    image_url = content;
  }

  // Parse comma-separated tags
  const tagArray = parseTags(tags);

  try {
    const bookmark = await db.createBookmark({
      type,
      url: url || null,
      title: title || 'Untitled',
      description: description || null,
      content: content || null,
      image_url,
      tags: tagArray,
    });

    // Update state immediately
    const bookmarks = [bookmark, ...getState('bookmarks')];
    setState({ bookmarks });
    buildSearchIndex(bookmarks);

    events.emit(Events.BOOKMARK_CREATED, bookmark);
    events.emit(Events.TOAST, { message: 'Bookmark saved', type: 'success' });

    // Fire AI processing asynchronously
    triggerAI(bookmark);

    return bookmark;
  } catch (err) {
    console.error('[Bookmarks] Failed to create:', err);
    events.emit(Events.TOAST, { message: 'Failed to save bookmark', type: 'error' });
    return null;
  }
}

/**
 * Edit an existing bookmark
 */
export async function editBookmark(id, fields) {
  if (fields.tags && typeof fields.tags === 'string') {
    fields.tags = parseTags(fields.tags);
  }

  try {
    const updated = await db.updateBookmark(id, fields);
    if (updated) {
      updateBookmarkInState(updated);
      buildSearchIndex(getState('bookmarks'));
      events.emit(Events.TOAST, { message: 'Bookmark updated', type: 'success' });
    }
    return updated;
  } catch (err) {
    console.error('[Bookmarks] Failed to update:', err);
    events.emit(Events.TOAST, { message: 'Failed to update bookmark', type: 'error' });
    return null;
  }
}

/**
 * Delete a bookmark
 */
export async function deleteBookmarkById(id) {
  try {
    await db.deleteBookmark(id);
    removeBookmarkFromState(id);
    buildSearchIndex(getState('bookmarks'));
    events.emit(Events.TOAST, { message: 'Bookmark deleted', type: 'success' });
    return true;
  } catch (err) {
    console.error('[Bookmarks] Failed to delete:', err);
    events.emit(Events.TOAST, { message: 'Failed to delete bookmark', type: 'error' });
    return false;
  }
}

/**
 * Trigger AI processing for a bookmark (async, non-blocking)
 */
function triggerAI(bookmark) {
  processBookmarkWithAI(bookmark, async (updates) => {
    try {
      // Merge AI tags with existing tags
      if (updates.tags && updates.tags.length > 0) {
        const existing = JSON.parse(bookmark.tags || '[]');
        const merged = [...new Set([...existing, ...updates.tags])];
        updates.tags = merged;
      }

      const updated = await db.updateBookmark(bookmark.id, updates);
      if (updated) {
        updateBookmarkInState(updated);
        buildSearchIndex(getState('bookmarks'));
      }
    } catch (err) {
      console.error('[Bookmarks] Failed to apply AI updates:', err);
    }
  });
}

/**
 * Retry AI for a bookmark that failed
 */
export async function retryAI(bookmarkId) {
  const bookmark = await db.getBookmarkById(bookmarkId);
  if (!bookmark) return;

  await db.updateBookmark(bookmarkId, { ai_failed: 0, ai_processed: 0 });
  updateBookmarkInState({ ...bookmark, ai_failed: 0, ai_processed: 0 });

  triggerAI(bookmark);
  events.emit(Events.TOAST, { message: 'Retrying AI processing...', type: 'info' });
}

/**
 * Parse tags input (comma-separated string or array)
 */
function parseTags(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return input
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
}

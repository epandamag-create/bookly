/**
 * events.js — Simple pub/sub event bus
 * Provides decoupled communication between modules
 */

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   */
  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event with data
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[EventBus] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  /**
   * Subscribe once — auto-unsubscribe after first call
   */
  once(event, callback) {
    const unsub = this.on(event, (data) => {
      unsub();
      callback(data);
    });
    return unsub;
  }
}

// Singleton event bus
const events = new EventBus();

// Event name constants
export const Events = {
  BOOKMARKS_LOADED: 'bookmarks:loaded',
  BOOKMARK_CREATED: 'bookmark:created',
  BOOKMARK_UPDATED: 'bookmark:updated',
  BOOKMARK_DELETED: 'bookmark:deleted',
  BOOKMARK_SELECTED: 'bookmark:selected',
  BOOKMARK_DESELECTED: 'bookmark:deselected',
  FILTER_CHANGED: 'filter:changed',
  SEARCH_CHANGED: 'search:changed',
  TAGS_UPDATED: 'tags:updated',
  SETTINGS_UPDATED: 'settings:updated',
  AI_PROCESSING: 'ai:processing',
  AI_COMPLETE: 'ai:complete',
  AI_FAILED: 'ai:failed',
  TOAST: 'toast:show',
};

export default events;

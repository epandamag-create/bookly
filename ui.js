/**
 * ui.js — Rendering layer
 * All DOM manipulation lives here.
 * Subscribes to state/events and updates the view.
 */

import events, { Events } from './events.js';
import { getState, setState, parseTags } from './state.js';
import { addBookmark, editBookmark, deleteBookmarkById, retryAI } from './bookmarks.js';
import { search, clearSearch } from './search.js';
import { testConnection } from './ai.js';
import * as db from './db.js';

// DOM cache
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let editingBookmarkId = null;

/**
 * Initialize UI: bind events, subscribe to state
 */
export function initUI() {
  bindNavigationEvents();
  bindSearchEvents();
  bindModalEvents();
  bindSettingsEvents();
  bindDetailPanelEvents();
  bindKeyboardShortcuts();
  subscribeToStateEvents();
}

// === EVENT SUBSCRIPTIONS ===

function subscribeToStateEvents() {
  events.on(Events.BOOKMARKS_LOADED, () => renderGrid());
  events.on(Events.FILTER_CHANGED, () => renderGrid());
  events.on(Events.SEARCH_CHANGED, () => renderGrid());
  events.on(Events.BOOKMARK_UPDATED, (bm) => updateCardInPlace(bm));
  events.on(Events.BOOKMARK_SELECTED, (bm) => renderDetailPanel(bm));
  events.on(Events.BOOKMARK_DESELECTED, () => hideDetailPanel());
  events.on(Events.TAGS_UPDATED, (tags) => renderTagList(tags));
  events.on(Events.TOAST, ({ message, type }) => showToast(message, type));

  events.on(Events.AI_PROCESSING, (id) => {
    const card = $(`[data-id="${id}"]`);
    if (card) {
      const typeEl = card.querySelector('.card-type');
      if (typeEl && !typeEl.querySelector('.spinner')) {
        const spinner = document.createElement('span');
        spinner.className = 'card-loading';
        spinner.innerHTML = '<span class="spinner"></span> AI';
        typeEl.appendChild(spinner);
      }
    }
  });

  events.on(Events.AI_COMPLETE, ({ id }) => {
    const card = $(`[data-id="${id}"]`);
    if (card) {
      const loading = card.querySelector('.card-loading');
      if (loading) loading.remove();
    }
  });
}

// === NAVIGATION ===

function bindNavigationEvents() {
  $$('.nav-item[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-item[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filterType = btn.dataset.filter;
      setState({ filter: { ...getState('filter'), type: filterType } });
    });
  });
}

// === SEARCH ===

function bindSearchEvents() {
  const input = $('#search-input');
  input.addEventListener('input', (e) => {
    search(e.target.value);
  });
}

// === KEYBOARD SHORTCUTS ===

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    if (e.key === '/' && !isInput) {
      e.preventDefault();
      $('#search-input').focus();
    }

    if (e.key === 'n' && !isInput) {
      e.preventDefault();
      openAddModal();
    }

    if (e.key === 'Escape') {
      if (!$('#modal-overlay').classList.contains('hidden')) {
        closeModal();
      } else if (!$('#settings-overlay').classList.contains('hidden')) {
        closeSettings();
      } else if (getState('selectedBookmark')) {
        setState({ selectedBookmark: null });
      } else if (isInput) {
        e.target.blur();
        clearSearch();
        $('#search-input').value = '';
      }
    }
  });
}

// === GRID RENDERING ===

function renderGrid() {
  const grid = $('#bookmarks-grid');
  const emptyState = $('#empty-state');
  const noResults = $('#no-results');
  const bookmarks = getState('filteredBookmarks');
  const allBookmarks = getState('bookmarks');

  // Update counts
  updateCounts();

  if (allBookmarks.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    noResults.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  if (bookmarks.length === 0) {
    grid.innerHTML = '';
    noResults.classList.remove('hidden');
    return;
  }

  noResults.classList.add('hidden');

  // Render cards
  const fragment = document.createDocumentFragment();
  for (const bm of bookmarks) {
    fragment.appendChild(createCard(bm));
  }

  grid.innerHTML = '';
  grid.appendChild(fragment);
}

function createCard(bm) {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.dataset.id = bm.id;

  const selected = getState('selectedBookmark');
  if (selected && selected.id === bm.id) {
    card.classList.add('selected');
  }

  const tags = parseTags(bm.tags);
  const tagsHtml = tags.slice(0, 3).map(t =>
    `<span class="card-tag">${escapeHtml(t)}</span>`
  ).join('');

  const aiWarn = bm.ai_failed ? '<span class="card-ai-warn" title="AI processing failed">⚠️</span>' : '';

  const imageHtml = bm.image_url
    ? `<img class="card-image" src="${escapeHtml(bm.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : (bm.type === 'link'
      ? `<div class="card-image-placeholder">🔗</div>`
      : bm.type === 'note'
        ? `<div class="card-image-placeholder">📝</div>`
        : `<div class="card-image-placeholder">🖼</div>`);

  const dateStr = formatDate(bm.created_at);

  card.innerHTML = `
    ${imageHtml}
    <div class="card-body">
      <div class="card-type">${escapeHtml(bm.type)} ${aiWarn}</div>
      <div class="card-title">${escapeHtml(bm.title)}</div>
      ${bm.description ? `<div class="card-description">${escapeHtml(bm.description)}</div>` : ''}
      ${bm.url ? `<div class="card-url">${escapeHtml(bm.url)}</div>` : ''}
      <div class="card-tags">${tagsHtml}</div>
      <div class="card-date">${dateStr}</div>
    </div>
  `;

  card.addEventListener('click', () => {
    $$('.bookmark-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    setState({ selectedBookmark: bm });
  });

  return card;
}

/**
 * Update a single card in place instead of full re-render
 */
function updateCardInPlace(bm) {
  const existing = $(`[data-id="${bm.id}"]`);
  if (!existing) return;

  const newCard = createCard(bm);
  existing.replaceWith(newCard);
}

function updateCounts() {
  const bookmarks = getState('bookmarks');
  $('#count-all').textContent = bookmarks.length;
  $('#count-link').textContent = bookmarks.filter(b => b.type === 'link').length;
  $('#count-note').textContent = bookmarks.filter(b => b.type === 'note').length;
  $('#count-image').textContent = bookmarks.filter(b => b.type === 'image').length;
}

// === TAG LIST ===

function renderTagList(tags) {
  const container = $('#tag-list');
  const currentFilter = getState('filter');

  container.innerHTML = tags.map(tag => {
    const isActive = currentFilter.tag === tag;
    return `<button class="tag-chip ${isActive ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  }).join('');

  container.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tagValue = chip.dataset.tag;
      const current = getState('filter');

      if (current.tag === tagValue) {
        // Deselect
        setState({ filter: { ...current, tag: null } });
        chip.classList.remove('active');
      } else {
        container.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        setState({ filter: { ...current, tag: tagValue } });
      }
    });
  });
}

// === DETAIL PANEL ===

function renderDetailPanel(bm) {
  const app = $('#app');
  const panel = $('#detail-panel');

  app.classList.add('detail-open');
  panel.classList.remove('hidden');

  // Image
  const imageContainer = $('#detail-image');
  if (bm.image_url) {
    imageContainer.classList.remove('hidden');
    $('#detail-img').src = bm.image_url;
    $('#detail-img').onerror = () => imageContainer.classList.add('hidden');
  } else {
    imageContainer.classList.add('hidden');
  }

  // Title & URL
  $('#detail-title').textContent = bm.title || 'Untitled';
  $('#detail-url').textContent = bm.url || '';

  // Summary
  const summaryEl = $('#detail-summary');
  if (bm.summary) {
    summaryEl.classList.remove('hidden');
    $('#detail-summary-text').textContent = bm.summary;
  } else {
    summaryEl.classList.add('hidden');
  }

  // Meta
  $('#detail-type').textContent = bm.type;
  $('#detail-date').textContent = formatDate(bm.created_at);

  // AI status
  const aiStatusEl = $('#detail-ai-status');
  if (bm.ai_failed) {
    aiStatusEl.innerHTML = '⚠️ Failed <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:6px" id="btn-retry-ai">Retry</button>';
    const retryBtn = $('#btn-retry-ai');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => retryAI(bm.id));
    }
  } else if (bm.ai_processed) {
    aiStatusEl.textContent = '✅ Processed';
  } else {
    aiStatusEl.innerHTML = '<span class="card-loading"><span class="spinner"></span> Processing</span>';
  }

  // Tags
  const tags = parseTags(bm.tags);
  $('#detail-tags').innerHTML = tags.map(t =>
    `<span class="card-tag">${escapeHtml(t)}</span>`
  ).join('');

  // Content (for notes)
  const contentEl = $('#detail-content');
  if (bm.content) {
    contentEl.classList.remove('hidden');
    $('#detail-content-text').textContent = bm.content;
  } else {
    contentEl.classList.add('hidden');
  }

  // Open URL button
  const openBtn = $('#btn-open-url');
  if (bm.url) {
    openBtn.href = bm.url;
    openBtn.classList.remove('hidden');
  } else {
    openBtn.classList.add('hidden');
  }
}

function hideDetailPanel() {
  $('#app').classList.remove('detail-open');
  $('#detail-panel').classList.add('hidden');
  $$('.bookmark-card').forEach(c => c.classList.remove('selected'));
}

function bindDetailPanelEvents() {
  $('#btn-close-detail').addEventListener('click', () => {
    setState({ selectedBookmark: null });
  });

  $('#btn-edit-bookmark').addEventListener('click', () => {
    const bm = getState('selectedBookmark');
    if (bm) openEditModal(bm);
  });

  $('#btn-delete-bookmark').addEventListener('click', async () => {
    const bm = getState('selectedBookmark');
    if (!bm) return;
    if (confirm('Delete this bookmark?')) {
      await deleteBookmarkById(bm.id);
    }
  });
}

// === MODALS ===

function bindModalEvents() {
  $('#btn-add-bookmark').addEventListener('click', () => openAddModal());
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel-modal').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Type selector
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateFormForType(btn.dataset.type);
    });
  });

  // Save button
  $('#btn-save-bookmark').addEventListener('click', handleSaveBookmark);
}

function openAddModal() {
  editingBookmarkId = null;
  $('#modal-title').textContent = 'Add Bookmark';
  resetForm();
  updateFormForType('link');
  $('#modal-overlay').classList.remove('hidden');
  setTimeout(() => $('#input-url').focus(), 50);
}

function openEditModal(bm) {
  editingBookmarkId = bm.id;
  $('#modal-title').textContent = 'Edit Bookmark';

  // Set type
  $$('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === bm.type);
  });
  updateFormForType(bm.type);

  // Fill fields
  $('#input-url').value = bm.url || '';
  $('#input-title').value = bm.title || '';
  $('#input-description').value = bm.description || '';
  $('#input-content').value = bm.content || '';
  $('#input-tags').value = parseTags(bm.tags).join(', ');

  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() {
  $('#modal-overlay').classList.add('hidden');
  editingBookmarkId = null;
  resetForm();
}

function resetForm() {
  $('#input-url').value = '';
  $('#input-title').value = '';
  $('#input-description').value = '';
  $('#input-content').value = '';
  $('#input-tags').value = '';
  $('#url-hint').textContent = '';
}

function updateFormForType(type) {
  const fgUrl = $('#fg-url');
  const fgContent = $('#fg-content');
  const fgDescription = $('#fg-description');

  fgUrl.classList.toggle('hidden', type === 'note');
  fgContent.classList.toggle('hidden', type === 'link');
  fgDescription.classList.remove('hidden');

  if (type === 'image') {
    $('label[for="input-content"]').textContent = 'Image URL';
    $('#input-content').placeholder = 'https://example.com/image.png';
  } else if (type === 'note') {
    $('label[for="input-content"]').textContent = 'Content';
    $('#input-content').placeholder = 'Write your note...';
  }
}

async function handleSaveBookmark() {
  const activeType = $('.type-btn.active')?.dataset.type || 'link';
  const url = $('#input-url').value.trim();
  const title = $('#input-title').value.trim();
  const description = $('#input-description').value.trim();
  const content = $('#input-content').value.trim();
  const tags = $('#input-tags').value.trim();

  // Validation
  if (activeType === 'link' && !url) {
    $('#url-hint').textContent = 'URL is required for links';
    $('#url-hint').style.color = 'var(--danger)';
    return;
  }

  if (!title && activeType === 'note') {
    $('#url-hint').textContent = 'Title is required';
    return;
  }

  if (editingBookmarkId) {
    await editBookmark(editingBookmarkId, {
      type: activeType,
      url: url || null,
      title: title || 'Untitled',
      description: description || null,
      content: content || null,
      tags,
    });
  } else {
    await addBookmark({
      type: activeType,
      url,
      title,
      description,
      content,
      tags,
    });
  }

  closeModal();
}

// === SETTINGS ===

function bindSettingsEvents() {
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#btn-cancel-settings').addEventListener('click', closeSettings);
  $('#settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-test-api').addEventListener('click', testApiConnection);
}

async function openSettings() {
  const apiKey = await db.getSetting('anthropic_api_key') || '';
  $('#input-api-key').value = apiKey;
  $('#api-test-result').textContent = '';
  $('#settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  $('#settings-overlay').classList.add('hidden');
}

async function saveSettings() {
  const apiKey = $('#input-api-key').value.trim();
  await db.setSetting('anthropic_api_key', apiKey);
  setState({ settings: { anthropic_api_key: apiKey } });
  events.emit(Events.TOAST, { message: 'Settings saved', type: 'success' });
  closeSettings();
}

async function testApiConnection() {
  const apiKey = $('#input-api-key').value.trim();
  if (!apiKey) {
    $('#api-test-result').textContent = '❌ Enter API key first';
    $('#api-test-result').style.color = 'var(--danger)';
    return;
  }

  $('#api-test-result').textContent = 'Testing...';
  $('#api-test-result').style.color = 'var(--text-muted)';
  $('#btn-test-api').disabled = true;

  const success = await testConnection(apiKey);

  if (success) {
    $('#api-test-result').textContent = '✅ Connected';
    $('#api-test-result').style.color = 'var(--success)';
  } else {
    $('#api-test-result').textContent = '❌ Failed';
    $('#api-test-result').style.color = 'var(--danger)';
  }

  $('#btn-test-api').disabled = false;
}

// === TOAST ===

function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// === UTILS ===

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return dateStr;
  }
}

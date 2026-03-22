/**
 * ai.js — Anthropic Claude API integration
 * Async auto-tagging and summary generation
 * Never blocks UI; fires after bookmark is saved
 */

import { getState } from './state.js';
import events, { Events } from './events.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-5-haiku-latest';
const MAX_RETRIES = 2;

/**
 * Process a bookmark with AI (tags + summary)
 * Completely async — does not block
 * @param {object} bookmark
 * @param {Function} onUpdate — called with { tags?, summary? } when results arrive
 */
export async function processBookmarkWithAI(bookmark, onUpdate) {
  const apiKey = getState('settings')?.anthropic_api_key;

  if (!apiKey) {
    console.log('[AI] No API key configured, skipping');
    return;
  }

  events.emit(Events.AI_PROCESSING, bookmark.id);

  const context = buildContext(bookmark);

  try {
    // Generate tags
    const tags = await generateTags(apiKey, context);

    // Generate summary
    const summary = await generateSummary(apiKey, context);

    onUpdate({
      tags: tags,
      summary: summary,
      ai_processed: 1,
      ai_failed: 0,
    });

    events.emit(Events.AI_COMPLETE, { id: bookmark.id, tags, summary });
  } catch (err) {
    console.error('[AI] Processing failed:', err.message);
    onUpdate({
      ai_processed: 1,
      ai_failed: 1,
    });
    events.emit(Events.AI_FAILED, { id: bookmark.id, error: err.message });
  }
}

/**
 * Build context string from bookmark data
 */
function buildContext(bookmark) {
  const parts = [];
  if (bookmark.title) parts.push(`Title: ${bookmark.title}`);
  if (bookmark.url) parts.push(`URL: ${bookmark.url}`);
  if (bookmark.description) parts.push(`Description: ${bookmark.description}`);
  if (bookmark.content) parts.push(`Content: ${bookmark.content.slice(0, 2000)}`);
  return parts.join('\n');
}

/**
 * Generate tags using Claude
 * @returns {string[]} array of tags
 */
async function generateTags(apiKey, context) {
  const prompt = `Analyze the following bookmark and return ONLY a JSON array of 2-5 relevant tags. Tags should be lowercase, single words or short phrases. Return STRICT JSON array only, no explanation.

Example output: ["javascript","web-dev","tutorial"]

Bookmark:
${context}`;

  const response = await callClaude(apiKey, prompt);
  return parseTagsResponse(response);
}

/**
 * Generate summary using Claude
 * @returns {string} 2-3 sentence summary
 */
async function generateSummary(apiKey, context) {
  const prompt = `Summarize the following bookmark in 2-3 concise, factual sentences. Focus on what it is and why it's useful.

Bookmark:
${context}`;

  return await callClaude(apiKey, prompt);
}

/**
 * Call Claude API with retry logic
 */
async function callClaude(apiKey, prompt, retries = 0) {
  try {
    // Use Tauri invoke if available for secure API calls
    let response;

    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        const result = await window.__TAURI__.core.invoke('call_anthropic', {
          apiKey,
          prompt,
          model: MODEL,
        });
        return result;
      } catch {
        // Fall back to direct fetch
      }
    }

    // Direct fetch (works in dev and when Tauri command not available)
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
  } catch (err) {
    if (retries < MAX_RETRIES) {
      const delay = Math.pow(2, retries) * 500;
      await new Promise(r => setTimeout(r, delay));
      return callClaude(apiKey, prompt, retries + 1);
    }
    throw err;
  }
}

/**
 * Parse tags from AI response
 */
function parseTagsResponse(response) {
  try {
    // Try to extract JSON array from response
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(t => typeof t === 'string')
          .map(t => t.toLowerCase().trim())
          .filter(t => t.length > 0 && t.length < 50)
          .slice(0, 5);
      }
    }
  } catch {
    console.warn('[AI] Failed to parse tags response');
  }
  return [];
}

/**
 * Test the API connection
 * @param {string} apiKey
 * @returns {boolean}
 */
export async function testConnection(apiKey) {
  try {
    const result = await callClaude(apiKey, 'Reply with exactly: OK');
    return result.toLowerCase().includes('ok');
  } catch (err) {
    console.error('[AI] Connection test failed:', err.message);
    return false;
  }
}

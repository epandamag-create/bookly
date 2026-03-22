/**
 * crawler.js — Metadata extraction via Tauri Rust HTTP fetch
 * Falls back gracefully on failure
 */

const TIMEOUT_MS = 5000;

/**
 * Fetch and parse metadata from a URL
 * Uses Tauri invoke('fetch_url') for CORS-free fetching
 * @param {string} url
 * @returns {object} { title, description, image_url }
 */
export async function fetchMetadata(url) {
  const fallback = {
    title: extractTitleFromUrl(url),
    description: '',
    image_url: null,
  };

  if (!url || !isValidUrl(url)) {
    return fallback;
  }

  try {
    let html = null;

    // Try Tauri invoke first (Rust-side fetch, no CORS)
    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        html = await window.__TAURI__.core.invoke('fetch_url', { url });
      } catch (err) {
        console.warn('[Crawler] Tauri fetch failed:', err.message || err);
      }
    }

    // Fallback to browser fetch (may fail due to CORS)
    if (!html) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'Accept': 'text/html' },
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          html = await response.text();
        }
      } catch {
        // CORS or network error — expected in browser
      }
    }

    if (!html) return fallback;

    return parseMetadata(html, url);
  } catch (err) {
    console.warn('[Crawler] Metadata extraction failed:', err.message);
    return fallback;
  }
}

/**
 * Parse HTML string and extract Open Graph / meta tags
 */
function parseMetadata(html, url) {
  const result = {
    title: '',
    description: '',
    image_url: null,
  };

  // Extract OG tags using regex (no DOM parsing needed)
  result.title = extractMeta(html, 'og:title')
    || extractMeta(html, 'twitter:title')
    || extractTagContent(html, 'title')
    || extractTitleFromUrl(url);

  result.description = extractMeta(html, 'og:description')
    || extractMeta(html, 'twitter:description')
    || extractMeta(html, 'description')
    || '';

  const ogImage = extractMeta(html, 'og:image')
    || extractMeta(html, 'twitter:image');

  if (ogImage) {
    result.image_url = resolveUrl(ogImage, url);
  }

  // Clean up
  result.title = decodeEntities(result.title).trim().slice(0, 500);
  result.description = decodeEntities(result.description).trim().slice(0, 1000);

  return result;
}

/**
 * Extract content from a meta tag by property or name
 */
function extractMeta(html, name) {
  // Try property attribute first
  const propRegex = new RegExp(
    `<meta[^>]*property=["']${escapeRegex(name)}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  let match = html.match(propRegex);
  if (match) return match[1];

  // Try content before property
  const propRegex2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${escapeRegex(name)}["']`,
    'i'
  );
  match = html.match(propRegex2);
  if (match) return match[1];

  // Try name attribute
  const nameRegex = new RegExp(
    `<meta[^>]*name=["']${escapeRegex(name)}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  match = html.match(nameRegex);
  if (match) return match[1];

  // Try content before name
  const nameRegex2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${escapeRegex(name)}["']`,
    'i'
  );
  match = html.match(nameRegex2);
  if (match) return match[1];

  return null;
}

/**
 * Extract content of a specific HTML tag
 */
function extractTagContent(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, 'i');
  const match = html.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract a readable title from URL
 */
function extractTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Resolve relative URLs
 */
function resolveUrl(relativeUrl, baseUrl) {
  if (!relativeUrl) return null;
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Validate URL format
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Decode HTML entities
 */
function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { isValidUrl };

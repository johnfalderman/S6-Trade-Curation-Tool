import { getStore } from '@netlify/blobs';
import fs from 'fs';
import path from 'path';

const BLOB_STORE = 'catalog';

// Module-level cache: persists across calls within a warm function instance
let _catalogCache = null;

/**
 * Get the full tagged catalog.
 * Checks for a local static file first (fastest), then falls back to
 * Netlify Blobs, then to catalog.json, then to sample-catalog.json.
 */
export async function getTaggedCatalog() {
      if (_catalogCache) {
              return _catalogCache;
      }

  // 1. Try local static file (pre-downloaded from Blobs via scripts/download-catalog.js)
  try {
          const taggedPath = path.join(process.cwd(), 'data', 'catalog-tagged.json');
          if (fs.existsSync(taggedPath)) {
                    const data = fs.readFileSync(taggedPath, 'utf-8');
                    const records = JSON.parse(data);
                    if (Array.isArray(records) && records.length > 0) {
                                _catalogCache = records;
                                return _catalogCache;
                    }
          }
  } catch (e) {
          // fall through to Blobs
  }

  // 2. Fall back to Netlify Blobs
  try {
          const store = getStore(BLOB_STORE);
          const raw = await store.get('records', { type: 'text' }).catch(() => null);
          if (raw) {
                    const records = JSON.parse(raw);
                    if (Array.isArray(records) && records.length > 0) {
                                _catalogCache = records;
                                return _catalogCache;
                    }
          }
  } catch (e) {
          // fall through to file-based catalog
  }

  // 3. Fall back to local file catalog
  try {
          const catalogPath = path.join(process.cwd(), 'data', 'catalog.json');
          if (fs.existsSync(catalogPath)) {
                    const data = fs.readFileSync(catalogPath, 'utf-8');
                    _catalogCache = JSON.parse(data);
                    return _catalogCache;
          }
  } catch (e) {
          // fall through to sample
  }

  // 4. Final fallback: sample catalog
  const samplePath = path.join(process.cwd(), 'data', 'sample-catalog.json');
      const data = fs.readFileSync(samplePath, 'utf-8');
      _catalogCache = JSON.parse(data);
      return _catalogCache;
}

/**
 * Get catalog metadata (source, count).
 * Tries Netlify Blobs first, then falls back to file-based.
 */
export async function getCatalogMeta() {
      // Try Netlify Blobs first
  try {
          const store = getStore(BLOB_STORE);
          const meta = await store.get('meta', { type: 'json' }).catch(() => null);
          if (meta) return meta;
  } catch (e) {
          // fall through
  }

  // Fall back to local file
  try {
          const catalogPath = path.join(process.cwd(), 'data', 'catalog.json');
          if (fs.existsSync(catalogPath)) {
                    const data = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
                    return { source: 'real', count: data.length };
          }
  } catch (e) {
          // fall through
  }

  // Sample fallback
  try {
          const samplePath = path.join(process.cwd(), 'data', 'sample-catalog.json');
          const data = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
          return { source: 'sample', count: data.length };
  } catch (e) {
          return { source: 'none', count: 0 };
  }
}

/**
 * Save catalog to disk (legacy, used for local dev only).
 * In production on Netlify, saving happens via Netlify Blobs in the API route.
 */
export async function saveCatalog(records) {
      const catalogPath = path.join(process.cwd(), 'data', 'catalog.json');
      fs.writeFileSync(catalogPath, JSON.stringify(records, null, 2));
}

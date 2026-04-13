import { getStore } from '@netlify/blobs';
import fs from 'fs';
import path from 'path';

const BLOB_STORE = 'catalog';

// Module-level cache: persists across calls within a warm function instance
let _catalogCache = null;

/**
 * Get the full tagged catalog.
 * Tries Netlify Blobs first (real uploaded catalog), then falls back to local file.
 */
export async function getTaggedCatalog() {
  if (_catalogCache) {
    return _catalogCache;
  }

  // Try Netlify Blobs first
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

  // Fall back to local file catalog
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

  // Final fallback: sample catalog
  const samplePath = path.join(process.cwd(), 'data', 'sample-catalog.json');
  const data = fs.readFileSync(samplePath, 'utf-8');
  _catalogCache = JSON.parse(data);
  return _catalogCache;
}

/**
 * Get catalog metadata (source, count).
 * Tries Netlify Blobs first, then falls back to file-based.
 */
export

import { getStore } from '@netlify/blobs';
import fs from 'fs';
import path from 'path';

const BLOB_STORE = 'catalog';

/**
 * Get the full tagged catalog.
 * Tries Netlify Blobs first (real uploaded catalog), then falls back to local file.
 */
export async function getTaggedCatalog() {
  // Try Netlify Blobs first
  try {
    const store = getStore(BLOB_STORE);
    const raw = await store.get('records', { type: 'text' }).catch(() => null);
    if (raw) {
      const records = JSON.parse(raw);
      if (Array.isArray(records) && records.length > 0) {
        return records;
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
      return JSON.parse(data);
    }
  } catch (e) {
    // fall through to sample
  }

  // Final fallback: sample catalog
  const samplePath = path.join(process.cwd(), 'data', 'sample-catalog.json');
  const data = fs.readFileSync(samplePath, 'utf-8');
  return JSON.parse(data);
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

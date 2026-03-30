/**
 * catalog.js
 * Loads and caches the tagged catalog from data/catalog.json.
 * Falls back to data/sample-catalog.json if the real catalog isn't loaded yet.
 */

const path = require('path');
const fs = require('fs');
const { tagCatalog } = require('./tagger');

let _cachedCatalog = null;
let _catalogSource = null;

function getCatalogPath(filename) {
  return path.join(process.cwd(), 'data', filename);
}

/**
 * Load the catalog from disk.
 * Priority: catalog.json (real data) > sample-catalog.json (demo)
 */
function loadCatalog() {
  const realPath = getCatalogPath('catalog.json');
  const samplePath = getCatalogPath('sample-catalog.json');

  if (fs.existsSync(realPath)) {
    const raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    _catalogSource = 'real';
    return Array.isArray(raw) ? raw : raw.records || [];
  }

  if (fs.existsSync(samplePath)) {
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    _catalogSource = 'sample';
    return Array.isArray(raw) ? raw : raw.records || [];
  }

  _catalogSource = 'empty';
  return [];
}

/**
 * Get tagged catalog (cached in memory after first load).
 */
function getTaggedCatalog(forceReload = false) {
  if (_cachedCatalog && !forceReload) return _cachedCatalog;
  const raw = loadCatalog();
  _cachedCatalog = tagCatalog(raw);
  return _cachedCatalog;
}

/**
 * Replace the catalog with new records (from CSV upload).
 * Saves to data/catalog.json.
 */
function saveCatalog(records) {
  const catalogPath = getCatalogPath('catalog.json');
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify(records, null, 2));
  _cachedCatalog = null; // invalidate cache
}

/**
 * Return catalog metadata (size, source, sample titles).
 */
function getCatalogMeta() {
  const catalog = getTaggedCatalog();
  return {
    source: _catalogSource,
    count: catalog.length,
    sampleTitles: catalog.slice(0, 3).map(r => r.title),
  };
}

module.exports = { getTaggedCatalog, saveCatalog, getCatalogMeta };

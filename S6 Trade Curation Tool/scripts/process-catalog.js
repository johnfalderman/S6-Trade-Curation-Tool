#!/usr/bin/env node
/**
 * process-catalog.js
 * Converts your listing_records.csv into data/catalog.json
 *
 * Usage:
 *   node scripts/process-catalog.js path/to/listing_records.csv
 *
 * Or drop listing_records.csv into the project root and run:
 *   npm run process-catalog
 */

const fs = require('fs');
const path = require('path');

// Try to load papaparse, fall back to simple CSV parser
let Papa;
try {
  Papa = require('papaparse');
} catch (e) {
  Papa = null;
}

function parseCSVSimple(text) {
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Simple CSV split (handles quoted fields)
    const cols = [];
    let inQuote = false;
    let current = '';
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cols.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current.trim());

    const record = {};
    headers.forEach((h, idx) => {
      record[h] = cols[idx] || '';
    });
    records.push(record);
  }

  return records;
}

function normalizeRecord(record) {
  // Normalize field names — handle slight variations in crawl output
  const fieldMap = {
    'source_collection': ['source_collection', 'collection', 'source'],
    'page_num': ['page_num', 'page'],
    'product_url': ['product_url', 'url', 'href', 'link'],
    'product_handle': ['product_handle', 'handle', 'slug'],
    'title': ['title', 'name', 'product_title'],
    'image_url': ['image_url', 'img_url', 'image', 'img'],
    'image_alt': ['image_alt', 'alt', 'alt_text'],
    'artwork_family': ['artwork_family', 'family', 'artwork_group'],
  };

  const normalized = {};
  const lowerRecord = {};
  for (const [k, v] of Object.entries(record)) {
    lowerRecord[k.toLowerCase().replace(/\s+/g, '_')] = v;
  }

  for (const [normKey, aliases] of Object.entries(fieldMap)) {
    for (const alias of aliases) {
      if (lowerRecord[alias] !== undefined) {
        normalized[normKey] = lowerRecord[alias];
        break;
      }
    }
    if (!normalized[normKey]) normalized[normKey] = '';
  }

  // Ensure product_url is a full URL
  if (normalized.product_url && !normalized.product_url.startsWith('http')) {
    if (!normalized.product_url.startsWith('/')) {
      normalized.product_url = '/' + normalized.product_url;
    }
  }

  return normalized;
}

function main() {
  // Find the input CSV
  let csvPath = process.argv[2];

  if (!csvPath) {
    // Auto-discover common locations
    const candidates = [
      'listing_records.csv',
      'output/listing_records.csv',
      '../listing_records.csv',
    ];
    csvPath = candidates.find(p => fs.existsSync(path.resolve(p)));
  }

  if (!csvPath || !fs.existsSync(path.resolve(csvPath))) {
    console.error('❌  Could not find listing_records.csv');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/process-catalog.js path/to/listing_records.csv');
    console.error('');
    console.error('Or drop listing_records.csv into the project root and run again.');
    process.exit(1);
  }

  console.log(`📂  Reading: ${csvPath}`);
  const csvText = fs.readFileSync(path.resolve(csvPath), 'utf8');

  let records;
  if (Papa) {
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    records = result.data;
  } else {
    records = parseCSVSimple(csvText);
  }

  console.log(`📊  Found ${records.length} raw records`);

  const normalized = records
    .map(normalizeRecord)
    .filter(r => r.product_url && r.title); // drop empty rows

  console.log(`✅  ${normalized.length} valid records after cleanup`);

  const outputPath = path.join(__dirname, '..', 'data', 'catalog.json');
  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2));

  console.log(`💾  Saved to data/catalog.json`);
  console.log('');
  console.log('Restart your app (npm run dev) to use the real catalog.');
}

main();

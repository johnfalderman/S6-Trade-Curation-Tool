#!/usr/bin/env node
  /**
   * download-catalog.js
    * One-time script to download the tagged catalog from Netlify Blobs
     * and save it as a local JSON file for faster runtime reads.
      *
       * Prerequisites:
        *   - NETLIFY_SITE_ID and NETLIFY_TOKEN env vars must be set
         *     (or run via `netlify dev` / `netlify env:import`)
          *
           * Usage:
            *   NETLIFY_SITE_ID=your-site-id NETLIFY_TOKEN=your-token node scripts/download-catalog.js
             */

  const { getStore } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const BLOB_STORE = 'catalog';
const BLOB_KEY = 'records';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'catalog-tagged.json');

async function main() {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_TOKEN;

    if (!siteID || !token) {
          console.error('Error: NETLIFY_SITE_ID and NETLIFY_TOKEN environment variables are required.');
          process.exit(1);
    }

    console.log('Fetching catalog from Netlify Blobs...');

    const store = getStore({
          name: BLOB_STORE,
          siteID,
          token,
    });

    const raw = await store.get(BLOB_KEY, { type: 'text' });

    if (!raw) {
          console.error('Error: No data found in blob store "%s" at key "%s".', BLOB_STORE, BLOB_KEY);
          process.exit(1);
    }

    const records = JSON.parse(raw);

    if (!Array.isArray(records) || records.length === 0) {
          console.error('Error: Blob data is not a non-empty array.');
          process.exit(1);
    }

    // Ensure the data directory exists
    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(records));
    console.log('Saved %d records to %s', records.length, OUTPUT_PATH);
}

main().catch((err) => {
    console.error('Failed to download catalog:', err.message);
    process.exit(1);
});

'use client';

import { useState, useEffect } from 'react';

export default function CatalogPage() {
  const [meta, setMeta] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [csvText, setCsvText] = useState('');

  useEffect(() => {
    fetch('/api/catalog')
      .then(r => r.json())
      .then(setMeta)
      .catch(() => {});
  }, []);

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
  }

  async function handleUpload() {
    if (!csvText.trim()) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: csvText,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadResult(data);
      // Refresh meta
      const metaRes = await fetch('/api/catalog');
      setMeta(await metaRes.json());
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const sourceLabel =
    meta?.source === 'real'
      ? 'Your crawled catalog'
      : meta?.source === 'sample'
      ? 'Sample catalog (demo data)'
      : 'No catalog loaded';

  const statusColor =
    meta?.source === 'real'
      ? 'text-green-700 bg-green-50 border-green-200'
      : meta?.source === 'sample'
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-red-700 bg-red-50 border-red-200';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Catalog</h1>
      <p className="text-gray-500 text-sm mb-8">
        Load your crawled Society6 wall art catalog into the tool.
      </p>

      {/* Current status */}
      {meta && (
        <div className={`border rounded-lg p-4 mb-8 ${statusColor}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold">{sourceLabel}</p>
              <p className="text-sm mt-0.5">{meta.count?.toLocaleString()} records loaded</p>
            </div>
            <span className="text-xs font-mono">
              {meta.source === 'real' ? '✓ LIVE' : meta.source === 'sample' ? '⚠ DEMO' : '✗ EMPTY'}
            </span>
          </div>
          {meta.sampleTitles?.length > 0 && (
            <p className="text-xs mt-2 opacity-70">
              Sample: {meta.sampleTitles.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Upload form */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <div>
          <p className="font-semibold text-gray-900 mb-1">Load Your Catalog CSV</p>
          <p className="text-sm text-gray-500">
            Upload the <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">listing_records.csv</code> from your Society6 crawl.
            The file should have columns like: <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">title, product_url, image_url, source_collection</code>.
          </p>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Select CSV file
          </label>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={handleFileUpload}
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:border file:border-gray-300 file:rounded file:text-sm file:font-medium file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100"
          />
          {csvText && (
            <p className="text-xs text-gray-400 mt-1.5">
              {csvText.split('\n').length - 1} rows detected in file
            </p>
          )}
        </div>

        {uploadResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm font-medium text-green-800">
              ✓ Catalog loaded — {uploadResult.count?.toLocaleString()} products ready
            </p>
            <p className="text-xs text-green-700 mt-1">
              Sample: {uploadResult.sampleTitles?.join(', ')}
            </p>
          </div>
        )}

        {uploadError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            {uploadError}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!csvText || uploading}
          className="btn-primary"
        >
          {uploading ? 'Loading catalog…' : 'Load Catalog'}
        </button>
      </div>

      {/* Manual option */}
      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-5">
        <p className="text-sm font-semibold text-gray-700 mb-2">Alternative: Command-line load</p>
        <p className="text-sm text-gray-500 mb-3">
          If you have terminal access to the project folder, you can also run:
        </p>
        <pre className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto">
{`# From the project directory:
npm run process-catalog path/to/listing_records.csv

# Then restart the app`}
        </pre>
      </div>
    </div>
  );
}

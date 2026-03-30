'use client';

import { useState, useEffect, useRef } from 'react';

export default function CatalogPage() {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [parseProgress, setParseProgress] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchMeta();
  }, []);

  async function fetchMeta() {
    try {
      const res = await fetch('/api/catalog');
      const data = await res.json();
      setMeta(data);
    } catch (e) {
      console.error('Failed to fetch catalog meta:', e);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setMessage('');
    setParseProgress('Reading file...');

    try {
      setParseProgress('Loading CSV parser...');
      await loadPapaParse();

      setParseProgress('Parsing ' + file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)...');

      const records = await parseCSVClientSide(file);
      setParseProgress('Parsed ' + records.length + ' records. Compressing...');

      const compact = records
        .filter(r => r.product_url || r.productUrl)
        .map(r => ({
          t: r.title || '',
          u: r.product_url || r.productUrl || '',
          h: r.product_handle || r.productHandle || '',
          c: r.source_collection || r.sourceCollection || '',
          i: r.image_url || r.imageUrl || '',
          a: r.image_alt || r.imageAlt || '',
        }));

      const payload = JSON.stringify({ compact });
      const payloadSizeMB = (new Blob([payload]).size / 1024 / 1024).toFixed(2);
      setParseProgress('Uploading ' + payloadSizeMB + ' MB payload (' + compact.length + ' records)...');

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Server error: ' + res.status);
      }

      setMessage('Catalog loaded: ' + data.count + ' products tagged and ready.');
      setParseProgress('');
      fetchMeta();
    } catch (err) {
      setError('Upload failed: ' + err.message);
      setParseProgress('');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function loadPapaParse() {
    return new Promise((resolve, reject) => {
      if (window.Papa) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load PapaParse'));
      document.head.appendChild(script);
    });
  }

  function parseCSVClientSide(file) {
    return new Promise((resolve, reject) => {
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
        error: (err) => reject(new Error('CSV parse error: ' + err.message)),
      });
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-8">
          <a href="/" className="text-sm text-blue-600 hover:underline">Back to Curation Tool</a>
          <h1 className="text-2xl font-bold text-gray-900 mt-3">Catalog Management</h1>
          <p className="text-gray-500 mt-1 text-sm">Load the Society6 wall art catalog to power recommendations.</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-800 mb-3">Current Catalog</h2>
          {meta ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className={"inline-block w-2 h-2 rounded-full " + (meta.source === 'real' ? 'bg-green-500' : meta.source === 'sample' ? 'bg-yellow-400' : 'bg-gray-300')} />
                <span className="font-medium text-gray-700">
                  {meta.source === 'real' ? 'Real catalog loaded' : meta.source === 'sample' ? 'Sample catalog active' : 'No catalog loaded'}
                </span>
              </div>
              {meta.count > 0 && <p className="text-gray-500 ml-4">{meta.count.toLocaleString()} products available</p>}
              {meta.source === 'sample' && (
                <p className="text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mt-2 text-xs">
                  Using demo data. Upload listing_records.csv below to enable real recommendations.
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Loading status...</p>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Upload Catalog CSV</h2>
          <p className="text-gray-500 text-sm mb-4">
            Upload listing_records.csv from the crawl output folder. The file is parsed in your browser first, so large files work fine.
          </p>
          <label className={"flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors " + (loading ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50')}>
            <div className="text-center">
              <p className="font-medium text-gray-700">{loading ? 'Processing...' : 'Click to select listing_records.csv'}</p>
              <p className="text-xs text-gray-400 mt-1">CSV files up to 50 MB supported</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" disabled={loading} onChange={handleFileUpload} />
          </label>
          {parseProgress && (
            <div className="mt-4 flex items-center gap-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full flex-shrink-0" />
              {parseProgress}
            </div>
          )}
          {message && <div className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">{message}</div>}
          {error && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3"><strong>Error:</strong> {error}</div>}
        </div>

        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-3">Where to find the file</h2>
          <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
            <li>Open your Downloads folder</li>
            <li>Open the folder named society6-clean-wall-art-crawler</li>
            <li>Open the output subfolder</li>
            <li>Select listing_records.csv</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

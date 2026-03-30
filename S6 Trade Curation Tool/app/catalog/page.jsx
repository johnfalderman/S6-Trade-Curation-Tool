'use client';

import { useState, useEffect, useRef } from 'react';

export default function CatalogPage() {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => { fetchMeta(); }, []);

  async function fetchMeta() {
    try {
      const res = await fetch('/api/catalog');
      const data = await res.json();
      setMeta(data);
    } catch (e) { console.error(e); }
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setError(''); setMessage('');

    try {
      setProgress('Loading parser...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', 'Papa');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js', 'pako');

      setProgress('Parsing ' + file.name + ' (' + (file.size/1024/1024).toFixed(1) + ' MB)...');
      const records = await parseCSV(file);

      setProgress('Parsed ' + records.length + ' records. Compressing...');
      const compact = records
        .filter(r => r.product_url || r.productUrl)
        .map(r => {
          let u = r.product_url || r.productUrl || '';
          if (u.startsWith('https://society6.com')) u = u.slice(20);
          let i = r.image_url || r.imageUrl || '';
          if (i.includes('?')) i = i.split('?')[0] + '?width=400';
          if (i.startsWith('https://society6.com')) i = i.slice(20);
          return { t: r.title||'', u, h: r.product_handle||r.productHandle||'', c: r.source_collection||r.sourceCollection||'', i, a: (r.image_alt||r.imageAlt||'').slice(0,60) };
        });

      const jsonStr = JSON.stringify({ compact });
      const compressed = window.pako.gzip(jsonStr);
      const b64 = btoa(String.fromCharCode(...compressed));
      const sizeMB = (b64.length / 1024 / 1024).toFixed(2);
      setProgress('Uploading ' + sizeMB + ' MB compressed (' + compact.length + ' records)...');

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gzip: b64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);

      setMessage('Catalog loaded: ' + data.count + ' products ready.');
      setProgress('');
      fetchMeta();
    } catch (err) {
      setError('Upload failed: ' + err.message);
      setProgress('');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function loadScript(src, globalKey) {
    return new Promise((resolve, reject) => {
      if (window[globalKey]) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Failed: ' + src));
      document.head.appendChild(s);
    });
  }

  function parseCSV(file) {
    return new Promise((resolve, reject) => {
      window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => resolve(r.data), error: e => reject(e) });
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
                <span className={"inline-block w-2 h-2 rounded-full " + (meta.source === 'real' ? 'bg-green-500' : 'bg-yellow-400')} />
                <span className="font-medium text-gray-700">
                  {meta.source === 'real' ? 'Real catalog loaded' : 'Sample catalog active'}
                </span>
              </div>
              {meta.count > 0 && <p className="text-gray-500 ml-4">{meta.count.toLocaleString()} products available</p>}
              {meta.source === 'sample' && (
                <p className="text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mt-2 text-xs">
                  Using demo data. Upload listing_records.csv to enable real recommendations.
                </p>
              )}
            </div>
          ) : <p className="text-gray-400 text-sm">Loading...</p>}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Upload Catalog CSV</h2>
          <p className="text-gray-500 text-sm mb-4">Parsed and compressed in your browser — large files work fine.</p>
          <label className={"flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors " + (loading ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50')}>
            <p className="font-medium text-gray-700">{loading ? 'Processing...' : 'Click to select listing_records.csv'}</p>
            <p className="text-xs text-gray-400 mt-1">Compressed before upload — any size works</p>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" disabled={loading} onChange={handleFileUpload} />
          </label>
          {progress && (
            <div className="mt-4 flex items-center gap-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full flex-shrink-0" />
              {progress}
            </div>
          )}
          {message && <div className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">{message}</div>}
          {error && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3"><strong>Error:</strong> {error}</div>}
        </div>

        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-3">Where to find the file</h2>
          <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
            <li>Open your Downloads folder</li>
            <li>Open society6-clean-wall-art-crawler</li>
            <li>Open the output subfolder</li>
            <li>Select listing_records.csv</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

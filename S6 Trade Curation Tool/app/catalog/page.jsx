'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// Load a script from CDN once
function loadScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Convert Uint8Array to base64 safely — avoids call stack overflow on large buffers
function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export default function CatalogPage() {
  const [status, setStatus] = useState({ loading: true, source: 'unknown', count: 0 });
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    fetch('/api/catalog')
      .then(r => r.json())
      .then(d => setStatus({ loading: false, source: d.source || 'unknown', count: d.count || 0 }))
      .catch(() => setStatus({ loading: false, source: 'error', count: 0 }));
  }, []);

  async function handleFile(file) {
    if (!file) return;
    setError('');
    setSuccess('');
    setUploading(true);

    try {
      setProgress('Loading parser...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', 'Papa');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js', 'pako');

      setProgress('Parsing CSV...');
      const text = await file.text();
      const { data, errors } = window.Papa.parse(text, { header: true, skipEmptyLines: true });

      if (!data.length) throw new Error('CSV parsed but no rows found');

      setProgress(`Compressing ${data.length.toLocaleString()} records...`);

      // Build compact array — strip base domain and query strings to minimize payload
      const compact = data
        .filter(r => r.product_url || r.title)
        .map(r => {
          let u = (r.product_url || '').replace('https://society6.com', '').replace('http://society6.com', '');
          let i = (r.image_url || '').replace('https://society6.com', '').replace('http://society6.com', '');
          // Strip query string from image URL, then add clean width param
          const qIdx = i.indexOf('?');
          if (qIdx > -1) i = i.substring(0, qIdx);
          if (i) i = i + '?width=400';
          return {
            t: r.title || '',
            u,
            h: r.product_handle || '',
            c: r.source_collection || '',
            i,
            a: r.image_alt || '',
          };
        })
        .filter(r => r.u);

      if (!compact.length) throw new Error('No valid product records found in CSV');

      const jsonStr = JSON.stringify({ compact });
      const compressed = window.pako.gzip(jsonStr);
      const b64 = uint8ToBase64(compressed);

      const sizeMB = (b64.length / 1024 / 1024).toFixed(2);
      setProgress(`Uploading ${sizeMB}MB (compressed from ${(jsonStr.length / 1024 / 1024).toFixed(1)}MB)...`);

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gzip: b64 }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');

      setSuccess(`Catalog loaded: ${json.count.toLocaleString()} products tagged and ready`);
      setStatus({ loading: false, source: 'real', count: json.count });
    } catch (err) {
      setError('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <Link href="/" className="text-blue-600 text-sm hover:underline">← Back to Curation Tool</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-4 mb-1">Catalog Management</h1>
        <p className="text-gray-500 text-sm mb-8">Load the Society6 wall art catalog to power recommendations.</p>

        {/* Status */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold text-gray-800 mb-3">Current Catalog</h2>
          {status.loading ? (
            <p className="text-gray-400 text-sm">Checking catalog...</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${status.source === 'real' ? 'bg-green-500' : 'bg-yellow-400'}`}></span>
                <span className="font-medium text-gray-700">
                  {status.source === 'real' ? 'Real catalog loaded' : 'Sample catalog active'}
                </span>
              </div>
              <p className="text-gray-500 text-sm ml-4">{status.count.toLocaleString()} products available</p>
              {status.source !== 'real' && (
                <p className="mt-3 text-xs text-yellow-700 bg-yellow-50 rounded px-3 py-2">
                  Using demo data. Upload listing_records.csv to enable real recommendations.
                </p>
              )}
            </>
          )}
        </div>

        {/* Upload */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-1">Upload Catalog CSV</h2>
          <p className="text-gray-400 text-xs mb-4">Parsed and compressed in your browser — large files work fine.</p>

          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          >
            {uploading ? (
              <p className="text-blue-600 text-sm font-medium">{progress || 'Processing...'}</p>
            ) : (
              <>
                <p className="text-gray-600 font-medium">Click to select listing_records.csv</p>
                <p className="text-gray-400 text-xs mt-1">Compressed before upload — any size works</p>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => handleFile(e.target.files[0])}
          />

          {error && (
            <div className="mt-4 bg-red-50 border border-red-100 rounded p-3 text-sm text-red-700">
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}
          {success && (
            <div className="mt-4 bg-green-50 border border-green-100 rounded p-3 text-sm text-green-700">
              ✓ {success}
            </div>
          )}

          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">Where to find the file</p>
            <p className="text-xs text-gray-500">Open your Downloads folder → <code className="bg-gray-100 px-1 rounded">society6-clean-wall-art-crawler/output/listing_records.csv</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}

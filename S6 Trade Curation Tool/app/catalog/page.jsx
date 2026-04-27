'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// Per-image vision cost estimate. Based on Haiku-4.5 pricing for a 400px image
// + ~600 token prompt + ~200 token JSON response. Used only for surfacing a
// rough "estimated cost" string in the UI — not billing-accurate.
const COST_PER_IMAGE_USD = 0.005;

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

  // Vision enrichment state. `enrichStatus` mirrors the enrichment-meta blob
  // on the server. `enriching` toggles the client-driven batch loop. The
  // `stopRef` lets the loop exit cleanly between batches when the user
  // pauses — using a ref avoids stale closures inside the async while loop.
  const [enrichStatus, setEnrichStatus] = useState({ totalRecords: 0, enrichedCount: 0, status: 'idle' });
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const [batchTimings, setBatchTimings] = useState([]); // recent batch durations for ETA
  const [enrichSamples, setEnrichSamples] = useState([]); // rolling spot-check samples
  const stopRef = useRef(false);

  // Refresh enrichment status from the server. Pass `withSamples` to also
  // pull the rolling sample buffer — we do this on mount and after every
  // batch so the UI surface stays fresh, but skip it for in-loop polls
  // where status is what matters.
  async function refreshEnrichStatus(withSamples = false) {
    try {
      const url = withSamples ? '/api/catalog/enrich?samples=true' : '/api/catalog/enrich';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setEnrichStatus({
        totalRecords: data.totalRecords || 0,
        enrichedCount: data.enrichedCount || 0,
        lastProcessedIndex: data.lastProcessedIndex || 0,
        status: data.status || 'idle',
      });
      if (withSamples && Array.isArray(data.samples)) {
        setEnrichSamples(data.samples);
      }
    } catch {
      // Silent — enrichment status is non-critical, retry on next poll
    }
  }

  useEffect(() => {
    fetch('/api/catalog')
      .then(r => r.json())
      .then(d => {
        setStatus({ loading: false, source: d.source || 'unknown', count: d.count || 0 });
        if (d.enrichment) {
          setEnrichStatus({
            totalRecords: d.enrichment.totalRecords || d.count || 0,
            enrichedCount: d.enrichment.enrichedCount || 0,
            lastProcessedIndex: d.enrichment.lastProcessedIndex || 0,
            status: d.enrichment.status || 'idle',
          });
        }
        // Pull the sample buffer separately — keeps the lightweight
        // /api/catalog response cheap while still showing recent samples
        // when the user lands on the page.
        if (d.source === 'real') refreshEnrichStatus(true);
      })
      .catch(() => setStatus({ loading: false, source: 'error', count: 0 }));
  }, []);

  // —— Enrichment batch loop ——————————————————————————————————————————————
  // Drives /api/catalog/enrich in a tight loop until either: the catalog is
  // fully enriched, the user pauses (stopRef), or a batch errors out.
  // Each batch updates the progress UI so the user sees movement.
  async function runEnrichmentLoop() {
    setEnrichError('');
    setEnriching(true);
    stopRef.current = false;
    setBatchTimings([]);
    try {
      while (!stopRef.current) {
        const t0 = Date.now();
        const res = await fetch('/api/catalog/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchSize: 20, concurrency: 6 }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Batch failed (HTTP ${res.status})`);
        }

        const elapsed = Date.now() - t0;
        setBatchTimings(prev => [...prev.slice(-9), { ms: elapsed, processed: data.processed || 0 }]);

        setEnrichStatus({
          totalRecords: data.totalRecords || 0,
          enrichedCount: data.enrichedCount || 0,
          lastProcessedIndex: data.lastProcessedIndex || 0,
          status: data.status || 'partial',
        });

        // Refresh the spot-check panel from the batch response — saves a
        // separate GET round-trip per batch.
        if (Array.isArray(data.samples) && data.samples.length > 0) {
          setEnrichSamples(data.samples);
        }

        // Done — fully enriched or only un-enrichable records remain
        if (data.status === 'completed' || data.status === 'completed-with-skipped') break;

        // No-op batch (nothing to do) — usually means the tail of the catalog
        // is all images-missing or already-enriched. Stop to avoid spinning.
        if ((data.processed || 0) === 0 && (data.attempted || 0) === 0) break;

        // Brief pause between batches to avoid hammering the API
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      setEnrichError(err.message || 'Enrichment failed');
    } finally {
      setEnriching(false);
      stopRef.current = false;
      // Final reconciliation in case the last batch's response was partial
      refreshEnrichStatus();
    }
  }

  function pauseEnrichment() {
    stopRef.current = true;
  }

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
      // A fresh upload resets enrichment progress on the server. Pull the
      // new state so the UI reflects "0 of N enriched" instead of stale
      // numbers from the previous catalog.
      refreshEnrichStatus();
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

        {/* Loud admin-only warning. Anyone reaching this page should see it
            before any clickable controls — the actions on this page can
            overwrite the catalog or burn through API budget. */}
        <div className="mt-4 bg-red-50 border-2 border-red-300 rounded-lg p-4">
          <p className="text-red-800 font-bold text-sm tracking-wide">FOR ADMINISTRATOR ONLY</p>
          <p className="text-red-700 text-sm mt-1">Please don&apos;t make any changes to the catalog.</p>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-1">Catalog Management</h1>
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

        {/* Vision Enrichment — only shown when a real catalog is loaded */}
        {status.source === 'real' && status.count > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-semibold text-gray-800">Vision Enrichment</h2>
              <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-0.5 font-medium">beta</span>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              Use Claude Vision to analyze each artwork image and extract style, palette, subject, and keywords directly from the picture.
              This produces far more accurate tags than text metadata alone — especially for artworks with sparse titles or alt text — and lifts recommendation quality across the entire app.
            </p>

            {(() => {
              const total = enrichStatus.totalRecords || status.count || 0;
              const done = enrichStatus.enrichedCount || 0;
              const remaining = Math.max(0, total - done);
              const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
              const isComplete = enrichStatus.status === 'completed' || (total > 0 && done >= total);
              const isPartial = done > 0 && !isComplete;

              const statusLabel = isComplete
                ? 'Fully enriched'
                : isPartial
                  ? `Partially enriched (${done.toLocaleString()} / ${total.toLocaleString()})`
                  : 'Not yet enriched';

              const statusDot = isComplete ? 'bg-green-500' : isPartial ? 'bg-purple-500' : 'bg-gray-300';

              // Estimate from observed batch timings. Each timing entry tells
              // us how many records we processed in how long. Average that
              // and project across `remaining` to get an ETA.
              let etaSec = null;
              if (batchTimings.length > 0 && remaining > 0) {
                const sumProcessed = batchTimings.reduce((s, t) => s + (t.processed || 0), 0);
                const sumMs = batchTimings.reduce((s, t) => s + (t.ms || 0), 0);
                if (sumProcessed > 0) {
                  const msPerRecord = sumMs / sumProcessed;
                  etaSec = Math.round((msPerRecord * remaining) / 1000);
                }
              }
              const etaLabel = etaSec === null
                ? null
                : etaSec < 60
                  ? `~${etaSec}s remaining`
                  : etaSec < 3600
                    ? `~${Math.round(etaSec / 60)} min remaining`
                    : `~${(etaSec / 3600).toFixed(1)} hrs remaining`;

              const projectedCost = remaining * COST_PER_IMAGE_USD;
              const totalCost = total * COST_PER_IMAGE_USD;

              return (
                <>
                  <div className="mb-4">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${statusDot}`}></span>
                        <span className="text-sm font-medium text-gray-700">{statusLabel}</span>
                      </div>
                      <span className="text-xs text-gray-500">{done.toLocaleString()} / {total.toLocaleString()}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-purple-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                      <span>
                        {enriching && etaLabel
                          ? etaLabel
                          : isComplete
                            ? 'Done'
                            : remaining > 0
                              ? `${remaining.toLocaleString()} records remaining`
                              : ''}
                      </span>
                      <span>
                        {enriching
                          ? `~$${projectedCost.toFixed(2)} more to finish`
                          : isComplete
                            ? `~$${totalCost.toFixed(2)} spent (estimated)`
                            : `~$${projectedCost.toFixed(2)} estimated to enrich rest`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {!enriching ? (
                      <button
                        onClick={runEnrichmentLoop}
                        disabled={isComplete}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                      >
                        {isComplete ? 'Enrichment complete' : isPartial ? 'Resume Enrichment' : 'Start Enrichment'}
                      </button>
                    ) : (
                      <button
                        onClick={pauseEnrichment}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                      >
                        Pause
                      </button>
                    )}
                    {enriching && (
                      <span className="text-xs text-purple-600 animate-pulse">
                        Analyzing images...
                      </span>
                    )}
                    {!enriching && isPartial && (
                      <button
                        onClick={refreshEnrichStatus}
                        className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto"
                      >
                        Refresh status
                      </button>
                    )}
                  </div>

                  {enrichError && (
                    <div className="mt-3 bg-red-50 border border-red-100 rounded p-3 text-sm text-red-700">
                      <span className="font-semibold">Error:</span> {enrichError}
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 space-y-1">
                    <p><strong className="text-gray-500">How it works:</strong> Each artwork image is sent to Claude Haiku for visual analysis. Vision tags supplement the existing regex-based tags — you can run this once on a fresh catalog and partial enrichment works fine for testing.</p>
                    <p><strong className="text-gray-500">Resume-safe:</strong> Already-enriched records are skipped. Pause anytime; resume picks up where it left off.</p>
                  </div>
                </>
              );
            })()}

            {/* Spot-check panel — surfaces a rolling sample of recent
                enrichments so the user can sanity-check tag quality without
                opening the blob store. Each batch updates one sample, so
                this fills out gradually as enrichment progresses. */}
            {enrichSamples.length > 0 && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Recent samples</h3>
                  <span className="text-xs text-gray-400">{enrichSamples.length} of last enrichments</span>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  One random record per batch. Use these to spot-check whether vision tags match the artwork — if a cocktail print is tagged <code className="text-[11px] bg-gray-100 px-1 rounded">food-drink</code> and a landscape is tagged <code className="text-[11px] bg-gray-100 px-1 rounded">landscape</code>, you&apos;re good.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {enrichSamples.slice(0, 6).map(s => (
                    <div key={`${s.index}-${s.product_handle}`} className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex">
                      <div className="w-24 h-24 bg-gray-100 shrink-0 overflow-hidden">
                        {s.image_url && (
                          <img
                            src={s.image_url.startsWith('/') ? 'https://society6.com' + s.image_url : s.image_url}
                            alt={s.title}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <div className="p-2.5 text-xs flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate" title={s.title}>{s.title}</div>
                        {s.visionSummary && <div className="text-gray-500 italic mt-0.5 line-clamp-2">{s.visionSummary}</div>}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(s.visionSubject || []).slice(0, 2).map(t => (
                            <span key={'sub-' + t} className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded font-medium">{t}</span>
                          ))}
                          {(s.visionStyle || []).slice(0, 3).map(t => (
                            <span key={'sty-' + t} className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded">{t}</span>
                          ))}
                          {(s.visionPalette || []).slice(0, 3).map(t => (
                            <span key={'pal-' + t} className="bg-amber-50 text-amber-700 text-[10px] px-1.5 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {enrichSamples.length > 6 && (
                  <p className="text-xs text-gray-400 mt-2 text-center">+ {enrichSamples.length - 6} more in buffer (newest shown first)</p>
                )}
              </div>
            )}
          </div>
        )}

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

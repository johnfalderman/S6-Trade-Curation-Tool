'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// ── Helpers ───────────────────────────────────────────────────

// Postgres returns array columns as "{val1,val2}" strings — parse them
function pgArr(val) {
  if (Array.isArray(val)) return val;
  if (!val || typeof val !== 'string') return [];
  return val.replace(/^{|}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

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

function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function fmtCost(n) {
  const num = parseFloat(n) || 0;
  return num < 0.01 ? `$${num.toFixed(4)}` : `$${num.toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDuration(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

const CATEGORY_LABELS = {
  wall_art: 'Wall Art',
  home_decor: 'Home Decor',
  apparel: 'Apparel',
  accessories: 'Accessories',
  stationery: 'Stationery',
  tech: 'Tech',
  other: 'Other',
};

const CATEGORY_COLORS = {
  wall_art:    { bar: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  home_decor:  { bar: 'bg-sky-500',    badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  apparel:     { bar: 'bg-rose-500',   badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  accessories: { bar: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  stationery:  { bar: 'bg-teal-500',   badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  tech:        { bar: 'bg-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  other:       { bar: 'bg-gray-400',   badge: 'bg-gray-50 text-gray-600 border-gray-200' },
};

// ── Main component ────────────────────────────────────────────

export default function CatalogPage() {
  const [pgData, setPgData] = useState(null);
  const [pgLoading, setPgLoading] = useState(true);
  const [pgError, setPgError] = useState('');

  // Legacy Netlify Blobs catalog state (kept for backwards compat upload flow)
  const [uploadStatus, setUploadStatus] = useState({ loading: true, source: 'unknown', count: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const fileRef = useRef();

  // Enrichment run state
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const [enrichCategory, setEnrichCategory] = useState('');
  const [batchTimings, setBatchTimings] = useState([]);
  const [currentRunStats, setCurrentRunStats] = useState(null);
  const stopRef = useRef(false);

  // ── Data fetching ───────────────────────────────────────────

  async function loadPgData() {
    try {
      const res = await fetch('/api/catalog/enrich-pg');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPgData(data);
      setPgError('');
    } catch (err) {
      setPgError(err.message);
    } finally {
      setPgLoading(false);
    }
  }

  useEffect(() => {
    loadPgData();
    // Also load legacy catalog status for the upload section
    fetch('/api/catalog')
      .then(r => r.json())
      .then(d => setUploadStatus({ loading: false, source: d.source || 'unknown', count: d.count || 0 }))
      .catch(() => setUploadStatus({ loading: false, source: 'error', count: 0 }));
  }, []);

  // ── Enrichment loop ─────────────────────────────────────────

  async function runEnrichmentLoop() {
    setEnrichError('');
    setEnriching(true);
    stopRef.current = false;
    setBatchTimings([]);
    setCurrentRunStats({ succeeded: 0, failed: 0, costUsd: 0 });

    try {
      while (!stopRef.current) {
        const t0 = Date.now();
        const res = await fetch('/api/catalog/enrich-pg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchSize: 20,
            concurrency: 6,
            category: enrichCategory || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Batch failed (HTTP ${res.status})`);

        const elapsed = Date.now() - t0;
        setBatchTimings(prev => [...prev.slice(-9), { ms: elapsed, processed: data.succeeded || 0 }]);
        setCurrentRunStats(prev => ({
          succeeded: (prev?.succeeded || 0) + (data.succeeded || 0),
          failed:    (prev?.failed    || 0) + (data.failed    || 0),
          costUsd:   (prev?.costUsd   || 0) + (data.costUsd   || 0),
        }));

        // Reload pg stats after each batch
        await loadPgData();

        // Stop if nothing was processed (queue empty)
        if ((data.succeeded || 0) + (data.failed || 0) === 0) break;

        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      setEnrichError(err.message || 'Enrichment failed');
    } finally {
      setEnriching(false);
      stopRef.current = false;
      loadPgData();
    }
  }

  // ── CSV upload (legacy Netlify Blobs path) ──────────────────

  async function handleFile(file) {
    if (!file) return;
    setUploadError('');
    setUploadSuccess('');
    setUploading(true);

    try {
      setUploadProgress('Loading parser...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', 'Papa');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js', 'pako');

      setUploadProgress('Parsing CSV...');
      const text = await file.text();
      const { data } = window.Papa.parse(text, { header: true, skipEmptyLines: true });
      if (!data.length) throw new Error('CSV parsed but no rows found');

      setUploadProgress(`Compressing ${data.length.toLocaleString()} records...`);
      const compact = data
        .filter(r => r.product_url || r.title)
        .map(r => {
          let u = (r.product_url || '').replace('https://society6.com', '');
          let i = (r.image_url || '').replace('https://society6.com', '');
          const qIdx = i.indexOf('?');
          if (qIdx > -1) i = i.substring(0, qIdx);
          if (i) i = i + '?width=400';
          return { t: r.title || '', u, h: r.product_handle || '', c: r.source_collection || '', i, a: r.image_alt || '' };
        })
        .filter(r => r.u);

      if (!compact.length) throw new Error('No valid product records found in CSV');

      const jsonStr = JSON.stringify({ compact });
      const compressed = window.pako.gzip(jsonStr);
      const b64 = uint8ToBase64(compressed);
      setUploadProgress(`Uploading ${(b64.length / 1024 / 1024).toFixed(2)}MB...`);

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gzip: b64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');

      setUploadSuccess(`Catalog loaded: ${json.count.toLocaleString()} products ready`);
      setUploadStatus({ loading: false, source: 'real', count: json.count });
    } catch (err) {
      setUploadError('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  // ── Derived stats ───────────────────────────────────────────

  const totalProducts  = pgData?.summary?.reduce((s, r) => s + parseInt(r.total_products), 0) || 0;
  const totalEnriched  = pgData?.summary?.reduce((s, r) => s + parseInt(r.enriched), 0) || 0;
  const totalPending   = pgData?.summary?.reduce((s, r) => s + parseInt(r.pending), 0) || 0;
  const totalFailed    = pgData?.summary?.reduce((s, r) => s + parseInt(r.failed), 0) || 0;
  const overallPct     = totalProducts > 0 ? Math.round((totalEnriched / totalProducts) * 100) : 0;

  const totalCostSpent = pgData?.recentRuns?.reduce((s, r) => s + parseFloat(r.total_cost_usd || 0), 0) || 0;

  // ETA calc
  let etaLabel = null;
  if (enriching && batchTimings.length > 0 && totalPending > 0) {
    const sumP = batchTimings.reduce((s, t) => s + (t.processed || 0), 0);
    const sumMs = batchTimings.reduce((s, t) => s + (t.ms || 0), 0);
    if (sumP > 0) {
      const msPerRecord = sumMs / sumP;
      const etaSec = Math.round((msPerRecord * totalPending) / 1000);
      etaLabel = etaSec < 60 ? `~${etaSec}s left`
               : etaSec < 3600 ? `~${Math.round(etaSec / 60)}m left`
               : `~${(etaSec / 3600).toFixed(1)}h left`;
    }
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white font-mono">

      {/* Top bar */}
      <div className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-white/40 text-xs hover:text-white/70 transition-colors">
          ← curation tool
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/catalog/new-designs" className="text-violet-400/70 text-xs hover:text-violet-300 transition-colors">
            new designs →
          </Link>
          <span className="text-white/20 text-xs tracking-widest uppercase">admin only</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Header */}
        <div>
          <div className="inline-block bg-red-500/10 border border-red-500/30 rounded px-3 py-1 text-red-400 text-xs tracking-widest uppercase mb-4">
            ⚠ Administrator Access Only
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Catalog Enrichment</h1>
          <p className="text-white/40 text-sm mt-1">Vision analysis pipeline · Postgres backend</p>
        </div>

        {/* Overall progress bar */}
        {!pgLoading && totalProducts > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-white/60 text-xs uppercase tracking-widest">Overall Progress</span>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span>{totalEnriched.toLocaleString()} enriched</span>
                <span>{totalPending.toLocaleString()} pending</span>
                {totalFailed > 0 && <span className="text-red-400">{totalFailed.toLocaleString()} failed</span>}
                <span className="text-white/60 font-bold">{overallPct}%</span>
              </div>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 transition-all duration-700"
                style={{ width: `${overallPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-white/30 mt-2">
              <span>{totalProducts.toLocaleString()} total products</span>
              <span>
                {enriching && etaLabel ? etaLabel : `${fmtCost(totalCostSpent)} spent`}
              </span>
            </div>
          </div>
        )}

        {/* Category breakdown */}
        {!pgLoading && pgData?.summary?.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-4">By Category</h2>
            <div className="space-y-3">
              {pgData.summary.map(row => {
                const total = parseInt(row.total_products);
                const enriched = parseInt(row.enriched);
                const pct = parseFloat(row.pct_enriched) || 0;
                const colors = CATEGORY_COLORS[row.category] || CATEGORY_COLORS.other;
                return (
                  <div key={row.category}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${colors.badge}`}>
                          {CATEGORY_LABELS[row.category] || row.category}
                        </span>
                        <span className="text-white/30 text-xs">{total.toLocaleString()} products</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/30">
                        {parseInt(row.failed) > 0 && (
                          <span className="text-red-400">{parseInt(row.failed).toLocaleString()} failed</span>
                        )}
                        <span>{enriched.toLocaleString()} / {total.toLocaleString()}</span>
                        <span className="text-white/50 w-8 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${colors.bar} transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {pgLoading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-white/30 text-sm">
            Loading catalog data...
          </div>
        )}

        {pgError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            Database error: {pgError}
          </div>
        )}

        {/* Enrichment controls */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-white/60 text-xs uppercase tracking-widest mb-4">Run Enrichment</h2>

          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select
              value={enrichCategory}
              onChange={e => setEnrichCategory(e.target.value)}
              disabled={enriching}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 focus:outline-none focus:border-violet-500 disabled:opacity-40"
            >
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>

            {enriching ? (
              <button
                onClick={() => { stopRef.current = true; }}
                className="px-4 py-2 bg-white/10 text-white/70 rounded-lg text-sm font-medium hover:bg-white/20 transition-colors"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={runEnrichmentLoop}
                disabled={pgLoading || totalPending === 0}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {totalPending === 0 ? 'No pending products' : `Enrich ${enrichCategory ? CATEGORY_LABELS[enrichCategory] : 'All'}`}
              </button>
            )}

            {enriching && (
              <span className="text-violet-400 text-xs animate-pulse">
                {currentRunStats ? `${currentRunStats.succeeded} enriched · ${fmtCost(currentRunStats.costUsd)} this run` : 'Analyzing...'}
              </span>
            )}
          </div>

          {enrichError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-xs">
              {enrichError}
            </div>
          )}

          <p className="text-white/20 text-xs mt-3">
            Batches of 20 · concurrency 6 · Claude Haiku vision · resume-safe
          </p>
        </div>

        {/* Recent runs */}
        {pgData?.recentRuns?.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-4">Recent Runs</h2>
            <div className="space-y-2">
              {pgData.recentRuns.map(run => (
                <div
                  key={run.id}
                  className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      run.run_status === 'completed' ? 'bg-green-500' :
                      run.run_status === 'running'   ? 'bg-violet-400 animate-pulse' :
                      'bg-white/20'
                    }`} />
                    <div className="min-w-0">
                      <span className="text-white/60 text-xs truncate block">
                        {run.run_label || 'Unnamed run'}
                        {run.category_filter && (
                          <span className="ml-2 text-white/30">· {CATEGORY_LABELS[run.category_filter] || run.category_filter}</span>
                        )}
                      </span>
                      <span className="text-white/25 text-xs">{fmtDate(run.started_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs shrink-0 ml-4">
                    <span className="text-green-400">{parseInt(run.total_succeeded).toLocaleString()} ✓</span>
                    {parseInt(run.total_failed) > 0 && (
                      <span className="text-red-400">{parseInt(run.total_failed).toLocaleString()} ✗</span>
                    )}
                    <span className="text-white/30">{fmtCost(run.total_cost_usd)}</span>
                    {run.completed_at && (
                      <span className="text-white/20">{fmtDuration(run.started_at, run.completed_at)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent samples */}
        {pgData?.recentSamples?.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Recent Enrichments</h2>
            <p className="text-white/25 text-xs mb-4">Spot-check vision tag quality against the actual images.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pgData.recentSamples.map(s => (
                <div
                  key={s.s6_product_id}
                  className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.03] flex"
                >
                  <div className="w-20 h-20 bg-white/5 shrink-0 overflow-hidden">
                    {s.image_url && (
                      <img
                        src={s.image_url.startsWith('/') ? 'https://society6.com' + s.image_url : s.image_url}
                        alt={s.title}
                        className="w-full h-full object-cover opacity-90"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <div className="p-2.5 text-xs flex-1 min-w-0">
                    <div className="text-white/70 font-medium truncate" title={s.title}>{s.title}</div>
                    {s.vision_summary && (
                      <div className="text-white/30 italic mt-0.5 line-clamp-2 text-[11px]">{s.vision_summary}</div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {pgArr(s.vision_subject).slice(0, 2).map(t => (
                        <span key={'sub-' + t} className="bg-violet-500/20 text-violet-300 text-[10px] px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                      {pgArr(s.vision_style).slice(0, 2).map(t => (
                        <span key={'sty-' + t} className="bg-sky-500/20 text-sky-300 text-[10px] px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                      {pgArr(s.vision_palette).slice(0, 2).map(t => (
                        <span key={'pal-' + t} className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Export */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Export</h2>
          <p className="text-white/25 text-xs mb-4">Download enriched catalog data for handoff to product or data teams.</p>
          <div className="flex gap-2 flex-wrap">
            <a
              href="/api/catalog/export?format=csv"
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60 hover:bg-white/10 hover:text-white/80 transition-colors"
              download
            >
              Full catalog (CSV)
            </a>
            <a
              href="/api/catalog/export?format=csv&onlyEnriched=true"
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60 hover:bg-white/10 hover:text-white/80 transition-colors"
              download
            >
              Enriched only (CSV)
            </a>
            <a
              href="/api/catalog/export?format=json"
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60 hover:bg-white/10 hover:text-white/80 transition-colors"
              download
            >
              JSON
            </a>
          </div>
        </div>

        {/* CSV Upload */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Upload Catalog CSV</h2>
          <p className="text-white/25 text-xs mb-4">Loads into the legacy curation tool. Parsed and compressed in your browser.</p>

          <div
            className="border border-dashed border-white/10 rounded-lg p-8 text-center cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-colors"
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          >
            {uploading ? (
              <p className="text-violet-400 text-sm">{uploadProgress || 'Processing...'}</p>
            ) : (
              <>
                <p className="text-white/40 text-sm">Click to select listing_records.csv</p>
                <p className="text-white/20 text-xs mt-1">Compressed before upload — any size works</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />

          {uploadError && (
            <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs">{uploadError}</div>
          )}
          {uploadSuccess && (
            <div className="mt-3 bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-green-400 text-xs">✓ {uploadSuccess}</div>
          )}
        </div>

      </div>

      {/* Footer */}
      <div className="border-t border-white/5 px-6 py-4 text-center text-white/15 text-xs">
        Society6 Enrichment Service · Internal Use Only
      </div>
    </div>
  );
}
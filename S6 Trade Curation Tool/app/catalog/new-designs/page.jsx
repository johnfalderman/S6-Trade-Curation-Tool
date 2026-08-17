'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

// ── helpers ───────────────────────────────────────────────────

function loadScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

const NUM_TAIL = /[-_](?:v)?\d+$/;
function designKey(handle, slugs) {
  let h = handle.trim().toLowerCase().replace(NUM_TAIL, '');
  for (const slug of slugs) {
    for (const sep of ['_', '-']) {
      if (h.endsWith(sep + slug)) return h.slice(0, -(sep.length + slug.length));
    }
  }
  return h;
}

// representative-image priority — verbatim from build_new_import.py
const PRIO = {
  'Art Print': 0, 'Poster': 1, 'Mini Art Print': 2, 'Canvas Print': 3, 'Metal Print': 4,
  'Framed Art Print': 5, 'Framed Canvas Print': 6, 'Framed Poster': 7, 'Foil Art Print': 8,
  'Wood Wall Art': 9, 'Wall Tapestry': 10, 'Wall Mural': 11, 'Wall Hanging': 12, 'Wallpaper': 13,
};
const JUNK = new Set([
  'sample-artwork', 'sample-artwork-framed-canvas', 'society6-digital',
  'flowers-in-tangerine_recessed-framed-print',
]);

function fmtCost(n) {
  const num = parseFloat(n) || 0;
  return num < 0.01 ? `$${num.toFixed(4)}` : `$${num.toFixed(2)}`;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── main ──────────────────────────────────────────────────────

function NewDesignsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const uploadId = parseInt(searchParams.get('upload'), 10) || null;

  const [state, setState] = useState(null);
  const [stateError, setStateError] = useState('');
  const [settingUp, setSettingUp] = useState(false);

  // step 1
  const fileRef = useRef();
  const [scan, setScan] = useState(null);        // parse result summary
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const payloadRef = useRef(null);               // { designs, pages, unknownTypes, filename }

  // step 2
  const [typesData, setTypesData] = useState(null);
  const [showAllTypes, setShowAllTypes] = useState(false);

  // step 3
  const [generating, setGenerating] = useState(false);
  const [genStats, setGenStats] = useState(null);
  const [genError, setGenError] = useState('');
  const stopRef = useRef(false);

  // step 4
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [editing, setEditing] = useState(null);  // {id, artwork, context, meta}

  // step 5
  const [exportCounts, setExportCounts] = useState(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/new-designs/state' + (uploadId ? `?uploadId=${uploadId}` : ''));
      const data = await res.json();
      if (data.error) setStateError(data.error);
      else { setState(data); setStateError(''); }
    } catch (e) { setStateError(e.message); }
  }, [uploadId]);

  const loadTypes = useCallback(async () => {
    if (!uploadId) return;
    try {
      const res = await fetch(`/api/new-designs/types?uploadId=${uploadId}`);
      setTypesData(await res.json());
    } catch {}
  }, [uploadId]);

  const loadReview = useCallback(async (offset = 0) => {
    if (!uploadId) return;
    setReviewLoading(true);
    try {
      const res = await fetch(`/api/new-designs/review?uploadId=${uploadId}&limit=24&offset=${offset}`);
      const data = await res.json();
      setReviewItems(prev => offset === 0 ? (data.items || []) : [...prev, ...(data.items || [])]);
      setReviewOffset(offset + (data.items?.length || 0));
    } catch {}
    setReviewLoading(false);
  }, [uploadId]);

  const loadExportCounts = useCallback(async () => {
    if (!uploadId) return;
    try {
      const res = await fetch(`/api/new-designs/export?uploadId=${uploadId}&counts=1`);
      setExportCounts(await res.json());
    } catch {}
  }, [uploadId]);

  useEffect(() => { loadState(); loadTypes(); }, [loadState, loadTypes]);
  useEffect(() => {
    if (uploadId && state?.progress && state.progress.described > 0) loadExportCounts();
  }, [uploadId, state?.progress?.described]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSetup() {
    setSettingUp(true);
    try { await postJSON('/api/new-designs/setup', {}); await loadState(); }
    catch (e) { setStateError(e.message); }
    setSettingUp(false);
  }

  // ── step 1: parse + diff the export in the browser ──────────

  async function handleFile(file) {
    if (!file) return;
    setUploadError(''); setScan(null); setScanning(true);
    setScanProgress('Loading parser…');
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', 'Papa');
      setScanProgress('Fetching known designs from the database…');
      const kk = await (await fetch('/api/new-designs/known-keys')).json();
      if (kk.needsSetup) throw new Error('Database not set up yet — click "Set up database" above first.');
      if (kk.error) throw new Error(kk.error);
      const haveCopy = new Set(kk.haveCopy);
      const inDbExtra = new Set(kk.inDbExtra);
      const slugs = kk.slugs;
      const typeInfo = kk.types;

      // column indexes resolved from the header row
      let cols = null;
      const stats = { rows: 0, active: 0 };
      const allKeys = new Set();
      const newDesigns = new Map();   // key -> {prio, rep fields}
      const newPages = new Map();     // handle -> page row
      const unknownTypes = new Map(); // type -> page count

      await new Promise((resolve, reject) => {
        window.Papa.parse(file, {
          header: false,
          skipEmptyLines: true,
          chunk: (results) => {
            for (const row of results.data) {
              if (!cols) {
                const norm = row.map(h => String(h).replace(/^﻿/, '').trim().toLowerCase());
                cols = {
                  id: norm.indexOf('id'),
                  handle: norm.indexOf('handle'),
                  type: norm.indexOf('type'),
                  status: norm.indexOf('status'),
                  title: norm.indexOf('title'),
                  vendor: norm.indexOf('vendor'),
                  image: norm.findIndex(h => h.startsWith('image src') || h === 'image' || h.startsWith('image (')),
                  url: norm.indexOf('url'),
                };
                if (cols.image === -1) cols.image = norm.findIndex(h => h.includes('image'));
                if (cols.handle === -1 || cols.type === -1) {
                  reject(new Error('This does not look like a Matrixify product export — missing Handle/Type columns. Columns found: ' + norm.slice(0, 10).join(', ')));
                  return;
                }
                continue;
              }
              stats.rows++;
              const handle = (row[cols.handle] || '').trim();
              const ptype = (row[cols.type] || '').trim();
              if (!handle || !ptype) continue;
              const status = cols.status !== -1 ? (row[cols.status] || '').trim().toLowerCase() : 'active';
              if (status !== 'active') continue;
              stats.active++;

              const key = designKey(handle, slugs);
              if (JUNK.has(key)) continue;
              allKeys.add(key);

              const isNewToDb = !haveCopy.has(key) && !inDbExtra.has(key);
              const needsPages = !haveCopy.has(key); // new OR imported-but-unfinished

              if (needsPages && !newPages.has(handle)) {
                newPages.set(handle, {
                  page_id: cols.id !== -1 ? (row[cols.id] || '').trim() : '',
                  handle,
                  product_type: ptype,
                  design_key: key,
                  url: cols.url !== -1 ? (row[cols.url] || '').trim() : '',
                  image_url: cols.image !== -1 ? (row[cols.image] || '').trim() : '',
                });
                if (ptype !== 'Foil Art Print' && !typeInfo[ptype]) {
                  unknownTypes.set(ptype, (unknownTypes.get(ptype) || 0) + 1);
                }
              }

              if (isNewToDb) {
                const prio = PRIO[ptype] ?? 999;
                const cur = newDesigns.get(key);
                const img = cols.image !== -1 ? (row[cols.image] || '').trim() : '';
                if (!cur || (prio < cur.prio && img)) {
                  newDesigns.set(key, {
                    prio,
                    design_key: key,
                    s6_product_id: cols.id !== -1 ? (row[cols.id] || '').trim() : '',
                    title: cols.title !== -1 ? (row[cols.title] || '').trim() : '',
                    image_url: img || (cur ? cur.image_url : ''),
                    artist_name: cols.vendor !== -1 ? (row[cols.vendor] || '').trim() : '',
                    product_type: ptype,
                    handle,
                  });
                }
              }
            }
            setScanProgress(`Scanning… ${stats.rows.toLocaleString()} rows, ${newDesigns.size.toLocaleString()} new designs so far`);
          },
          complete: resolve,
          error: reject,
        });
      });

      const designs = [...newDesigns.values()].map(({ prio, ...d }) => d);
      const pages = [...newPages.values()];
      const noImage = designs.filter(d => !d.image_url).length;
      const flatCount = designs.filter(d => typeInfo[d.product_type]?.flat).length;
      const foilOnly = designs.filter(d => d.product_type === 'Foil Art Print').length;
      payloadRef.current = {
        designs, pages,
        unknownTypes: [...unknownTypes.entries()].map(([type, n]) => ({ type, pages: n })),
        filename: file.name,
      };
      setScan({
        rows: stats.rows, active: stats.active,
        uniqueDesigns: allKeys.size,
        alreadyEnriched: allKeys.size - designs.length - [...allKeys].filter(k => inDbExtra.has(k)).length,
        pendingFromBefore: [...allKeys].filter(k => inDbExtra.has(k)).length,
        newDesigns: designs.length,
        flat: flatCount, mockup: designs.length - flatCount, noImage,
        foilOnly,
        pages: pages.length,
        unknownTypes: payloadRef.current.unknownTypes,
      });
    } catch (e) {
      setUploadError(e.message);
    }
    setScanning(false); setScanProgress('');
  }

  async function runImport() {
    const payload = payloadRef.current;
    if (!payload) return;
    setImporting(true); setUploadError('');
    try {
      const { uploadId: newId } = await postJSON('/api/new-designs/upload', {
        action: 'begin', label: `Upload ${new Date().toLocaleDateString()}`, filename: payload.filename,
      });
      const D = 600;
      for (let i = 0; i < payload.designs.length; i += D) {
        setImportProgress(`Importing designs… ${Math.min(i + D, payload.designs.length)}/${payload.designs.length}`);
        await postJSON('/api/new-designs/upload', { action: 'designs', uploadId: newId, rows: payload.designs.slice(i, i + D) });
      }
      const P = 1500;
      for (let i = 0; i < payload.pages.length; i += P) {
        setImportProgress(`Registering pages… ${Math.min(i + P, payload.pages.length)}/${payload.pages.length}`);
        await postJSON('/api/new-designs/upload', { action: 'pages', uploadId: newId, rows: payload.pages.slice(i, i + P) });
      }
      await postJSON('/api/new-designs/upload', {
        action: 'finish', uploadId: newId,
        totalDesigns: payload.designs.length, totalPages: payload.pages.length,
        unknownTypes: payload.unknownTypes,
      });
      router.replace(`/catalog/new-designs?upload=${newId}`);
    } catch (e) {
      setUploadError('Import failed: ' + e.message + ' — safe to retry, nothing is duplicated.');
    }
    setImporting(false); setImportProgress('');
  }

  // ── step 3: generation loop ──────────────────────────────────

  async function runGenerate(retryFailed = false) {
    if (!uploadId) return;
    setGenerating(true); setGenError(''); stopRef.current = false;
    setGenStats(prev => prev || { succeeded: 0, failed: 0, costUsd: 0, failures: [] });
    try {
      let first = true;
      while (!stopRef.current) {
        const data = await postJSON('/api/new-designs/describe', {
          uploadId, retryFailed: retryFailed && first,
        });
        first = false;
        setGenStats(prev => ({
          succeeded: (prev?.succeeded || 0) + (data.succeeded || 0),
          failed: (prev?.failed || 0) + (data.failed || 0),
          costUsd: (prev?.costUsd || 0) + (data.costUsd || 0),
          failures: [...(prev?.failures || []), ...(data.failures || [])].slice(-8),
        }));
        await loadState();
        if ((data.succeeded || 0) + (data.failed || 0) === 0 && data.remaining === 0) break;
        if (data.remaining === 0) break;
        await new Promise(r => setTimeout(r, 250));
      }
      loadReview(0);
      loadExportCounts();
    } catch (e) {
      setGenError(e.message);
    }
    setGenerating(false);
  }

  // ── step 4 actions ───────────────────────────────────────────

  async function regenerate(id) {
    await postJSON('/api/new-designs/review', { id, action: 'regenerate' });
    setReviewItems(items => items.map(it => it.id === id ? { ...it, status: 'pending' } : it));
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await postJSON('/api/new-designs/review', { id: editing.id, action: 'save', ...editing });
      setEditing(null);
      loadReview(0);
    } catch (e) { alert('Save failed: ' + e.message); }
  }

  // ── render ───────────────────────────────────────────────────

  const prog = state?.progress;
  const total = prog?.total || 0;
  const pct = total > 0 ? Math.round((prog.described / total) * 100) : 0;
  const missingTypes = typesData?.missing || [];

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white font-mono">
      <div className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-white/40 text-xs hover:text-white/70 transition-colors">← curation tool</Link>
        <div className="flex items-center gap-4">
          <Link href="/catalog" className="text-white/25 text-xs hover:text-white/60 transition-colors">legacy enrichment →</Link>
          <span className="text-white/20 text-xs tracking-widest uppercase">new designs</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Designs</h1>
          <p className="text-white/40 text-sm mt-1">
            Upload a full catalog export → new artwork gets copy → download the Matrixify import.
          </p>
        </div>

        {stateError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{stateError}</div>
        )}

        {state?.needsSetup && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
            <p className="text-amber-300 text-sm mb-3">One-time setup: create the tables and load the approved product-format sentences.</p>
            <button onClick={runSetup} disabled={settingUp}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-500 disabled:opacity-40">
              {settingUp ? 'Setting up…' : 'Set up database'}
            </button>
          </div>
        )}

        {/* STEP 1 — upload + diff */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Step 1 · Upload catalog export</h2>
          <p className="text-white/25 text-xs mb-4">
            Full Matrixify product export (ID, Handle, Title, Vendor, Type, Status, Image Src).
            The file is read in your browser — only the new designs are sent to the database.
          </p>
          <div
            className="border border-dashed border-white/10 rounded-lg p-8 text-center cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-colors"
            onClick={() => !scanning && fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          >
            {scanning
              ? <p className="text-violet-400 text-sm">{scanProgress || 'Scanning…'}</p>
              : <p className="text-white/40 text-sm">Click to select the export CSV (unzip it first)</p>}
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />

          {uploadError && <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs">{uploadError}</div>}

          {scan && (
            <div className="mt-4 bg-white/[0.03] border border-white/10 rounded-lg p-4 text-xs space-y-1">
              <div className="text-white/60">Scanned {scan.rows.toLocaleString()} rows · {scan.uniqueDesigns.toLocaleString()} unique designs</div>
              <div className="text-green-400">{scan.newDesigns.toLocaleString()} NEW designs need copy ({scan.flat} flat art · {scan.mockup} mockup-only{scan.noImage ? ` · ${scan.noImage} missing an image` : ''})</div>
              {scan.pendingFromBefore > 0 && <div className="text-amber-400">{scan.pendingFromBefore.toLocaleString()} designs were imported earlier but never finished — they’ll be included</div>}
              {scan.foilOnly > 0 && (
                <div className="text-white/40">{scan.foilOnly.toLocaleString()} of these only exist as Foil Art Print — always excluded from publishing, so an export with few or zero pages is normal</div>
              )}
              <div className="text-white/40">{scan.pages.toLocaleString()} product pages will get stamped</div>
              {scan.unknownTypes.length > 0 && (
                <div className="text-amber-400">
                  {scan.unknownTypes.length} product type{scan.unknownTypes.length > 1 ? 's' : ''} ha{scan.unknownTypes.length > 1 ? 've' : 's'} no format sentence yet: {scan.unknownTypes.map(u => `${u.type} (${u.pages})`).join(', ')} — you’ll add one in Step 2
                </div>
              )}
              <div className="pt-2">
                <button onClick={runImport} disabled={importing || scan.newDesigns + scan.pages === 0}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-500 disabled:opacity-30">
                  {importing ? (importProgress || 'Importing…') : `Import ${scan.newDesigns.toLocaleString()} designs`}
                </button>
              </div>
            </div>
          )}

          {state?.uploads?.length > 0 && !scan && (
            <div className="mt-4 text-xs text-white/30">
              Recent uploads:{' '}
              {state.uploads.map(u => (
                <Link key={u.id} href={`/catalog/new-designs?upload=${u.id}`}
                  className={`mr-3 underline hover:text-white/60 ${u.id === uploadId ? 'text-violet-400' : ''}`}>
                  #{u.id} ({u.total_designs} designs)
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* STEP 2 — format sentences */}
        {uploadId && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Step 2 · Product-format sentences</h2>
            <p className="text-white/25 text-xs mb-4">
              {state?.formatTypes || 0} product types have an approved sentence. Existing sentences are approved and final —
              only a brand-new product type needs one written here.
            </p>
            {missingTypes.length === 0 ? (
              <p className="text-green-400 text-xs">✓ Every product type in this upload has an approved sentence.</p>
            ) : missingTypes.map(m => <NewTypeForm key={m.type} type={m.type} pages={m.pages} onSaved={() => { loadTypes(); loadExportCounts(); }} />)}
            <button onClick={() => setShowAllTypes(v => !v)} className="mt-3 text-xs text-white/30 underline hover:text-white/60">
              {showAllTypes ? 'hide' : 'view / edit'} all approved sentences{typesData?.sentences ? ` (${typesData.sentences.length})` : ''}
            </button>
            {showAllTypes && typesData?.sentences && (
              <SentenceBrowser sentences={typesData.sentences} onSaved={loadTypes} />
            )}
          </div>
        )}

        {/* STEP 3 — generate */}
        {uploadId && prog && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-4">Step 3 · Generate copy</h2>
            <div className="flex items-baseline justify-between mb-2 text-xs text-white/40">
              <span>{prog.described.toLocaleString()} of {total.toLocaleString()} designs have copy</span>
              <span className="text-white/60 font-bold">{pct}%</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-violet-500 transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {generating ? (
                <button onClick={() => { stopRef.current = true; }}
                  className="px-4 py-2 bg-white/10 text-white/70 rounded-lg text-sm hover:bg-white/20">Pause</button>
              ) : (
                <>
                  <button onClick={() => runGenerate(false)} disabled={prog.pending === 0}
                    className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-500 disabled:opacity-30">
                    {prog.pending === 0 ? 'Nothing pending' : `Generate (${prog.pending.toLocaleString()} pending)`}
                  </button>
                  {prog.failed > 0 && (
                    <button onClick={() => runGenerate(true)}
                      className="px-4 py-2 bg-white/10 text-red-300 rounded-lg text-sm hover:bg-white/20">
                      Retry {prog.failed} failed
                    </button>
                  )}
                </>
              )}
              {genStats && (
                <span className="text-violet-400 text-xs">
                  {genStats.succeeded} written · {genStats.failed > 0 ? `${genStats.failed} failed · ` : ''}{fmtCost(genStats.costUsd)} this run
                </span>
              )}
            </div>
            {genError && <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs">{genError} — click Generate again to resume; nothing is lost.</div>}
            {genStats?.failures?.length > 0 && (
              <div className="mt-3 text-xs text-red-300/70 space-y-0.5">
                {genStats.failures.map((f, i) => <div key={i}>✗ {f.title}: {f.error}</div>)}
              </div>
            )}
            <p className="text-white/20 text-xs mt-3">Safe to pause, close the tab, or lose connection — progress is saved per design. It picks up where it left off.</p>
          </div>
        )}

        {/* STEP 4 — review */}
        {uploadId && prog && prog.described > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Step 4 · Spot-check the copy</h2>
            <p className="text-white/25 text-xs mb-4">This is exactly what will publish. Fix a word with Edit, or Regenerate and run Step 3 again.</p>
            {reviewItems.length === 0 && (
              <button onClick={() => loadReview(0)} disabled={reviewLoading}
                className="px-4 py-2 bg-white/10 rounded-lg text-sm text-white/70 hover:bg-white/20">
                {reviewLoading ? 'Loading…' : 'Load samples'}
              </button>
            )}
            <div className="space-y-3">
              {reviewItems.map(it => (
                <div key={it.id} className="border border-white/10 rounded-lg bg-white/[0.03] p-3 flex gap-3">
                  <div className="w-24 h-24 bg-white/5 shrink-0 overflow-hidden rounded">
                    {it.image_url && (
                      <img src={it.image_url.startsWith('/') ? 'https://society6.com' + it.image_url : it.image_url}
                        alt={it.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                    )}
                  </div>
                  <div className="text-xs flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white/70 font-medium truncate">{it.title} <span className="text-white/30">· {it.product_type}</span></span>
                      <span className="shrink-0 space-x-2">
                        {it.status !== 'described' && <span className="text-amber-400">{it.status}</span>}
                        <button onClick={() => setEditing({ id: it.id, artwork: it.artwork, context: it.context, meta: it.meta })} className="text-white/40 underline hover:text-white/70">edit</button>
                        <button onClick={() => regenerate(it.id)} className="text-white/40 underline hover:text-white/70">regenerate</button>
                      </span>
                    </div>
                    {it.bodyPreview
                      ? <div className="text-white/45 mt-1.5 leading-relaxed" dangerouslySetInnerHTML={{ __html: it.bodyPreview }} />
                      : <div className="text-white/25 italic mt-1.5">no copy yet</div>}
                    {it.metaPreview && (
                      <div className="text-sky-300/60 mt-1.5">meta ({it.metaPreview.length}): {it.metaPreview}</div>
                    )}
                    {it.warnings.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {it.warnings.map((w, i) => <span key={i} className="bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">{w}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {reviewItems.length > 0 && (
              <button onClick={() => loadReview(reviewOffset)} disabled={reviewLoading}
                className="mt-3 text-xs text-white/30 underline hover:text-white/60">
                {reviewLoading ? 'loading…' : 'load more'}
              </button>
            )}
          </div>
        )}

        {/* STEP 5 — export */}
        {uploadId && prog && prog.described > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-white/60 text-xs uppercase tracking-widest mb-1">Step 5 · Download the Matrixify import</h2>
            <p className="text-white/25 text-xs mb-4">
              MERGE format — it only updates Body HTML and the SEO description; every other field stays untouched.
              Import the 20-row sample in Matrixify first, check two pages on the live site, then import the full file.
            </p>
            {exportCounts?.counts && (
              <div className="text-xs text-white/40 mb-3 space-y-0.5">
                <div className="text-green-400">{exportCounts.counts.written.toLocaleString()} pages ready</div>
                {exportCounts.counts.missing_copy > 0 && <div>{exportCounts.counts.missing_copy.toLocaleString()} skipped — copy not generated yet (finish Step 3)</div>}
                {exportCounts.counts.unknown_type > 0 && <div className="text-amber-400">{exportCounts.counts.unknown_type.toLocaleString()} skipped — product type has no sentence (finish Step 2)</div>}
                {exportCounts.counts.foil > 0 && <div>{exportCounts.counts.foil.toLocaleString()} Foil Art Print pages skipped (always excluded)</div>}
                {exportCounts.counts.blank_art > 0 && <div>{exportCounts.counts.blank_art.toLocaleString()} skipped — blank artwork description</div>}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <a href={`/api/new-designs/export?uploadId=${uploadId}&sample=20`} download
                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60 hover:bg-white/10">
                Sample (20 rows) — test this first
              </a>
              <a href={`/api/new-designs/export?uploadId=${uploadId}`} download
                className="px-3 py-1.5 bg-violet-600/80 border border-violet-500/40 rounded-lg text-xs text-white hover:bg-violet-500">
                Full import CSV
              </a>
              <button onClick={loadExportCounts} className="px-3 py-1.5 text-xs text-white/30 underline hover:text-white/60">refresh counts</button>
            </div>
          </div>
        )}
      </div>

      {/* edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div className="bg-[#1a1a1a] border border-white/15 rounded-xl p-5 max-w-xl w-full space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-white/70 text-sm font-medium">Edit copy</h3>
            <label className="block text-xs text-white/40">Artwork description (2 sentences)
              <textarea value={editing.artwork} onChange={e => setEditing({ ...editing, artwork: e.target.value })}
                rows={3} className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-white/80 focus:outline-none focus:border-violet-500" />
            </label>
            <label className="block text-xs text-white/40">Context clause (lowercase, under 15 words — dropped automatically for pillows/functional items)
              <textarea value={editing.context} onChange={e => setEditing({ ...editing, context: e.target.value })}
                rows={2} className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-white/80 focus:outline-none focus:border-violet-500" />
            </label>
            <label className="block text-xs text-white/40">Meta description ({(editing.meta || '').length} chars, under 150)
              <textarea value={editing.meta} onChange={e => setEditing({ ...editing, meta: e.target.value })}
                rows={2} className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-white/80 focus:outline-none focus:border-violet-500" />
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70">cancel</button>
              <button onClick={saveEdit} className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-500">Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-white/5 px-6 py-4 text-center text-white/15 text-xs">
        Society6 New-Design Enrichment · Internal Use Only
      </div>
    </div>
  );
}

// ── approved-sentence browser (view + edit) ───────────────────

function SentenceBrowser({ sentences, onSaved }) {
  const [filter, setFilter] = useState('');
  const [editingType, setEditingType] = useState(null);
  const shown = sentences.filter(s =>
    !filter.trim() || s.product_type.toLowerCase().includes(filter.trim().toLowerCase())
  );
  return (
    <div className="mt-3">
      <p className="text-white/25 text-xs mb-2">
        Edits go live for all FUTURE exports the moment you save. Pages already published keep
        their current copy until their designs are exported and imported again.
      </p>
      <input
        value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter types…"
        className="mb-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 w-56 focus:outline-none focus:border-violet-500"
      />
      <div className="max-h-96 overflow-y-auto space-y-1 text-xs pr-1">
        {shown.map(s => (
          editingType === s.product_type ? (
            <SentenceEditor key={s.product_type} sentence={s}
              onDone={(saved) => { setEditingType(null); if (saved) onSaved(); }} />
          ) : (
            <div key={s.product_type} className="border-b border-white/5 py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <span className="text-white/60">{s.product_type}</span>
                {s.drop_context && <span className="ml-2 text-[10px] bg-white/10 text-white/40 px-1.5 py-0.5 rounded">functional</span>}
                {s.flat && <span className="ml-2 text-[10px] bg-white/10 text-white/40 px-1.5 py-0.5 rounded">flat art</span>}
                <div className="text-white/25 mt-0.5">{s.sentence}</div>
              </div>
              <button onClick={() => setEditingType(s.product_type)}
                className="text-white/30 underline hover:text-white/70 shrink-0">edit</button>
            </div>
          )
        ))}
        {shown.length === 0 && <div className="text-white/25 py-2">no types match "{filter}"</div>}
      </div>
    </div>
  );
}

function SentenceEditor({ sentence: s, onDone }) {
  const [sentence, setSentence] = useState(s.sentence);
  const [metaLabel, setMetaLabel] = useState(s.meta_label || '');
  const [dropContext, setDropContext] = useState(!!s.drop_context);
  const [flat, setFlat] = useState(!!s.flat);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    try {
      const data = await postJSON('/api/new-designs/types', {
        product_type: s.product_type, sentence, meta_label: metaLabel,
        drop_context: dropContext, flat,
      });
      setWarnings(data.warnings || []);
      if ((data.warnings || []).length === 0) onDone(true);
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div className="border border-violet-500/30 bg-violet-500/5 rounded-lg p-3 my-1">
      <div className="text-violet-300 font-medium mb-2">{s.product_type}</div>
      <textarea value={sentence} onChange={e => setSentence(e.target.value)} rows={4}
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white/80 focus:outline-none focus:border-violet-500" />
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <label className="text-white/40">meta label:{' '}
          <input value={metaLabel} onChange={e => setMetaLabel(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70 w-40 focus:outline-none" />
        </label>
        <label className="text-white/40 flex items-center gap-1.5">
          <input type="checkbox" checked={dropContext} onChange={e => setDropContext(e.target.checked)} />
          functional item
        </label>
        <label className="text-white/40 flex items-center gap-1.5">
          <input type="checkbox" checked={flat} onChange={e => setFlat(e.target.checked)} />
          flat artwork
        </label>
        <button onClick={save} disabled={saving || !sentence.trim()}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-500 disabled:opacity-30">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => onDone(warnings.length > 0)} className="text-white/40 underline hover:text-white/70">
          {warnings.length > 0 ? 'done' : 'cancel'}
        </button>
      </div>
      {warnings.length > 0 && (
        <div className="mt-2 text-amber-300">Saved, but check: {warnings.join(' · ')}</div>
      )}
      {error && <div className="mt-2 text-red-400">{error}</div>}
    </div>
  );
}

// ── new-type sentence form ────────────────────────────────────

function NewTypeForm({ type, pages, onSaved }) {
  const [sentence, setSentence] = useState('');
  const [metaLabel, setMetaLabel] = useState(type);
  const [dropContext, setDropContext] = useState(false);
  const [flat, setFlat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    try {
      const data = await postJSON('/api/new-designs/types', {
        product_type: type, sentence, meta_label: metaLabel, drop_context: dropContext, flat,
      });
      setWarnings(data.warnings || []);
      onSaved();
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div className="border border-amber-500/25 bg-amber-500/5 rounded-lg p-3 mb-3 text-xs">
      <div className="text-amber-300 font-medium mb-2">NEW TYPE: {type} <span className="text-white/30">({pages} pages waiting)</span></div>
      <textarea value={sentence} onChange={e => setSentence(e.target.value)} rows={3}
        placeholder={`Format sentence for ${type} — what it's made of, how it ships, why it beats the store-shelf version. No "designs", no em-dashes, no gorgeous/stunning/beautiful/vibrant/unique/perfect.`}
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white/80 focus:outline-none focus:border-amber-500" />
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <label className="text-white/40">meta label:{' '}
          <input value={metaLabel} onChange={e => setMetaLabel(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70 w-40 focus:outline-none" />
        </label>
        <label className="text-white/40 flex items-center gap-1.5">
          <input type="checkbox" checked={dropContext} onChange={e => setDropContext(e.target.checked)} />
          functional item (skip the room/mood clause)
        </label>
        <label className="text-white/40 flex items-center gap-1.5">
          <input type="checkbox" checked={flat} onChange={e => setFlat(e.target.checked)} />
          product photos show flat artwork
        </label>
        <button onClick={save} disabled={saving || !sentence.trim()}
          className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-500 disabled:opacity-30">
          {saving ? 'Saving…' : 'Approve sentence'}
        </button>
      </div>
      {warnings.length > 0 && (
        <div className="mt-2 text-amber-300">Saved, but check: {warnings.join(' · ')}</div>
      )}
      {error && <div className="mt-2 text-red-400">{error}</div>}
    </div>
  );
}

export default function NewDesignsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f0f0f] text-white/30 font-mono p-10 text-sm">Loading…</div>}>
      <NewDesignsInner />
    </Suspense>
  );
}

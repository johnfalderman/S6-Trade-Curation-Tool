'use client'
import { useState, useRef } from 'react'

const SAMPLE_BRIEF = `Project Name: The Savannah Grand Hotel
Project Type: Hotel
Design Style: Modern Southern, Coastal
Color Palette: Blues, Greens, Neutrals, Beige
Avoid: Anything too abstract, No dark imagery, No skulls
Rooms: Lobby, Guest Rooms, Restaurant, Bar, Hallways
Gallery Wall: Yes
Target Pieces: 80
Notes: Looking for a warm, welcoming feel that reflects Savannah's coastal charm. Should feel elevated but approachable.`

function ArtworkCard({ item, size = 'md', pinned = false, selected = true, onToggle = null, onPinToggle = null }) {
  const [imgError, setImgError] = useState(false)
  const imgSize = size === 'sm' ? 'h-32' : 'h-48'
  return (
    <div className={`card group flex flex-col relative ${pinned ? 'ring-2 ring-blue-400' : ''} ${onToggle && !selected ? 'opacity-40' : ''}`}>
      {onPinToggle && (
        <button
          onClick={e => { e.preventDefault(); onPinToggle(item.product_url) }}
          className={`absolute top-1 left-1 z-10 w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold transition-colors ${pinned ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white/90 border-gray-300 text-gray-500 hover:text-blue-500 hover:border-blue-400'}`}
          title={pinned ? 'Unpin — will be replaced on next refine' : 'Pin — keep this on next refine'}
        >{pinned ? '\u2605' : '\u2606'}</button>
      )}
      {onToggle && (
        <button
          onClick={e => { e.preventDefault(); onToggle(item.product_url) }}
          className={`absolute top-1 right-1 z-10 w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold transition-colors ${selected ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-400 text-gray-400'}`}
          title={selected ? 'Deselect from deck' : 'Add to deck'}
        >{selected ? 'x' : '+'}</button>
      )}
      {pinned && (
        <div className="bg-blue-50 text-blue-600 text-xs font-medium px-2 py-1 rounded-t-lg">[pin] Pinned — kept on refine</div>
      )}
      <div className={`bg-gray-100 overflow-hidden ${imgSize}`}>
        {item.image_url && !imgError ? (
          <img
            src={item.image_url.startsWith('/') ? 'https://society6.com' + item.image_url : item.image_url}
            alt={item.image_alt || item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs text-center px-2">
            {item.title}
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <div className="text-sm font-medium text-gray-800 leading-tight line-clamp-2">{item.title}</div>
        <div className="text-xs text-gray-400">{item.source_collection}</div>
        <div className="mt-auto pt-2">
          <a
            href={item.product_url?.startsWith('/') ? 'https://society6.com' + item.product_url : item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-red-600 hover:text-red-800 font-medium"
          >
            View on Society6 {'->'}
          </a>
        </div>
      </div>
    </div>
  )
}

function GalleryWallSet({ gwSet }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Set {gwSet.setNumber}</span>
        {gwSet.theme && <span className="text-xs text-gray-500">{gwSet.theme}</span>}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {(gwSet.items || []).map(item => (
          <ArtworkCard key={item.product_url} item={item} size="sm" />
        ))}
      </div>
    </div>
  )
}

function BriefBadge({ label, values, danger = false }) {
  if (!values || values.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 items-start">
      <span className="text-xs text-gray-500 pt-0.5 shrink-0">{label}</span>
      {values.map(v => (
        <span key={v} className={`tag ${danger ? 'bg-red-50 text-red-600 border-red-200' : ''}`}>{v}</span>
      ))}
    </div>
  )
}

export default function HomePage() {
  const [briefText, setBriefText] = useState('')
  const [moodboardUrl, setMoodboardUrl] = useState('')
  const [moodboardFile, setMoodboardFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [slidesLoading, setSlidesLoading] = useState(false)
  const [slidesResult, setSlidesResult] = useState(null)
  const [slidesError, setSlidesError] = useState(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareResult, setShareResult] = useState(null) // { url, id, itemCount }
  const [shareError, setShareError] = useState(null)
  const [activeTab, setActiveTab] = useState('primary')
  const fileInputRef = useRef(null)

  // Refine flow
  const [refineFeedback, setRefineFeedback] = useState('')
  const [refineHistory, setRefineHistory] = useState([])
  const [refineLoading, setRefineLoading] = useState(false)

  // Pinned items
  const [pinnedUrlInput, setPinnedUrlInput] = useState('')
  const [pinnedUrls, setPinnedUrls] = useState([])

  // Product type filters — controls which catalog source_collections are eligible
  // wallArtMode: 'all' | 'prints' | 'posters'  (mutually exclusive)
  // excludeWood: removes wooden wall art (wood-mounted prints, wood wall art)
  // includePillows: opts throw pillows INTO the pool (excluded by default since
  // the app has historically been wall-art-only)
  const [wallArtMode, setWallArtMode] = useState('all')
  const [excludeWood, setExcludeWood] = useState(false)
  const [includePillows, setIncludePillows] = useState(false)

  // Find Similar: freeform textarea of Society6 product URLs (one per line).
  // Works standalone (no brief needed) or as a supplement to a brief. The API
  // uses matching catalog entries as seeds, aggregates their tags, and has
  // Claude refine them into a synthetic brief for scoring.
  const [findSimilarInput, setFindSimilarInput] = useState('')
  const parseFindSimilarUrls = () =>
    findSimilarInput.split('\n').map(s => s.trim()).filter(Boolean)

  // Item selection for deck
  const [selectedItems, setSelectedItems] = useState(new Set())

  function toggleItem(url) {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  function initSelectedItems(data) {
    const urls = new Set([
      ...(data.primary || []).map(i => i.product_url),
      ...(data.accent || []).map(i => i.product_url),
      ...((data.galleryWallSets || []).flatMap(s => (s.items || []).map(i => i.product_url))),
    ])
    setSelectedItems(urls)
  }

  // Provider / deck settings
  const [providerName, setProviderName] = useState('')
  const [providerEmail, setProviderEmail] = useState('')
  const [providerPhone, setProviderPhone] = useState('')
  const [imagesPerSlide, setImagesPerSlide] = useState(8)
  // Cover slide fields — override what the brief parser extracts
  const [deckClientName, setDeckClientName] = useState('')
  const [deckProjectName, setDeckProjectName] = useState('')
  const [deckLocation, setDeckLocation] = useState('')
  const [deckDate, setDeckDate] = useState('')

  async function callRecommend({ brief, moodboardUrl, moodboardFile, refineFeedback, prevItemTitles, pinnedUrls, productFilters, findSimilarUrls }) {
    let res
    if (moodboardFile) {
      const fd = new FormData()
      fd.append('brief', brief)
      fd.append('moodboardUrl', moodboardUrl || '')
      fd.append('moodboard', moodboardFile)
      if (refineFeedback) fd.append('refineFeedback', refineFeedback)
      if (prevItemTitles?.length) fd.append('prevItemTitles', JSON.stringify(prevItemTitles))
      if (pinnedUrls?.length) fd.append('pinnedUrls', JSON.stringify(pinnedUrls))
      if (productFilters) fd.append('productFilters', JSON.stringify(productFilters))
      if (findSimilarUrls?.length) fd.append('findSimilarUrls', JSON.stringify(findSimilarUrls))
      res = await fetch('/api/recommend', { method: 'POST', body: fd })
    } else {
      res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, moodboardUrl, refineFeedback, prevItemTitles, pinnedUrls, productFilters, findSimilarUrls }),
      })
    }
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Unknown error')
    return data
  }

  async function handleGenerate(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResults(null)
    setSlidesResult(null)
    setSlidesError(null)
    setRefineHistory([])
    try {
      const productFilters = { wallArtMode, excludeWood, includePillows }
      const findSimilarUrls = parseFindSimilarUrls()
      const data = await callRecommend({ brief: briefText, moodboardUrl, moodboardFile, pinnedUrls, productFilters, findSimilarUrls })
      setResults(data)
      if (data.brief?.clientName) setDeckClientName(data.brief.clientName)
      if (data.brief?.projectName) setDeckProjectName(data.brief.projectName)
      if (data.brief?.location) setDeckLocation(data.brief.location)
      initSelectedItems(data)
      setActiveTab('primary')
      setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRefine() {
    if (!refineFeedback.trim() || !results) return
    setRefineLoading(true)
    setSlidesResult(null)
    setSlidesError(null)
    try {
      // Build pin list from local pinnedUrls + whatever the user has pin-toggled
      // on the current result set. Pinned items should be preserved; only the
      // UNPINNED slots need to be refreshed, so only their titles go into the
      // prev-items exclusion list sent to the API.
      const currentItems = [
        ...(results?.primary || []),
        ...(results?.accent || []),
      ]
      const pinnedFromCards = currentItems
        .filter(isPinned)
        .map(i => i.product_url)
        .filter(Boolean)
        .map(u => (u.startsWith('/') ? 'https://society6.com' + u : u))
      const mergedPinnedUrls = Array.from(new Set([...(pinnedUrls || []), ...pinnedFromCards]))

      const prevItemTitles = currentItems
        .filter(i => !isPinned(i))
        .map(i => i.title)
        .filter(Boolean)

      const data = await callRecommend({
        brief: briefText,
        moodboardUrl,
        moodboardFile,
        refineFeedback,
        prevItemTitles,
        pinnedUrls: mergedPinnedUrls,
        productFilters: { wallArtMode, excludeWood, includePillows },
        findSimilarUrls: parseFindSimilarUrls(),
      })
      setRefineHistory(h => [...h, refineFeedback])
      setRefineFeedback('')
      setResults(data)
      initSelectedItems(data)
      setActiveTab('primary')
    } catch (err) {
      setError(err.message)
    } finally {
      setRefineLoading(false)
    }
  }

  function handleAddPin() {
    const url = pinnedUrlInput.trim()
    if (!url) return
    if (!url.includes('society6.com')) {
      setError('Please enter a Society6 product URL.')
      return
    }
    setPinnedUrls(u => [...u, url])
    setPinnedUrlInput('')
    setError(null)
  }

  function handleRemovePin(url) {
    setPinnedUrls(u => u.filter(x => x !== url))
  }

  // Toggle a result card's pin state. Normalizes the URL so a Society6-relative
  // href and an absolute URL are treated as the same item.
  function togglePin(url) {
    if (!url) return
    const full = url.startsWith('/') ? 'https://society6.com' + url : url
    setPinnedUrls(u =>
      u.includes(full) || u.includes(url)
        ? u.filter(x => x !== full && x !== url)
        : [...u, full]
    )
  }

  // Does `item` count as pinned? True if backend marked it pinned OR its URL
  // is in the local pinnedUrls list.
  function isPinned(item) {
    if (item?.pinned) return true
    const url = item?.product_url || ''
    if (!url) return false
    const full = url.startsWith('/') ? 'https://society6.com' + url : url
    return pinnedUrls.includes(full) || pinnedUrls.includes(url)
  }

  // Bulk pin/unpin a list of items (used by "Pin all" / "Unpin all" buttons).
  function pinAll(items) {
    const urls = (items || [])
      .map(i => i?.product_url)
      .filter(Boolean)
      .map(u => (u.startsWith('/') ? 'https://society6.com' + u : u))
    setPinnedUrls(u => Array.from(new Set([...(u || []), ...urls])))
  }
  function unpinAll(items) {
    const toRemove = new Set(
      (items || [])
        .map(i => i?.product_url)
        .filter(Boolean)
        .flatMap(u => [u, u.startsWith('/') ? 'https://society6.com' + u : u])
    )
    setPinnedUrls(u => (u || []).filter(x => !toRemove.has(x)))
  }

  // Client-side CSV export. All data is already in `results` + `selectedItems`,
  // so no API round-trip is needed. The `thumbnail` column uses =IMAGE() which
  // renders thumbnails in Google Sheets; Excel shows it as text (plain image_url
  // column still works there). Prepends UTF-8 BOM so Excel opens it correctly.
  function downloadCsv() {
    if (!results) return
    const toAbsolute = (u) => {
      if (!u) return ''
      return u.startsWith('/') ? 'https://society6.com' + u : u
    }
    const rows = []
    const push = (item, placement) => {
      const productUrl = toAbsolute(item.product_url)
      const imageUrl = toAbsolute(item.image_url)
      rows.push({
        title: item.title || '',
        product_url: productUrl,
        image_url: imageUrl,
        thumbnail: imageUrl ? `=IMAGE("${imageUrl}")` : '',
        style: (item.style || []).join(', '),
        palette: (item.palette || []).join(', '),
        source_collection: item.source_collection || '',
        placement,
        reason: item.reason || '',
      })
    }
    ;(results.primary || [])
      .filter(i => selectedItems.has(i.product_url))
      .forEach(i => push(i, 'Primary'))
    ;(results.accent || [])
      .filter(i => selectedItems.has(i.product_url))
      .forEach(i => push(i, 'Accent'))
    ;(results.galleryWallSets || []).forEach(set => {
      (set.items || [])
        .filter(i => selectedItems.has(i.product_url))
        .forEach(i => push(i, `Gallery Wall #${set.setNumber}`))
    })

    if (rows.length === 0) {
      setSlidesError('Nothing selected to export. Select at least one item above.')
      return
    }

    const headers = ['title', 'product_url', 'image_url', 'thumbnail', 'style', 'palette', 'source_collection', 'placement', 'reason']
    const escape = (v) => {
      const s = String(v ?? '')
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => escape(r[h])).join(','))
    ].join('\n')

    const safeName = (deckProjectName || results.brief?.projectName || 'S6-Curation')
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'S6-Curation'
    const filename = `${safeName}-${new Date().toISOString().slice(0, 10)}.csv`

    // BOM ensures Excel reads UTF-8 titles correctly
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setSlidesError(null)
    setSlidesResult({ filename })
  }

  // Create a shareable /share/[id] URL. Stores the currently selected curation
  // in Netlify Blobs under a short random ID, copies the URL to clipboard,
  // and surfaces it for the user to share manually.
  async function handleShare() {
    if (!results) return
    setShareLoading(true)
    setShareError(null)
    setShareResult(null)
    try {
      const payload = {
        brief: {
          ...results.brief,
          ...(deckClientName && { clientName: deckClientName }),
          ...(deckProjectName && { projectName: deckProjectName }),
          ...(deckLocation && { location: deckLocation }),
        },
        primary: (results.primary || []).filter(i => selectedItems.has(i.product_url)),
        accent: (results.accent || []).filter(i => selectedItems.has(i.product_url)),
        galleryWallSets: (results.galleryWallSets || []).map(s => ({
          ...s,
          items: (s.items || []).filter(i => selectedItems.has(i.product_url)),
        })).filter(s => s.items.length > 0),
      }
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to create share')

      const shareUrl = `${window.location.origin}/share/${data.id}`
      try {
        await navigator.clipboard.writeText(shareUrl)
      } catch {
        // Clipboard API may be blocked (http contexts, permissions). Fall back
        // silently; the user can still copy the URL from the displayed input.
      }
      setShareResult({ url: shareUrl, id: data.id, itemCount: data.itemCount })
    } catch (err) {
      setShareError(err.message)
    } finally {
      setShareLoading(false)
    }
  }

  async function handleGenerateSlides() {
    if (!results) return
    setSlidesLoading(true)
    setSlidesResult(null)
    setSlidesError(null)
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: {
            ...results.brief,
            ...(deckClientName && { clientName: deckClientName }),
            ...(deckProjectName && { projectName: deckProjectName }),
            ...(deckLocation && { location: deckLocation }),
            ...(deckDate && { date: deckDate }),
          },
          primary: (results.primary || []).filter(i => selectedItems.has(i.product_url)),
          accent: (results.accent || []).filter(i => selectedItems.has(i.product_url)),
          galleryWallSets: (results.galleryWallSets || []).map(s => ({
            ...s, items: (s.items || []).filter(i => selectedItems.has(i.product_url))
          })).filter(s => s.items.length > 0),
          providerInfo: { name: providerName, email: providerEmail, phone: providerPhone },
          imagesPerSlide,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Unknown error')
      const bytes = Uint8Array.from(atob(data.pptxBase64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = data.filename || 'S6-Curation.pptx'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      setSlidesResult({ filename: data.filename })
    } catch (err) {
      setSlidesError(err.message)
    } finally {
      setSlidesLoading(false)
    }
  }

  function handleUseSample() { setBriefText(SAMPLE_BRIEF) }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file && file.type === 'application/pdf') {
      setMoodboardFile(file)
    } else if (file) {
      setError('Please upload a PDF file.')
      e.target.value = ''
    }
  }

  function handleFileClear() {
    setMoodboardFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const brief = results?.brief
  const tabCounts = {
    primary: results?.primary?.length || 0,
    accent: results?.accent?.length || 0,
    gallery: results?.galleryWallSets?.length || 0,
  }

  return (
    <div className="max-w-4xl mx-auto">

      {/* -- Intake Form -- */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">New Curation Request</h1>
        <p className="text-gray-500 text-sm mb-6">Paste a Jotform brief, paste Society6 URLs to find similar items, or combine both.</p>

        <form onSubmit={handleGenerate} className="space-y-4">

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Jotform Submission Text
                {parseFindSimilarUrls().length > 0 && <span className="text-gray-400 font-normal"> (optional when using Find Similar)</span>}
              </label>
              <button type="button" onClick={handleUseSample} className="text-xs text-gray-400 hover:text-gray-600 underline">
                Load sample brief
              </button>
            </div>
            <textarea
              value={briefText}
              onChange={e => setBriefText(e.target.value)}
              placeholder="Paste the full Jotform response here..."
              rows={10}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Moodboard URL <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={moodboardUrl}
              onChange={e => setMoodboardUrl(e.target.value)}
              placeholder="https://www.pinterest.com/..."
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Moodboard PDF <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            {moodboardFile ? (
              <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
                <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm text-gray-700 flex-1 truncate">{moodboardFile.name}</span>
                <span className="text-xs text-gray-400">{(moodboardFile.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={handleFileClear} className="text-xs text-gray-400 hover:text-red-500 underline shrink-0">Remove</button>
              </div>
            ) : (
              <label className="flex items-center gap-3 border border-dashed border-gray-300 rounded-lg p-4 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-sm text-gray-500">Click to upload a moodboard PDF</span>
                <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={handleFileChange} className="hidden" />
              </label>
            )}
          </div>

          {/* Pinned items */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Pin Specific Items <span className="text-gray-400 font-normal">(optional -- paste Society6 product URLs to force-include)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={pinnedUrlInput}
                onChange={e => setPinnedUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddPin())}
                placeholder="https://society6.com/products/..."
                className="flex-1 border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <button type="button" onClick={handleAddPin} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                Add
              </button>
            </div>
            <p className="text-xs text-amber-600 mt-2">⚠ After pinning a URL, click <strong>Generate Recommendations</strong> again — pinned items are included in the next run.</p>
            {pinnedUrls.length > 0 && (
              <div className="mt-2 space-y-1">
                {pinnedUrls.map(url => (
                  <div key={url} className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                    <span className="text-blue-500">[pin]</span>
                    <span className="flex-1 truncate">{url}</span>
                    <button type="button" onClick={() => handleRemovePin(url)} className="text-gray-400 hover:text-red-500">x</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Find Similar — seed by product URLs */}
          <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium text-gray-800">Find Similar <span className="text-xs font-normal text-purple-600">(beta)</span></div>
              {parseFindSimilarUrls().length > 0 && (
                <span className="text-xs text-purple-700 bg-white border border-purple-300 rounded px-2 py-0.5">
                  {parseFindSimilarUrls().length} URL{parseFindSimilarUrls().length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 mb-2">
              Paste Society6 product URLs (one per line) to find artwork with a similar aesthetic. Works on its own or combined with a brief. Pasted products are included in the results.
            </p>
            <textarea
              value={findSimilarInput}
              onChange={e => setFindSimilarInput(e.target.value)}
              placeholder={'https://society6.com/product/your-seed-product-1\nhttps://society6.com/product/your-seed-product-2'}
              rows={3}
              className="w-full border border-purple-200 rounded-lg p-2.5 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white"
            />
          </div>

          {/* Product type filters */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="text-sm font-medium text-gray-700 mb-1">Product Types</div>
            <p className="text-xs text-gray-500 mb-3">Filter which Society6 product categories are eligible for recommendations.</p>

            {/* Diagnostics: warn when a filter is enabled but the catalog has zero matching items */}
            {results?.catalogBreakdown && (() => {
              const b = results.catalogBreakdown
              const hints = []
              if (includePillows && b.pillow === 0) hints.push('No throw pillows found in the current catalog — the filter has no effect until pillow rows are added.')
              if (wallArtMode === 'posters' && b.poster === 0) hints.push('No posters found in the current catalog. Switch to All wall art or add poster rows.')
              if (wallArtMode === 'prints' && b.wallPrint === 0) hints.push('No standard wall prints found in the current catalog. Switch to All wall art or add print rows.')
              if (hints.length === 0) return null
              return (
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800 space-y-1">
                  {hints.map((h, i) => <div key={i}>! {h}</div>)}
                  <div className="text-amber-600 text-[11px] pt-1">
                    Catalog breakdown: {b.wallPrint} wall prints · {b.poster} posters · {b.canvas} canvas · {b.wood} wood · {b.pillow} pillows · {b.otherWallArt + b.metal + b.acrylic + b.other} other
                  </div>
                </div>
              )
            })()}

            <div className="mb-3">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Wall art format</div>
              <div className="flex flex-wrap gap-4">
                {[
                  { value: 'all', label: 'All wall art' },
                  { value: 'prints', label: 'Wall prints only' },
                  { value: 'posters', label: 'Posters only' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="wallArtMode"
                      value={opt.value}
                      checked={wallArtMode === opt.value}
                      onChange={() => setWallArtMode(opt.value)}
                      className="accent-gray-900"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">&quot;Wall prints&quot; = standard / framed / mini art prints. Mutually exclusive with Posters.</p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-gray-200">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeWood}
                  onChange={e => setExcludeWood(e.target.checked)}
                  className="accent-gray-900"
                />
                Exclude wooden wall art
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePillows}
                  onChange={e => setIncludePillows(e.target.checked)}
                  className="accent-gray-900"
                />
                Include throw pillows
              </label>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading || (!briefText.trim() && parseFindSimilarUrls().length === 0)}
              className="btn-primary"
            >
              {loading
                ? 'Generating...'
                : (!briefText.trim() && parseFindSimilarUrls().length > 0)
                  ? 'Find Similar Items'
                  : 'Generate Recommendations'}
            </button>
            {results && (
              <span className="text-sm text-gray-500">
                {results.totalScored} items scored * catalog of {results.catalogSize}
              </span>
            )}
          </div>

        </form>
      </div>

      {/* -- Results -- */}
      {results && (
        <div id="results-section" className="space-y-8">

          {/* Parsed brief summary */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-header mb-0">Parsed Brief</h2>
              {brief.parsedBy === 'claude' && (
                <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">AI-parsed</span>
              )}
              {brief.parsedBy === 'find-similar-vision' && (
                <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">Vision-analyzed</span>
              )}
              {brief.parsedBy === 'find-similar-claude' && (
                <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">Text-analyzed</span>
              )}
            </div>
            {refineHistory.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {refineHistory.map((r, i) => (
                  <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
                    Refined: "{r}"
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-base font-semibold text-gray-900">{brief.projectName || '--'}</div>
                <div className="text-sm text-gray-500 capitalize">{brief.projectType?.replace('_', ' ')}</div>
                {brief.keyThemes?.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1 italic">"{brief.keyThemes.join(' * ')}"</div>
                )}
              </div>
              <div className="space-y-2">
                <BriefBadge label="Style" values={brief.styleTags} />
                <BriefBadge label="Palette" values={brief.paletteTags} />
                {brief.avoidTags?.length > 0 && <BriefBadge label="Avoid" values={brief.avoidTags} danger />}
                {brief.rooms?.length > 0 && <BriefBadge label="Spaces" values={brief.rooms} />}
              </div>
            </div>
            <div className="flex gap-4 text-sm text-gray-500 mt-3">
     0        {brief.galleryWall && <span>OK Gallery wall requested</span>}
              {brief.pieceCount && <span>Target: {brief.pieceCount} pieces</span>}
            </div>
            {brief.moodboardNote && (
              <div className="mt-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                [pdf] {brief.moodboardNote}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div>
            <div className="flex border-b border-gray-200 mb-6 gap-1">
              {[
                { key: 'primary', label: 'Primary Collection', count: tabCounts.primary },
                { key: 'accent', label: 'Accent & Alternates', count: tabCounts.accent },
                brief.galleryWall && { key: 'gallery', label: 'Gallery Wall Sets', count: tabCounts.gallery },
              ].filter(Boolean).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    activeTab === tab.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label} <span className="ml-1.5 text-xs text-gray-400">{tab.count}</span>
                </button>
              ))}
            </div>

            {activeTab === 'primary' && (
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <p className="text-sm text-gray-500">Top {results.primary.length} pieces. Click x to remove from deck.</p>
                  <div className="flex gap-3 items-center">
                    <button onClick={() => pinAll(results.primary)} className="text-xs text-blue-600 hover:text-blue-800 underline">Pin all</button>
                    <button onClick={() => unpinAll(results.primary)} className="text-xs text-blue-600 hover:text-blue-800 underline">Unpin all</button>
                    <span className="text-gray-300">|</span>
                    <button onClick={() => setSelectedItems(prev => { const n = new Set(prev); results.primary.forEach(i => n.add(i.product_url)); return n })} className="text-xs text-gray-500 hover:text-gray-800 underline">Select all</button>
                    <button onClick={() => setSelectedItems(prev => { const n = new Set(prev); results.primary.forEach(i => n.delete(i.product_url)); return n })} className="text-xs text-gray-500 hover:text-gray-800 underline">Deselect all</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {results.primary.map(item => (
                    <ArtworkCard key={item.product_url} item={item} pinned={isPinned(item)} selected={selectedItems.has(item.product_url)} onToggle={toggleItem} onPinToggle={togglePin} />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'accent' && (
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <p className="text-sm text-gray-500">Accent pieces and alternates. Click x to remove from deck.</p>
                  <div className="flex gap-3 items-center">
                    <button onClick={() => pinAll(results.accent)} className="text-xs text-blue-600 hover:text-blue-800 underline">Pin all</button>
                    <button onClick={() => unpinAll(results.accent)} className="text-xs text-blue-600 hover:text-blue-800 underline">Unpin all</button>
                    <span className="text-gray-300">|</span>
                    <button onClick={() => setSelectedItems(prev => { const n = new Set(prev); results.accent.forEach(i => n.add(i.product_url)); return n })} className="text-xs text-gray-500 hover:text-gray-800 underline">Select all</button>
                    <button onClick={() => setSelectedItems(prev => { const n = new Set(prev); results.accent.forEach(i => n.delete(i.product_url)); return n })} className="text-xs text-gray-500 hover:text-gray-800 underline">Deselect all</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {results.accent.map(item => (
                    <ArtworkCard key={item.product_url} item={item} pinned={isPinned(item)} selected={selectedItems.has(item.product_url)} onToggle={toggleItem} onPinToggle={togglePin} />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'gallery' && (
              <div>
                <p className="text-sm text-gray-500 mb-4">Curated gallery wall sets.</p>
                <div className="space-y-6">
                  {results.galleryWallSets.map(gwSet => (
                    <GalleryWallSet key={gwSet.setNumber} gwSet={gwSet} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* -- Refine results -- */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Refine These Results</h3>
            <p className="text-xs text-gray-500 mb-1">
              Tell Claude what to adjust -- e.g. "more jazz and vintage, fewer landscapes" or "go darker, nothing with warm colors"
            </p>
            <p className="text-xs text-blue-600 mb-3">
              Tip: click the star on any card to pin it. Pinned items are kept; only unpinned slots get refreshed.
              {(() => {
                const count = [...(results?.primary || []), ...(results?.accent || [])].filter(isPinned).length
                return count > 0 ? ` (${count} pinned)` : ''
              })()}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={refineFeedback}
                onChange={e => setRefineFeedback(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRefine()}
                placeholder="What would you like to change about these results?"
                className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <button
                onClick={handleRefine}
                disabled={refineLoading || !refineFeedback.trim()}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40"
              >
                {refineLoading ? 'Refining...' : 'Apply'}
              </button>
            </div>
          </div>

          {/* Generate Deck */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-gray-900">Generate PowerPoint Deck</div>
              <span className="text-xs text-gray-500">{selectedItems.size} items selected for deck</span>
            </div>
            <p className="text-sm text-gray-500 mb-4">Downloads a .pptx file. Deselect individual items above to exclude them.</p>

            {/* Cover slide info */}
            <div className="mb-5 p-4 bg-white border border-gray-200 rounded-lg">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Cover Slide Info</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client / Company Name</label>
                  <input type="text" value={deckClientName} onChange={e => setDeckClientName(e.target.value)} placeholder="e.g. The Roosevelt Hotel" className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Project Name</label>
                  <input type="text" value={deckProjectName} onChange={e => setDeckProjectName(e.target.value)} placeholder="e.g. Lobby Renovation" className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                  <input type="text" value={deckLocation} onChange={e => setDeckLocation(e.target.value)} placeholder="e.g. Nashville, TN" className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="text" value={deckDate} onChange={e => setDeckDate(e.target.value)} placeholder="e.g. April 2026" className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
                </div>
              </div>
            </div>
            {/* Provider info */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Your Name</label>
                <input
                  type="text"
                  value={providerName}
                  onChange={e => setProviderName(e.target.value)}
                  placeholder="e.g. Sarah Chen"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={providerEmail}
                  onChange={e => setProviderEmail(e.target.value)}
                  placeholder="e.g. sarah@society6.com"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={providerPhone}
                  onChange={e => setProviderPhone(e.target.value)}
                  placeholder="e.g. 555-867-5309"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
            </div>

            {/* Images per slide + button */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600">Images per slide:</label>
                <select
                  value={imagesPerSlide}
                  onChange={e => setImagesPerSlide(Number(e.target.value))}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {[4, 8, 12].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <button onClick={handleGenerateSlides} disabled={slidesLoading} className="btn-accent">
                {slidesLoading ? 'Building deck...' : 'Generate Slides Deck'}
              </button>
              <button onClick={downloadCsv} className="btn-secondary" title="Download CSV of selected items. Open in Google Sheets for thumbnail previews (=IMAGE formula). Excel will show image URLs as text links.">
                Download CSV
              </button>
              <button onClick={handleShare} disabled={shareLoading} className="btn-secondary" title="Create a shareable link to these curated results.">
                {shareLoading ? 'Creating link...' : 'Share Results'}
              </button>
            </div>

            {slidesResult && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="text-sm font-medium text-green-800 mb-2">OK Deck downloaded!</div>
                <div className="text-sm text-green-700">{slidesResult.filename} -- check your Downloads folder.</div>
              </div>
            )}

            {slidesError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-sm text-red-700">Error: {slidesError}</div>
              </div>
            )}

            {shareResult && (
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-sm font-medium text-blue-900 mb-2">
                  Shareable link created · {shareResult.itemCount} items
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    readOnly
                    value={shareResult.url}
                    onClick={e => e.target.select()}
                    className="flex-1 border border-blue-200 rounded bg-white px-3 py-2 text-sm text-gray-700 font-mono"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(shareResult.url) } catch {}
                    }}
                    className="text-sm border border-blue-300 text-blue-700 rounded px-3 py-2 hover:bg-blue-100"
                  >
                    Copy
                  </button>
                  <a
                    href={shareResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm bg-blue-600 text-white rounded px-3 py-2 hover:bg-blue-700"
                  >
                    Open
                  </a>
                </div>
                <p className="text-xs text-blue-700 mt-2">Link copied to clipboard. Anyone with the URL can view these results.</p>
              </div>
            )}

            {shareError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-sm text-red-700">Share error: {shareError}</div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

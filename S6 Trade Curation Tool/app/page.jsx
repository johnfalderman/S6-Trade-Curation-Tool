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

function ArtworkCard({ item, size = 'md' }) {
  const [imgError, setImgError] = useState(false)
  const imgSize = size === 'sm' ? 'h-32' : 'h-48'
  return (
    <div className="card group flex flex-col">
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
        {item.reasons && item.reasons.length > 0 && (
          <div className="text-xs text-gray-400 italic mt-1 line-clamp-1">
            {item.reasons.filter(r => !r.startsWith('⚠')).join(' · ')}
          </div>
        )}
        <div className="mt-auto pt-2">
          <a
            href={item.product_url.startsWith('/') ? 'https://society6.com' + item.product_url : item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-red-600 hover:text-red-800 font-medium"
          >
            View on Society6 →
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
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
          Set {gwSet.setNumber}
        </span>
        {gwSet.theme && (
          <span className="text-xs text-gray-500">{gwSet.theme}</span>
        )}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {(gwSet.items || []).map(item => (
          <ArtworkCard key={item.product_url} item={item} size="sm" />
        ))}
      </div>
    </div>
  )
}

function BriefBadge({ label, values }) {
  if (!values || values.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 items-start">
      <span className="text-xs text-gray-500 pt-0.5 shrink-0">{label}</span>
      {values.map(v => (
        <span key={v} className="tag">{v}</span>
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
  const [activeTab, setActiveTab] = useState('primary')
  const fileInputRef = useRef(null)

  async function handleGenerate(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResults(null)
    setSlidesResult(null)
    setSlidesError(null)

    try {
      let res
      if (moodboardFile) {
        // Use FormData when a PDF is attached
        const fd = new FormData()
        fd.append('brief', briefText)
        fd.append('moodboardUrl', moodboardUrl)
        fd.append('moodboard', moodboardFile)
        res = await fetch('/api/recommend', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief: briefText, moodboardUrl }),
        })
      }

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unknown error')
      setResults(data)
      setActiveTab('primary')
      setTimeout(() => {
        document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
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
          brief: results.brief,
          primary: results.primary,
          accent: results.accent,
          galleryWallSets: results.galleryWallSets,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.setupRequired) {
          setSlidesError({ setup: true, instructions: data.instructions, message: data.error })
        } else {
          throw new Error(data.error || 'Unknown error')
        }
      } else {
        setSlidesResult(data)
      }
    } catch (err) {
      setSlidesError({ message: err.message })
    } finally {
      setSlidesLoading(false)
    }
  }

  function handleUseSample() {
    setBriefText(SAMPLE_BRIEF)
  }

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

      {/* ── Intake Form ── */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">New Curation Request</h1>
        <p className="text-gray-500 text-sm mb-6">Paste a Jotform submission below to generate wall art recommendations.</p>

        <form onSubmit={handleGenerate} className="space-y-4">

          {/* Brief textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Jotform Submission Text</label>
              <button
                type="button"
                onClick={handleUseSample}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Load sample brief
              </button>
            </div>
            <textarea
              value={briefText}
              onChange={e => setBriefText(e.target.value)}
              placeholder={`Paste the Jotform response here. Example:\n\nProject Name: The Grand Hotel\nProject Type: Hotel\nDesign Style: Modern, Coastal\nColor Palette: Blues, Greens, Neutrals\nAvoid: Dark imagery\nRooms: Lobby, Guest Rooms\nGallery Wall: Yes\nTarget Pieces: 40`}
              rows={10}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-gray-400"
              required
            />
          </div>

          {/* Moodboard URL */}
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

          {/* Moodboard PDF upload */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Moodboard PDF <span className="text-gray-400 font-normal">(optional — upload instead of or alongside a URL)</span>
            </label>
            {moodboardFile ? (
              <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
                <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm text-gray-700 flex-1 truncate">{moodboardFile.name}</span>
                <span className="text-xs text-gray-400">{(moodboardFile.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  onClick={handleFileClear}
                  className="text-xs text-gray-400 hover:text-red-500 underline shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-3 border border-dashed border-gray-300 rounded-lg p-4 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-sm text-gray-500">Click to upload a moodboard PDF</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading || !briefText.trim()}
              className="btn-primary"
            >
              {loading ? 'Generating…' : 'Generate Recommendations'}
            </button>
            {results && (
              <span className="text-sm text-gray-500">
                {results.totalScored} items scored from catalog of {results.catalogSize}
              </span>
            )}
          </div>

        </form>
      </div>

      {/* ── Results ── */}
      {results && (
        <div id="results-section" className="space-y-8">

          {/* Parsed brief summary */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="section-header">Parsed Brief</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-base font-semibold text-gray-900">{brief.projectName || '—'}</div>
                <div className="text-sm text-gray-500 capitalize">{brief.projectType?.replace('_', ' ')}</div>
              </div>
              <div className="space-y-2">
                <BriefBadge label="Style" values={brief.styleTags} />
                <BriefBadge label="Palette" values={brief.paletteTags} />
                {brief.avoidTags?.length > 0 && <BriefBadge label="Avoid" values={brief.avoidTags} />}
                {brief.rooms?.length > 0 && <BriefBadge label="Spaces" values={brief.rooms} />}
              </div>
            </div>
            <div className="flex gap-4 text-sm text-gray-500 mt-3">
              {brief.galleryWall && <span>✓ Gallery wall requested</span>}
              {brief.pieceCount && <span>Target: {brief.pieceCount} pieces</span>}
            </div>
            {brief.moodboardNote && (
              <div className="mt-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                📎 {brief.moodboardNote}
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
                    activeTab === tab.key
                      ? 'border-gray-900 text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs text-gray-400">{tab.count}</span>
                </button>
              ))}
            </div>

            {activeTab === 'primary' && (
              <div>
                <p className="text-sm text-gray-500 mb-4">
                  Top {results.primary.length} pieces scored for this brief. Best fit for prominent placement.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {results.primary.map(item => (
                    <ArtworkCard key={item.product_url} item={item} />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'accent' && (
              <div>
                <p className="text-sm text-gray-500 mb-4">Accent pieces and alternates — variety options and secondary rooms.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {results.accent.map(item => (
                    <ArtworkCard key={item.product_url} item={item} />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'gallery' && (
              <div>
                <p className="text-sm text-gray-500 mb-4">Curated gallery wall sets — cohesive groupings of 5 pieces.</p>
                <div className="space-y-6">
                  {results.galleryWallSets.map(gwSet => (
                    <GalleryWallSet key={gwSet.setNumber} gwSet={gwSet} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Generate Deck */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="font-semibold text-gray-900 mb-1">Generate Google Slides Deck</div>
                <p className="text-sm text-gray-500">Creates a presentation with cover, brief summary, primary collection, accents, and gallery wall sets.</p>
              </div>
              <button
                onClick={handleGenerateSlides}
                disabled={slidesLoading}
                className="btn-accent shrink-0"
              >
                {slidesLoading ? 'Building deck…' : 'Generate Slides Deck'}
              </button>
            </div>

            {slidesResult && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="text-sm font-medium text-green-800 mb-2">Deck created successfully!</div>
                <a
                  href={slidesResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 hover:text-green-900 underline"
                >
                  Open Google Slides Deck →
                </a>
              </div>
            )}

            {slidesError && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="text-sm font-medium text-amber-800 mb-2">
                  {slidesError.setup ? 'Google Slides setup required' : `Error: ${slidesError.message}`}
                </div>
                {slidesError.setup && slidesError.instructions && (
                  <ol className="text-xs text-amber-700 space-y-1 list-decimal list-inside mt-2">
                    {slidesError.instructions.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

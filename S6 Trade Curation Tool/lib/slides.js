import PptxGenJS from 'pptxgenjs'

const SOCIETY6_BASE = 'https://society6.com'

function resolveUrl(url) {
  if (!url) return null
  return url.startsWith('/') ? SOCIETY6_BASE + url : url
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function gridConfig(n) {
  if (n <= 8)  return { cols: 4, rows: 2 }
  if (n <= 12) return { cols: 4, rows: 3 }
  if (n <= 16) return { cols: 4, rows: 4 }
  if (n <= 24) return { cols: 6, rows: 4 }
  return { cols: 8, rows: 4 }
}

async function fetchImgBase64(url, timeoutMs = 4000) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const mime = res.headers.get('content-type') || 'image/jpeg'
    return 'data:' + mime + ';base64,' + Buffer.from(buf).toString('base64')
  } catch {
    return null
  }
}

export async function createSlidesDeck({
  brief,
  primary = [],
  accent = [],
  galleryWallSets = [],
  providerInfo = {},
  imagesPerSlide = 8,
}) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'

  const DARK   = '1a1a1a'
  const MID    = '555555'
  const LIGHT  = 'f4f4f4'
  const ACCENT = 'c0392b'
  const WHITE  = 'FFFFFF'
  const LGRAY  = 'aaaaaa'

  const perSlide = Math.min(32, Math.max(8, Number(imagesPerSlide) || 8))
  const { cols, rows } = gridConfig(perSlide)

  const HEADER_H = 0.35
  const MARGIN   = 0.22
  const CELL_W   = (13.33 - MARGIN * (cols + 1)) / cols
  const CELL_H   = (7.5 - HEADER_H - MARGIN * (rows + 1)) / rows
  const TITLE_H  = perSlide <= 12 ? 0.32 : 0.24
  const LINK_H   = perSlide <= 12 ? 0.26 : 0.20
  const FONT_SZ  = perSlide <= 8 ? 9 : perSlide <= 16 ? 8 : 7
  const PH_H     = CELL_H - TITLE_H - LINK_H - 0.06

  function cellX(col) { return MARGIN + col * (CELL_W + MARGIN) }
  function cellY(row) { return HEADER_H + MARGIN + row * (CELL_H + MARGIN) }

  // Pre-fetch all images in parallel (4s timeout each)
  const allItems = [
    ...primary,
    ...accent,
    ...(galleryWallSets || []).flatMap(s => s.items || []),
  ]
  const imgCache = {}
  await Promise.allSettled(
    allItems
      .filter(item => item.image_url)
      .map(async item => {
        const url = resolveUrl(item.image_url)
        if (!url || imgCache[url] !== undefined) return
        imgCache[url] = await fetchImgBase64(url, 4000)
      })
  )

  // Cover slide
  function addCoverSlide() {
    const slide = pptx.addSlide()
    slide.background = { color: DARK }

    slide.addText('S6 TRADE  |  WALL ART CURATION', {
      x: 0.6, y: 0.55, w: 12, h: 0.3,
      fontSize: 9, bold: true, color: LGRAY, charSpacing: 3,
    })

    const projectName = brief?.projectName || 'Curation Deck'
    slide.addText(projectName, {
      x: 0.6, y: 1.1, w: 12, h: 1.4,
      fontSize: 42, bold: true, color: WHITE, wrap: true,
    })

    const sub = [
      brief?.projectType?.replace(/_/g, ' '),
      (brief?.styleTags || []).join(', '),
    ].filter(Boolean).join('  |  ')
    if (sub) {
      slide.addText(sub, {
        x: 0.6, y: 2.65, w: 12, h: 0.45,
        fontSize: 14, color: LGRAY, italic: true,
      })
    }

    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6, y: 3.3, w: 1.4, h: 0.07,
      fill: { color: ACCENT }, line: { color: ACCENT },
    })

    const provParts = [
      providerInfo.name,
      providerInfo.email,
      providerInfo.phone,
    ].filter(Boolean)

    if (provParts.length > 0) {
      slide.addText('CURATED BY', {
        x: 0.6, y: 5.85, w: 4, h: 0.25,
        fontSize: 7.5, color: '666666', bold: true, charSpacing: 2,
      })
      slide.addText(provParts.join('   |   '), {
        x: 0.6, y: 6.18, w: 12, h: 0.4,
        fontSize: 11, color: LGRAY,
      })
    }

    slide.addText('Society6 Trade', {
      x: 9.33, y: 6.9, w: 3.5, h: 0.35,
      fontSize: 9, bold: true, color: '444444', align: 'right',
    })
  }

  // Brief slide
  function addBriefSlide() {
    if (!brief) return
    const slide = pptx.addSlide()
    slide.background = { color: DARK }

    slide.addText('PROJECT BRIEF', {
      x: 0.6, y: 0.5, w: 12, h: 0.28,
      fontSize: 9, bold: true, color: LGRAY, charSpacing: 3,
    })
    slide.addText(brief.projectName || '-', {
      x: 0.6, y: 0.88, w: 12, h: 0.75,
      fontSize: 30, bold: true, color: WHITE,
    })

    const rows2 = [
      ['Style',   (brief.styleTags   || []).join(', ')],
      ['Palette', (brief.paletteTags || []).join(', ')],
      ['Avoid',   (brief.avoidTags   || []).join(', ')],
      ['Spaces',  (brief.rooms       || []).join(', ')],
      ['Pieces',  brief.targetPieceCount ? brief.targetPieceCount + ' target pieces' : ''],
    ].filter(r => r[1])

    rows2.forEach(([label, value], i) => {
      slide.addText(label.toUpperCase(), {
        x: 0.6, y: 1.85 + i * 0.54, w: 1.5, h: 0.38,
        fontSize: 8, bold: true, color: '666666', charSpacing: 1,
      })
      slide.addText(value, {
        x: 2.2, y: 1.85 + i * 0.54, w: 10, h: 0.38,
        fontSize: 11, color: WHITE,
      })
    })

    if (brief.briefSummary) {
      slide.addText('"' + brief.briefSummary + '"', {
        x: 0.6, y: 5.3, w: 12, h: 1.5,
        fontSize: 11, color: LGRAY, italic: true, wrap: true,
      })
    }
  }

  // Section divider
  function addSectionSlide(label) {
    const slide = pptx.addSlide()
    slide.background = { color: LIGHT }
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.14, h: 7.5,
      fill: { color: ACCENT }, line: { color: ACCENT },
    })
    slide.addText(label, {
      x: 0.55, y: 2.8, w: 12, h: 1.4,
      fontSize: 34, bold: true, color: DARK,
    })
  }

  // Grid slide with real images + fallback placeholder
  function addGridSlide(items, label) {
    const slide = pptx.addSlide()
    slide.background = { color: WHITE }

    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.07,
      fill: { color: ACCENT }, line: { color: ACCENT },
    })
    if (label) {
      slide.addText(label, {
        x: MARGIN, y: 0.1, w: 12, h: 0.22,
        fontSize: 7, bold: true, color: LGRAY, charSpacing: 2,
      })
    }

    for (let i = 0; i < Math.min(items.length, perSlide); i++) {
      const item    = items[i]
      const col     = i % cols
      const row     = Math.floor(i / cols)
      const x       = cellX(col)
      const y       = cellY(row)
      const prodUrl = resolveUrl(item.product_url)
      const imgUrl  = resolveUrl(item.image_url)
      const imgData = imgUrl && imgCache[imgUrl]

      if (imgData) {
        slide.addImage({
          data: imgData,
          x, y, w: CELL_W, h: PH_H,
          sizing: { type: 'contain', w: CELL_W, h: PH_H },
        })
      } else {
        slide.addShape(pptx.ShapeType.rect, {
          x, y, w: CELL_W, h: PH_H,
          fill: { color: 'e8e8e8' },
          line: { color: 'dddddd', pt: 0.5 },
        })
      }

      slide.addText(item.title || '-', {
        x, y: y + PH_H + 0.03, w: CELL_W, h: TITLE_H,
        fontSize: FONT_SZ, color: MID,
        wrap: true, overflow: 'ellipsis',
      })

      if (prodUrl) {
        slide.addText(
          [{ text: 'View on Society6 ->', options: { hyperlink: { url: prodUrl, tooltip: item.title || 'View product' } } }],
          { x, y: y + PH_H + 0.03 + TITLE_H, w: CELL_W, h: LINK_H, fontSize: FONT_SZ, bold: true, color: ACCENT }
        )
      }
    }
  }

  // Build deck
  addCoverSlide()
  addBriefSlide()

  if (primary.length > 0) {
    addSectionSlide('PRIMARY COLLECTION')
    chunkArray(primary, perSlide).forEach((chunk, p, arr) =>
      addGridSlide(chunk, 'PRIMARY COLLECTION  |  ' + (p + 1) + ' / ' + arr.length)
    )
  }

  if (accent.length > 0) {
    addSectionSlide('ACCENT & ALTERNATES')
    chunkArray(accent, perSlide).forEach((chunk, p, arr) =>
      addGridSlide(chunk, 'ACCENT & ALTERNATES  |  ' + (p + 1) + ' / ' + arr.length)
    )
  }

  if (galleryWallSets?.length > 0) {
    addSectionSlide('GALLERY WALL SETS')
    for (const gwSet of galleryWallSets) {
      const items = gwSet.items || []
      if (!items.length) continue
      chunkArray(items, perSlide).forEach((chunk, p, arr) =>
        addGridSlide(chunk, 'GALLERY WALL SET ' + gwSet.setNumber + '  |  ' + (p + 1) + ' / ' + arr.length)
      )
    }
  }

  const b64 = await pptx.write({ outputType: 'base64' })
  const safeName = (brief?.projectName || 'Curation').replace(/\s+/g, '-')
  return { pptxBase64: b64, filename: 'S6-Curation-' + safeName + '.pptx' }
}

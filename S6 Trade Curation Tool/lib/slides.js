import PptxGenJS from 'pptxgenjs'

const SOCIETY6_BASE = 'https://society6.com'

function resolveUrl(url) {
  if (!url) return null
  return url.startsWith('/') ? SOCIETY6_BASE + url : url
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export async function createSlidesDeck({ brief, primary = [], accent = [], galleryWallSets = [] }) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'  // 13.33 x 7.5 inches

  // ââ Theme âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const DARK   = '1a1a1a'
  const MID    = '444444'
  const LIGHT  = 'f5f5f5'
  const ACCENT = 'c0392b'  // Society6 red
  const WHITE  = 'FFFFFF'

  // ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function addCoverSlide(title, subtitle) {
    const slide = pptx.addSlide()
    slide.background = { color: DARK }
    slide.addText('S6 TRADE CURATION', {
      x: 0.5, y: 0.6, w: 12, h: 0.4,
      fontSize: 11, bold: true, color: '888888',
      charSpacing: 4,
    })
    slide.addText(title || 'Curation Deck', {
      x: 0.5, y: 1.2, w: 12, h: 1.2,
      fontSize: 40, bold: true, color: WHITE,
    })
    slide.addText(subtitle || '', {
      x: 0.5, y: 2.5, w: 12, h: 0.6,
      fontSize: 18, color: '999999',
    })
    // Red accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: 3.3, w: 1.2, h: 0.08,
      fill: { color: ACCENT }, line: { color: ACCENT },
    })
  }

  function addSectionSlide(label) {
    const slide = pptx.addSlide()
    slide.background = { color: LIGHT }
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.12, h: 7.5,
      fill: { color: ACCENT }, line: { color: ACCENT },
    })
    slide.addText(label, {
      x: 0.5, y: 3.0, w: 12, h: 1.2,
      fontSize: 32, bold: true, color: DARK,
    })
  }

  // ââ Grid slide: up to 4 artworks per slide ââââââââââââââââââââââââââââââââ
  // Layout: 2 columns Ã 2 rows
  // Each cell: x,y,w,h for image + title + link text
  const GRID = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
  ]
  const MARGIN     = 0.35
  const COL_W      = (13.33 - MARGIN * 3) / 2   // ~6.315
  const ROW_H      = (7.5  - MARGIN * 3) / 2    // ~3.415
  const IMG_H      = ROW_H - 0.85               // leave room for text
  const TITLE_H    = 0.4
  const LINK_H     = 0.28

  function cellX(col) { return MARGIN + col * (COL_W + MARGIN) }
  function cellY(row) { return MARGIN + row * (ROW_H + MARGIN) }

  async function addGridSlide(items, slideLabel) {
    const slide = pptx.addSlide()
    slide.background = { color: WHITE }

    // Thin top bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.06,
      fill: { color: ACCENT }, line: { color: ACCENT },
    })
    if (slideLabel) {
      slide.addText(slideLabel, {
        x: MARGIN, y: 0.1, w: 12, h: 0.22,
        fontSize: 8, bold: true, color: '999999', charSpacing: 2,
      })
    }

    for (let i = 0; i < items.length && i < 4; i++) {
      const item  = items[i]
      const pos   = GRID[i]
      const x     = cellX(pos.col)
      const y     = cellY(pos.row)
      const prodUrl = resolveUrl(item.product_url)
      const imgUrl  = resolveUrl(item.image_url)

      // Image box (grey background in case image fails)
      slide.addShape(pptx.ShapeType.rect, {
        x, y, w: COL_W, h: IMG_H,
        fill: { color: 'eeeeee' }, line: { color: 'dddddd', pt: 1 },
      })

      // Try to add the image
      if (imgUrl) {
        try {
          slide.addImage({
            path: imgUrl,
            x, y, w: COL_W, h: IMG_H,
            sizing: { type: 'contain', w: COL_W, h: IMG_H },
          })
        } catch (e) {
          // Image failed â grey box stays, that's fine
        }
      }

      // Title
      slide.addText(item.title || '', {
        x, y: y + IMG_H + 0.05, w: COL_W, h: TITLE_H,
        fontSize: 9, bold: false, color: MID,
        wrap: true, overflow: 'ellipsis',
      })

      // "View on Society6 â" â this is the reliably hyperlinked element
      if (prodUrl) {
        slide.addText('View on Society6  â', {
          x, y: y + IMG_H + 0.05 + TITLE_H, w: COL_W, h: LINK_H,
          fontSize: 9, bold: true, color: ACCENT,
          hyperlink: { url: prodUrl, tooltip: item.title || 'View on Society6' },
        })
      }
    }
  }

  // ââ Build deck âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const projectName = brief?.projectName || 'Curation'
  const projectType = brief?.projectType?.replace('_', ' ') || ''
  const styleTags   = (brief?.styleTags || []).join(', ')
  const coverSub    = [projectType, styleTags].filter(Boolean).join(' Â· ')

  addCoverSlide(projectName, coverSub)

  // Brief summary slide
  if (brief) {
    const slide = pptx.addSlide()
    slide.background = { color: DARK }
    slide.addText('PROJECT BRIEF', {
      x: 0.6, y: 0.5, w: 12, h: 0.3,
      fontSize: 9, bold: true, color: '888888', charSpacing: 3,
    })
    slide.addText(projectName, {
      x: 0.6, y: 0.9, w: 12, h: 0.7,
      fontSize: 28, bold: true, color: WHITE,
    })

    const rows = [
      ['Style',   (brief.styleTags   || []).join(', ')],
      ['Palette', (brief.paletteTags || []).join(', ')],
      ['Avoid',   (brief.avoidTags   || []).join(', ')],
      ['Spaces',  (brief.rooms       || []).join(', ')],
      ['Pieces',  brief.targetPieceCount ? `${brief.targetPieceCount} pieces` : ''],
    ].filter(r => r[1])

    rows.forEach(([label, value], i) => {
      slide.addText(label.toUpperCase(), {
        x: 0.6, y: 1.8 + i * 0.55, w: 1.4, h: 0.4,
        fontSize: 8, bold: true, color: '888888', charSpacing: 1,
      })
      slide.addText(value, {
        x: 2.1, y: 1.8 + i * 0.55, w: 10, h: 0.4,
        fontSize: 11, color: WHITE,
      })
    })

    if (brief.briefSummary) {
      slide.addText(`"${brief.briefSummary}"`, {
        x: 0.6, y: 5.2, w: 12, h: 1.5,
        fontSize: 12, color: 'bbbbbb', italic: true, wrap: true,
      })
    }
  }

  // Primary collection
  if (primary.length > 0) {
    addSectionSlide('PRIMARY COLLECTION')
    const pages = chunkArray(primary, 4)
    for (let p = 0; p < pages.length; p++) {
      await addGridSlide(pages[p], `PRIMARY COLLECTION  Â·  ${p + 1} / ${pages.length}`)
    }
  }

  // Accent & alternates
  if (accent.length > 0) {
    addSectionSlide('ACCENT & ALTERNATES')
    const pages = chunkArray(accent, 4)
    for (let p = 0; p < pages.length; p++) {
      await addGridSlide(pages[p], `ACCENT & ALTERNATES  Â·  ${p + 1} / ${pages.length}`)
    }
  }

  // Gallery wall sets
  if (galleryWallSets?.length > 0) {
    addSectionSlide('GALLERY WALL SETS')
    for (const gwSet of galleryWallSets) {
      const items = gwSet.items || []
      if (items.length === 0) continue
      const pages = chunkArray(items, 4)
      for (let p = 0; p < pages.length; p++) {
        await addGridSlide(pages[p], `GALLERY WALL SET ${gwSet.setNumber}  Â·  ${p + 1} / ${pages.length}`)
      }
    }
  }

  // Export
  const b64 = await pptx.write({ outputType: 'base64' })
  return {
    pptxBase64: b64,
    filename: `S6-Curation-${projectName.replace(/\s+/g, '-')}.pptx`,
  }
}

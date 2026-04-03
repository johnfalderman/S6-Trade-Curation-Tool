import { createSlidesDeck } from '../../../lib/slides'

export const maxDuration = 60

export async function POST(request) {
  const body = await request.json()
  const { brief, primary, accent, galleryWallSets, imagesPerSlide } = body
  const result = await createSlidesDeck(brief, {
    primary: primary || [],
    accent: accent || [],
    galleryWallSets: galleryWallSets || [],
    imagesPerSlide: imagesPerSlide || 8,
  })
  return Response.json(result)
}

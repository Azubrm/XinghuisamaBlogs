import { NextRequest, NextResponse } from 'next/server'
import { createMusicLoader } from './music-service'

const loadSong = createMusicLoader()

export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.get('ids')
  const songIds = ids?.split(',').map((id) => id.trim()).filter(Boolean) || []
  if (!songIds.length) {
    return NextResponse.json({ error: 'Missing ids parameter' }, { status: 400 })
  }
  if (songIds.length > 50) {
    return NextResponse.json({ error: 'At most 50 song ids are allowed' }, { status: 400 })
  }
  // Promise.all retains the configured order, including duplicate IDs.
  return NextResponse.json(await Promise.all(songIds.map(loadSong)))
}

import { NextResponse } from 'next/server'

import { getFeedPage, type FeedPage } from '../../../lib/feed'
import { FEED_PAGE_SIZE, parseFeedQuery } from '../../../lib/feedShape'

// Лента материалов для догрузки по скроллу: `GET /api/feed`.
//
// Наружу открыт, как и весь `/api/*` — отдаёт только опубликованное, ровно тем
// же составом, каким уже отдаётся публичный REST Payload (`/api/posts`), но
// весом карточки вместо веса записи. Внутренние поля, черновики и черновики
// версий сюда не попадают: выборка идёт по `_status = 'published'`.
//
// Ответ кэшируется на 2 минуты: подгрузка — это GET без побочных эффектов, а
// на единственном vCPU пересборка ленты на каждый чих не нужна.
const CACHE_CONTROL = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const query = parseFeedQuery(new URL(request.url).searchParams)
  try {
    const result: FeedPage = await getFeedPage({
      page: query.page,
      limit: query.limit || FEED_PAGE_SIZE,
      institutionSlug: query.institutionSlug,
      type: query.type,
      q: query.q,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (err) {
    // Клиент ленты умеет показать «не удалось загрузить» и повторить: молча
    // вернуть пустую страницу нельзя — список молча обрезался бы.
    console.error(`[feed] страница не отдалась: ${(err as Error)?.message ?? err}`)
    return NextResponse.json(
      { error: 'лента временно недоступна' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

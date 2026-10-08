import config from '@payload-config'
import { getPayload } from 'payload'
import type { Where } from 'payload'

import { emptyFeedPage, feedWhere, mentionWhere, mentionedByStems, toFeedCard, type FeedPage, type FeedType } from './feedShape'
import { isMentionFeed, mentionStems } from './institutions/mentionFeed'

// Сбор страницы ленты: главная, `/news` и раздел дома культуры.
//
// Почему своя функция, а не публичный REST Payload: браузеру нужны семь полей
// записи и четыре поля дома культуры, а REST отдаёт вместе с ними текст записи
// и текст карточки (вложенный select связи Payload не режет — проверено на
// проде). На единственном vCPU разница в весе ответа — это разница в скорости.
//
// Чистая часть (разбор запроса, обрезка карточки, условие выборки) — в
// `feedShape.ts`, её проверяют юниты без БД.

export type { FeedCard, FeedMediaSize, FeedPage, FeedType } from './feedShape'
export { FEED_MAX_PAGE_SIZE, FEED_PAGE_SIZE } from './feedShape'

type FeedQuery = {
  page?: number
  limit?: number
  institutionSlug?: string | null
  type?: FeedType | null
  q?: string | null
}

export async function getFeedPage(query: FeedQuery = {}): Promise<FeedPage> {
  const page = Math.min(Math.max(query.page ?? 1, 1), 100000)
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50)

  const payload = await getPayload({ config })
  let institutionId: string | number | undefined
  const slug = query.institutionSlug?.trim()
  if (slug) {
    // Раздел черновика не отдаёт ленту: догружать «невидимое» нельзя, а слаг
    // неизвестного дома культуры — обычный запрос, не ошибка. И важно: это
    // ПУСТАЯ лента, а не общая. Иначе любой выдуманный слаг в адресе отдал бы
    // посетителю все новости района вместо пустого раздела.
    if (isMentionFeed(slug)) {
      return getMentionFeedPage(payload, slug, query.type ?? null, page, limit)
    }
    const found = await payload.find({
      collection: 'institutions',
      where: { slug: { equals: slug }, _status: { equals: 'published' } },
      depth: 0,
      limit: 1,
    })
    const id = found.docs[0]?.id as string | number | undefined
    if (id === undefined || id === null) return emptyFeedPage(page)
    institutionId = id
  }

  const res = await payload.find({
    collection: 'posts',
    // `feedWhere` собирает те же объекты, что принимает `Where`, но держит их в
    // своём типе, чтобы не тянуть типы Payload в юниты.
    where: feedWhere(institutionId, query.type ?? null, query.q ?? null) as Where,
    sort: '-date',
    depth: 1,
    limit,
    page,
  })

  const totalPages = typeof res.totalPages === 'number' ? res.totalPages : page
  return {
    docs: res.docs.map(toFeedCard),
    page,
    totalPages,
    totalDocs: typeof res.totalDocs === 'number' ? res.totalDocs : res.docs.length,
    hasMore: page < totalPages,
  }
}

// Лента раздела без своего сообщества: материалы, где упоминается населённый
// пункт. SQL сужает выборку по заголовку (тело записи — jsonb, `LIKE` по нему не
// идёт), затем заголовки проверяются по словам и список режется уже в коде.
// Таких материалов единицы, поэтому постраничная выборка идёт здесь, а не в БД:
// иначе страница могла бы прийти пустой при непустой ленте.
async function getMentionFeedPage(
  payload: Awaited<ReturnType<typeof getPayload>>,
  slug: string,
  type: FeedType | null,
  page: number,
  limit: number,
): Promise<FeedPage> {
  const stems = mentionStems(slug)
  if (stems.length === 0) return emptyFeedPage(page)

  const res = await payload.find({
    collection: 'posts',
    where: mentionWhere(stems, type) as Where,
    sort: '-date',
    depth: 1,
    // Страховка от «лента разрослась»: такой раздел по определению единичный.
    limit: 500,
  })

  const docs = res.docs
    .filter((doc) => mentionedByStems((doc as { title?: unknown }).title, stems))
    .map(toFeedCard)
  const start = (page - 1) * limit
  return {
    docs: docs.slice(start, start + limit),
    page,
    totalPages: Math.max(1, Math.ceil(docs.length / limit)),
    totalDocs: docs.length,
    hasMore: start + limit < docs.length,
  }
}

// Мягкая деградация для страниц. Сборка на деплое идёт БЕЗ живой БД, и первая
// же выборка ленты на главной роняла `next build` — то есть релиз целиком. А
// сбой БД в рантайме отдавал бы посетителю пустую главную. Поэтому ошибка не
// пробрасывается: страница рендерится без ленты, в журнал пишется строка (без
// неё «пустая главная» выглядит как решение, а не как отказ), а ISR в 60 секунд
// чинит страницу сама.
//
// Наружу (в `/api/feed`) эта обёртка НЕ надевается: там клиент обязан увидеть
// отказ и предложить повтор, а не тихую пустую страницу.
export async function getFeedPageSafe(query: FeedQuery = {}): Promise<FeedPage> {
  try {
    return await getFeedPage(query)
  } catch (err) {
    console.error(`[feed] лента не собралась: ${(err as Error)?.message ?? err}`)
    return emptyFeedPage(Math.min(Math.max(query.page ?? 1, 1), 100000))
  }
}
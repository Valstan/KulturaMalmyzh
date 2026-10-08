// Чистая часть ленты: разбор запроса, обрезка записи до карточки, условие
// выборки. Ни БД, ни конфига Payload — чтобы это можно было проверять юнитами
// (см. `feed.test.ts`) и не тянуть Payload в тестовый раннер. Сбор страницы
// живёт в `feed.ts`.

// Порядок ленты везде один: по дате материала, от новых к старым. Дата
// материала — это дата оригинала в паблике-источнике (заказ владельца 30.09),
// то есть «дата публикации» с точки зрения читателя.
export const FEED_PAGE_SIZE = 20
export const FEED_MAX_PAGE_SIZE = 50

export type FeedType = 'news' | 'event'

export type FeedMediaSize = { url?: string | null; width?: number | null; height?: number | null }

export type FeedCard = {
  id: string | number
  title?: string | null
  slug?: string | null
  date?: string | null
  publishedAt?: string | null
  type?: string | null
  category?: string | null
  cover?: {
    url?: string | null
    width?: number | null
    height?: number | null
    sizes?: { card?: FeedMediaSize | null; thumbnail?: FeedMediaSize | null } | null
  } | null
  institution?: {
    id?: string | number
    title?: string | null
    shortTitle?: string | null
    slug?: string | null
    website?: string | null
  } | null
}

export type FeedPage = {
  docs: FeedCard[]
  page: number
  totalPages: number
  totalDocs: number
  hasMore: boolean
}

const int = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

// Разбор строки запроса `/api/feed`. Чистая функция — ради неё есть юниты:
// страницу может попросить кто угодно, и «мусор в параметре» не должен ни
// 500-ить, ни молча отдать чужую выборку.
export function parseFeedQuery(params: URLSearchParams | Record<string, string | undefined>): {
  page: number
  limit: number
  institutionSlug: string | null
  type: FeedType | null
  q: string | null
} {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key)
    const value = (params as Record<string, string | undefined>)[key]
    return typeof value === 'string' ? value : null
  }
  const rawPage = int(get('page'), 1)
  const page = Math.min(Math.max(rawPage, 1), 100000)
  const rawLimit = int(get('limit'), FEED_PAGE_SIZE)
  const limit = Math.min(Math.max(rawLimit, 1), FEED_MAX_PAGE_SIZE)
  const slug = (get('institution') ?? '').trim()
  const typeRaw = (get('type') ?? '').trim()
  const type: FeedType | null = typeRaw === 'event' || typeRaw === 'news' ? typeRaw : null
  // Поиск: пустой запрос — обычная лента без фильтра. Обрезка длины — не
  // цензура, а граница LIKE-паттерна: токены режутся отдельно ниже.
  const rawQ = (get('q') ?? '').trim().slice(0, 64)
  return {
    page,
    limit,
    institutionSlug: /^[a-z0-9-]{1,64}$/.test(slug) ? slug : null,
    type,
    q: rawQ ? rawQ : null,
  }
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asSize = (value: unknown): FeedMediaSize | null => {
  const size = asObject(value)
  if (!size) return null
  return { url: asString(size['url']), width: asNumber(size['width']), height: asNumber(size['height']) }
}

// Запись → карточка ленты. Обрезает всё, что карточка не рисует: текст, галерею,
// видео, служебные поля. Тонкость — сбор идёт с `depth: 1`: при `depth: 0`
// обложка приходит идентификатором, и превью рисовать нечего.
export function toFeedCard(doc: unknown): FeedCard {
  const d = (doc ?? {}) as Record<string, unknown>
  const institution = asObject(d['institution'])
  const cover = asObject(d['cover'])
  const sizes = asObject(cover?.['sizes'])
  return {
    id: (d['id'] as string | number) ?? '',
    title: asString(d['title']),
    slug: asString(d['slug']),
    date: asString(d['date']),
    publishedAt: asString(d['publishedAt']),
    type: asString(d['type']),
    category: asString(d['category']),
    cover: cover
      ? {
          url: asString(cover['url']),
          width: asNumber(cover['width']),
          height: asNumber(cover['height']),
          sizes: { card: asSize(sizes?.['card']), thumbnail: asSize(sizes?.['thumbnail']) },
        }
      : null,
    institution: institution
      ? {
          id: institution['id'] as string | number,
          title: asString(institution['title']),
          shortTitle: asString(institution['shortTitle']),
          slug: asString(institution['slug']),
          website: asString(institution['website']),
        }
      : null,
  }
}

export type FeedWhere = Record<string, unknown>

// Склейка страниц ленты в браузере. Дубль по id на границе страниц — не
// редкость: если между двумя запросами вышла новая запись, сдвинутая по дате
// строка попадёт в обе страницы. Показывать её дважды нельзя, а перезапрашивать
// первую страницу — потеря уже загруженного. Поэтому дедуп по id, порядок
// первого появления сохраняется.
export function mergeFeedDocs(prev: FeedCard[], incoming: FeedCard[]): FeedCard[] {
  if (incoming.length === 0) return prev
  const seen = new Set(prev.map((doc) => doc.id))
  return [...prev, ...incoming.filter((doc) => !seen.has(doc.id))]
}

// Условие выборки ленты. Ветки склеиваются в `and`: верхний уровень занимает
// `_status`, а дом культуры и вид записи ставятся отдельными — иначе пришлось бы
// переписывать чужое условие.
//
// `institutionId` обязан быть числом: `null` означал бы «фильтр не задан», и
// лента молча стала бы общей. Сборщик (`feed.ts`) на такой случай отдаёт пустую
// страницу сам, сюда такое не доходит.
export function feedWhere(institutionId?: string | number | null, type?: FeedType | null, q?: string | null): FeedWhere {
  const clauses: FeedWhere[] = [{ _status: { equals: 'published' } }]
  if (institutionId !== undefined && institutionId !== null) {
    clauses.push({ institution: { equals: institutionId } })
  }
  if (type) clauses.push({ type: { equals: type } })
  for (const token of searchTokens(q)) {
    clauses.push({ title: { like: `%${token}%` } })
  }
  return clauses.length === 1 ? clauses[0] : { and: clauses }
}

// Токены поиска: слова запроса, каждое обязательно (AND). Ищется только по
// заголовку: тело записи — jsonb, полнотекстового индекса нет, а LIKE по
// сотням килобайт текста на запрос — не наш путь (та же причина, что у
// mentionWhere). Регистр — дело адаптера: `like` в нашем стеке
// регистронезависим (проверено лентой упоминаний и селф-тестом поиска).
// `%` и `_` пользователя экранируются: иначе запрос из одного `%` нашёл бы
// вообще всё, притворяясь поиском.
export function searchTokens(q?: string | null): string[] {
  const words = String(q ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 5)
  return words.map((word) => escapeLike(word.slice(0, 32))).filter((word) => word.length > 0)
}

export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// Пустая страница. Отдельная функция, потому что ею пользуются два разных
// отказа: неизвестный слаг дома культуры (нет такого раздела) и пустой раздел.
// Оба обязаны выглядеть одинаково, и оба не имеют права отдавать чужую ленту.
export function emptyFeedPage(page = 1): FeedPage {
  return { docs: [], page, totalPages: page, totalDocs: 0, hasMore: false }
}

// Лента «по упоминанию»: заголовок материала должен содержать все основы
// населённого пункта. SQL сужает выборку через `LIKE` по основам (тело записи
// — jsonb, по нему `LIKE` не пойдёт), а эта проверка идёт вторым слоем уже по
// заголовкам: «Малый Китяк» не должен попасть под «Большой Китяк» из-за одной
// общей части «китяк».
export function mentionWhere(stems: string[], type?: FeedType | null): FeedWhere {
  const titleClauses = stems.map((stem) => ({ title: { like: `%${stem}%` } }))
  const clauses: FeedWhere[] = [{ _status: { equals: 'published' } }, ...titleClauses]
  if (type) clauses.push({ type: { equals: type } })
  return { and: clauses }
}

// Совпадает ли текст с основами: каждое слово текста обязано начинаться хотя бы
// на одну из основ. Ложные срабатывания отсеиваются, пропуски — нет.
export function mentionedByStems(text: unknown, stems: string[]): boolean {
  if (stems.length === 0) return false
  const words = String(text ?? '')
    .toLowerCase()
    .match(/[а-яёa-z0-9]+/g)
  if (!words) return false
  return stems.every((stem) => words.some((word) => word.startsWith(stem)))
}
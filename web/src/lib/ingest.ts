import { timingSafeEqual } from 'node:crypto'

import { slugForVkPost } from './vk/import'
import { vkTextToLexical, vkTitleFrom } from './vk/toLexical'

// Чистая логика приёмника стандартного эшелона доставки (мандат Мозга 29.09,
// заказ владельца: Сарафан сам доставляет посты и в ДК). Вынесена из
// `app/api/ingest/posts/route.ts`, чтобы проверяться юнитами без БД и HTTP —
// калька с приёмников портала, Сабантуя и Казанской: контракт один, чтобы
// Сарафан включал сайт строкой в конфиге, а не отдельным кодом.
//
// Отличия от соседей — только в форме нашей коллекции `posts`:
//   - рубрики-коллекции нет; `section` от классификатора — это slug учреждения
//     (чей материал), неизвестный slug — warning + сохраняется в текстовое поле
//     `category`, чтобы редактор видел догадку классификатора;
//   - вид записи ставит редактор (`type: 'news'` молча, импорт не угадывает);
//   - право публикации — ОТДЕЛЬНЫМ ключом `KULTURA_PUBLISH_KEY` (решение
//     владельца 03.10, заказ Сарафана через переговорную): `publish: true`
//     публикует только с заголовком `X-Publish-Key`, без него — warning и
//     черновик. Ключ доставки (`KULTURA_INGEST_KEY`) публиковать не умеет
//     никогда — урок #124: флаг в канале доставки молча раздал бы право всем
//     держателям старого ключа.

export type LexicalDoc = ReturnType<typeof vkTextToLexical>

export type IncomingImage = string | { url: string; alt?: string }
export type IncomingVideo = string | { url: string; title?: string }

export const MAX_IMAGES = 10
export const MAX_VIDEOS = 5

// Сравнение секрета из заголовка с ожидаемым — постоянное время, как и у
// служебных маршрутов. Пустой env — «никого не пускать», а не «пускать всех».
export function secretMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Ключ приходит либо своим заголовком, либо Bearer — принимаем оба имени,
// как у портала и Казанской: Сарафан шлёт одинаково всем трём приёмникам.
export function extractGatewayKey(request: Request): string {
  return (
    request.headers.get('x-gateway-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  )
}

// Ключ публикации — ТОЛЬКО своим заголовком `X-Publish-Key`, без Bearer:
// Bearer уже занят ключом доставки, и смешивать два права в одном имени —
// ровно та ошибка, от которой уходим (#124). Пустой — «не предъявлялся».
export function extractPublishKey(request: Request): string {
  return request.headers.get('x-publish-key') ?? ''
}

// Итоговый статус записи. Чистая функция ради юнитов: маршрут только сверяет
// ключ через secretMatches и отдаёт результат сюда. Без флага — черновик без
// шума; флаг с верным ключом — публикация; флаг без ключа — черновик +
// warning (доставка не теряется, поведение как до 03.10).
export function resolvePublish(publish: unknown, keyMatches: boolean, warnings: string[]): 'draft' | 'published' {
  if (publish !== true) return 'draft'
  if (keyMatches) return 'published'
  warnings.push('publish ignored: no publish key presented, saved as draft')
  return 'draft'
}

// Заголовок записи. Явного нет — первая осмысленная строка текста (≤90, по
// границе слова); совсем пустой текст даёт запасной заголовок с датой, чтобы
// пост из одних фото не выглядел потерянным в админке.
export function deriveTitle(rawTitle: string, text: string, fallbackDateIso: string): string {
  if (rawTitle) return rawTitle
  return vkTitleFrom(text, `Запись от ${fallbackDateIso.slice(0, 10)}`)
}

// Дата оригинала. Нет или не разбирается — warning и время доставки: лента
// сортируется по этому полю, и «когда-то» хуже честного «сейчас».
export function resolveDate(raw: unknown, nowIso: string, warnings: string[]): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    warnings.push('date missing: set to delivery time')
    return nowIso
  }
  const parsed = new Date(raw.trim())
  if (Number.isNaN(parsed.getTime())) {
    warnings.push(`date invalid: ${raw.trim().slice(0, 40)} — set to delivery time`)
    return nowIso
  }
  return parsed.toISOString()
}

// Видео не перекладываем — только ссылка (плеер ВК встраивается на странице,
// тяжёлых файлов у нас нет, решение то же, что у портала).
export function normalizeVideos(raw: unknown, warnings: string[]): { url: string; title?: string }[] {
  if (!Array.isArray(raw)) return []
  const videos: { url: string; title?: string }[] = []
  for (const [index, item] of (raw as IncomingVideo[]).entries()) {
    if (videos.length >= MAX_VIDEOS) {
      warnings.push(`videos truncated to ${MAX_VIDEOS}`)
      break
    }
    const url = typeof item === 'string' ? item : item?.url
    if (!url || !/^https?:\/\//i.test(url)) {
      warnings.push(`video ${index}: invalid url`)
      continue
    }
    videos.push({ url, title: typeof item === 'object' ? item?.title : undefined })
  }
  return videos
}

export type PostDataInput = {
  title: string
  text: string
  vkUid: string
  sourceUrl: string
  dateIso: string
  institutionId?: number
  /** Догадка классификатора, не matched на учреждение — сохраняем как метку. */
  category?: string
  mediaIds: number[]
  videos: { url: string; title?: string }[]
  /** Статус из resolvePublish; по умолчанию черновик (поведение до 03.10). */
  status?: 'draft' | 'published'
}

// Тело документа коллекции `posts` для payload.create/update.
//
// ⚠️ `_status` — явно, не флагом `draft`: при versions.drafts состояние
// берётся отсюда, `draft: false` не публикует (G223). Slug несёт vkUid —
// заголовки доставки повторяются по построению, без хвоста разные материалы
// схлопнулись бы в один адрес (#279 у переноса Калинино).
export function buildPostData(input: PostDataInput) {
  return {
    _status: (input.status ?? 'draft') as 'draft' | 'published',
    title: input.title,
    slug: slugForVkPost(input.title, input.vkUid, input.dateIso),
    date: input.dateIso,
    institution: input.institutionId ?? undefined,
    type: 'news' as const,
    source: 'vk' as const,
    vkUid: input.vkUid,
    sourceUrl: input.sourceUrl,
    content: vkTextToLexical(input.text),
    cover: input.mediaIds[0] ?? undefined,
    gallery: input.mediaIds.slice(1).map((image) => ({ image })),
    videos: input.videos.length
      ? input.videos.map((v) => ({ url: v.url, title: v.title || undefined }))
      : undefined,
    category: input.category || undefined,
  }
}

import config from '@payload-config'
import { getPayload } from 'payload'

import {
  buildPostData,
  deriveTitle,
  extractGatewayKey,
  extractPublishKey,
  MAX_IMAGES,
  normalizeVideos,
  resolveDate,
  resolvePublish,
  secretMatches,
  type IncomingImage,
} from '../../../../lib/ingest'
import { uploadPhoto } from '../../../../lib/vk/import'

// Приёмник стандартного эшелона доставки (мандат Мозга 29.09, заказ владельца:
// Сарафан сам доставляет посты и в ДК — портал целиком, раздел РЦКД открыт,
// Калинино живёт 301 на /dk/kalinino). Сайт — только приёмник: в ВК сам не
// ходит, свой мотор через шлюз остаётся как был.
//
// Контракт тот же, что у портала, Сабантуя и Казанской (один стандарт дешевле
// трёх разных): POST /api/ingest/posts, заголовок X-Gateway-Key (или Bearer),
// ключ KULTURA_INGEST_KEY грантом в комнату Сарафана. Тело:
// {
//   vkPostId:  string — обязателен, ключ идемпотентности ("-12345_678")
//   sourceUrl: string — обязателен, ссылка на оригинал (атрибуция)
//   title?:    string — нет — первая строка текста, совсем пусто — «Запись от <дата>»
//   text?:     string — plain text поста, абзацы через \n
//   section?:  string — slug учреждения (чей материал); неизвестный — warning +
//                       сохраняется в текстовое поле category для редактора
//   date?:     string — ISO-дата оригинального поста; нет — время доставки + warning
//   images?:   Array<string | { url, alt? }> — перекладываем к себе сразу
//                       (ссылки ВК-CDN протухают, G56/G63)
//   videos?:   Array<string | { url, title? }> — не перекладываем, только ссылка
//   publish?:  boolean — публикует ТОЛЬКО с заголовком X-Publish-Key (секрет
//                       KULTURA_PUBLISH_KEY грантом setka, решение владельца
//                       03.10); без ключа — warning + черновик. Ключ доставки
//                       публиковать не умеет никогда (#124).
// }
// Ответ: { id, published } + warnings (+ created/updated для совместимости с отправителем).
// Повтор того же vkPostId не дублирует: черновик обновляется, опубликованное
// не трогается. Учреждение и рубрику при повторе не перезаписываем — после
// первой доставки они принадлежат редактору (урок #095 у портала).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExistingDoc = {
  id: number
  _status?: string | null
  institution?: number | { id: number } | null
  category?: string | null
}

export async function POST(request: Request): Promise<Response> {
  // Без секрета в env — 503 «выключен», а не «открыт».
  if (!process.env.KULTURA_INGEST_KEY) {
    return Response.json({ error: 'ingest is not configured' }, { status: 503 })
  }
  if (!secretMatches(extractGatewayKey(request), process.env.KULTURA_INGEST_KEY)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    vkPostId?: unknown
    sourceUrl?: unknown
    title?: unknown
    text?: unknown
    section?: unknown
    rubric?: unknown
    date?: unknown
    images?: unknown
    videos?: unknown
    publish?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const vkPostId = typeof body.vkPostId === 'string' ? body.vkPostId.trim() : ''
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''

  if (!vkPostId) return Response.json({ error: 'vkPostId is required' }, { status: 400 })
  if (!sourceUrl) return Response.json({ error: 'sourceUrl is required' }, { status: 400 })
  if (!rawTitle && !text) return Response.json({ error: 'title or text is required' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const warnings: string[] = []

  // Право публикации — отдельным секретом (#124): сверяем X-Publish-Key с
  // KULTURA_INGEST_KEY-независимым KULTURA_PUBLISH_KEY. Незаданный секрет =
  // публикация выключена (secretMatches на пустом env — false), приёмник
  // при этом работает как раньше — черновиками.
  const status = resolvePublish(
    body.publish,
    secretMatches(extractPublishKey(request), process.env.KULTURA_PUBLISH_KEY),
    warnings,
  )
  const published = status === 'published'

  const title = deriveTitle(rawTitle, text, nowIso)
  const dateIso = resolveDate(body.date, nowIso, warnings)
  const videos = normalizeVideos(body.videos, warnings)

  const payload = await getPayload({ config })

  // Чей материал: section — slug учреждения. Неизвестный slug — не отказ
  // (черновик всё равно смотрит человек), но сигналим: промпт классификатора
  // чинить по этому warning. Догадку сохраняем в category, чтобы не потерять.
  const sectionRaw = typeof body.section === 'string' ? body.section.trim() : typeof body.rubric === 'string' ? body.rubric.trim() : ''
  let institutionId: number | undefined
  let category: string | undefined
  if (sectionRaw) {
    const found = await payload.find({
      collection: 'institutions',
      where: { slug: { equals: sectionRaw } },
      depth: 0,
      limit: 1,
    })
    const doc = found.docs[0] as unknown as { id: number } | undefined
    if (doc) institutionId = doc.id
    else {
      warnings.push(`unknown section: ${sectionRaw}`)
      category = sectionRaw
    }
  }

  // Идемпотентность по vkUid. Намеренно БЕЗ draft-флага (класс G320): чтение
  // таблицы версий отдало бы _status черновика поверх опубликованного, и решение
  // «не трогать опубликованное» приняло бы его за черновик.
  const findExisting = async (): Promise<ExistingDoc | undefined> => {
    const res = await payload.find({
      collection: 'posts',
      where: { vkUid: { equals: vkPostId } },
      depth: 0,
      limit: 1,
    })
    return res.docs[0] as unknown as ExistingDoc | undefined
  }

  const existing = await findExisting()
  if (existing && existing._status === 'published') {
    // Опубликованное руками автоматика не перетирает.
    return Response.json({ created: false, updated: false, id: existing.id, warnings }, { status: 200 })
  }

  // Медиа перекладываем к себе сразу, а не храним ссылки ВК-CDN.
  const incoming = Array.isArray(body.images) ? (body.images as IncomingImage[]).slice(0, MAX_IMAGES) : []
  if (Array.isArray(body.images) && body.images.length > MAX_IMAGES) {
    warnings.push(`images truncated to ${MAX_IMAGES}`)
  }
  const mediaIds: number[] = []
  for (const [index, image] of incoming.entries()) {
    const url = typeof image === 'string' ? image : image?.url
    // Запасной alt — НЕ заголовок записи. До 02.10 здесь стояло `?? title`, и
    // это была тихая утечка: alt ложится в Media, а её чтение открыто всем, так
    // что `GET /api/media` выдавал заголовки ещё не опубликованных черновиков
    // (аудит #057). Описание изображения — украшение, а не носитель смысла;
    // страница новости всё равно подставляет своё.
    const alt = typeof image === 'object' && image?.alt ? image.alt : ''
    if (!url || !/^https?:\/\//i.test(url)) {
      warnings.push(`image ${index}: invalid url`)
      continue
    }
    const id = await uploadPhoto(payload, url, alt, (message) => warnings.push(`image ${index}: ${message}`))
    if (id !== null) mediaIds.push(id)
  }

  const data = buildPostData({ title, text, vkUid: vkPostId, sourceUrl, dateIso, institutionId, category, mediaIds, videos, status })

  if (existing) {
    // Черновик уже есть — обновляем содержимое (правки поста в ВК доезжают).
    // Учреждение и рубрику при повторе НЕ перезаписываем: классификатор даёт
    // догадку, дальше поле принадлежит редактору. Пустые — дозаполняем.
    // Медиа без новых файлов не трогаем (иначе повтор без картинок снёс бы их).
    const keptInstitution = existing.institution
      ? typeof existing.institution === 'number'
        ? existing.institution
        : existing.institution.id
      : institutionId
    const updated = await payload.update({
      collection: 'posts',
      id: existing.id,
      data: {
        ...data,
        institution: keptInstitution ?? undefined,
        category: existing.category || category,
        ...(mediaIds.length ? {} : { cover: undefined, gallery: undefined }),
      },
      draft: !published,
      context: { disableRevalidate: true },
    })
    return Response.json({ created: false, updated: true, published, id: updated.id, warnings }, { status: 200 })
  }

  try {
    const created = await payload.create({
      collection: 'posts',
      data,
      draft: !published,
      context: { disableRevalidate: true },
    })
    return Response.json({ created: true, published, id: created.id, warnings }, { status: 201 })
  } catch (err) {
    // Гонка двух параллельных доставок одного vkPostId: обе прошли мимо
    // find, вторая упёрлась в unique. Не 500, а второй заход в обновление.
    if (/unique|duplicate|уникал/i.test((err as Error)?.message ?? '')) {
      const retry = await findExisting()
      if (retry && retry._status !== 'published') {
        const updated = await payload.update({
          collection: 'posts',
          id: retry.id,
          data,
          draft: !published,
          context: { disableRevalidate: true },
        })
        return Response.json({ created: false, updated: true, published, id: updated.id, warnings }, { status: 200 })
      }
    }
    throw err
  }
}

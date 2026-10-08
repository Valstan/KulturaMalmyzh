import config from '@payload-config'
import { getPayload } from 'payload'

import { retitlePosters } from '../src/lib/posts/posters'

// Гейт операции «афиши и пустые» на живой БД.
//
// Ключевые свойства — переименовать ровно афишу и удалить ровно пустое:
// одно фото без текста получает «Афиша от <дата> · <дом>»; пустое без фото исчезает;
// альбом, видео, текст и обычный заголовок остаются нетронутыми. Юнитами
// проверяется разбор; здесь — что Payload пишет нужное и оставляет чужое.

const SLUG = 'selftest-posters-house'

// PNG 1x1: настоящее медиа для ветки «одно фото», без сети и c CDN.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const lexical = (text: string) => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text }],
      },
    ],
  },
})

const main = async () => {
  const payload = await getPayload({ config })
  const problems: string[] = []
  const ctx = { disableRevalidate: true }
  const createdPostIds: number[] = []
  const createdMediaIds: number[] = []

  const institution = await payload.create({
    collection: 'institutions',
    context: ctx,
    data: {
      title: 'Самотестовый ДК (афиши)',
      shortTitle: 'Самотест-афиша',
      settlement: 'с. Самотестово',
      slug: SLUG,
      _status: 'published',
    },
  })

  const mkMedia = async (): Promise<number> => {
    const doc = await payload.create({
      collection: 'media',
      context: ctx,
      data: { alt: 'самотестовое фото' },
      file: { data: PIXEL, name: 'selftest-poster.png', mimetype: 'image/png', size: PIXEL.length },
    })
    createdMediaIds.push(doc.id)
    return doc.id
  }

  const mk = async (
    index: number,
    title: string,
    text: string,
    media?: { cover?: number; gallery?: number[] },
  ): Promise<number> => {
    const doc = await payload.create({
      collection: 'posts',
      context: ctx,
      data: {
        title,
        slug: `selftest-posters-${index}`,
        date: '2026-06-01T10:00:00.000Z',
        type: 'news',
        source: 'manual',
        institution: institution.id,
        vkUid: `-777666555_${8000 + index}`,
        sourceUrl: `https://vk.com/wall-777666555_${8000 + index}`,
        content: lexical(text),
        ...(media?.cover ? { cover: media.cover } : {}),
        ...(media?.gallery ? { gallery: media.gallery.map((image) => ({ image })) } : {}),
        _status: 'published',
      },
    })
    createdPostIds.push(doc.id)
    return doc.id
  }

  const cover = await mkMedia()
  const extra = await mkMedia()
  // Афиша: одно фото без текста — переименуется.
  const poster = await mk(1, 'Самотест-ДК: запись от 2026-06-01', '', { cover })
  // Пустая: ни текста, ни фото — удалится.
  const empty = await mk(2, 'Запись от 2026-06-01', '')
  // Альбом: два фото без текста — остаётся как есть.
  const album = await mk(3, 'Самотест-ДК: запись от 2026-06-01', '', { cover: extra, gallery: [cover] })
  // Текст есть, заголовок-пустышка — не наше дело.
  const withText = await mk(4, 'Запись от 2026-06-01', 'Текст дописал редактор')
  // Обычная новость без текста — не кандидат вовсе.
  const normal = await mk(5, 'Самотест: концерт в клубе', '')

  const dry = await retitlePosters(payload, { dry: true })
  const count = async (id: number) =>
    (await payload.count({ collection: 'posts', where: { id: { equals: id } } })).totalDocs
  const titleOf = async (id: number) =>
    (await payload.findByID({ collection: 'posts', id, depth: 0 }))?.title

  if ((await count(empty)) !== 1) problems.push('сухой прогон удалил запись')
  if ((await titleOf(poster)) !== 'Самотест-ДК: запись от 2026-06-01') {
    problems.push('сухой прогон переименовал запись')
  }
  if (dry.posters < 1 || dry.empties < 1) {
    problems.push(`сухой прогон насчитал афиш ${dry.posters}, пустых ${dry.empties} — ждали хотя бы по одной`)
  }

  const live = await retitlePosters(payload, { dry: false })
  if (!live.ok) problems.push(`боевой прогон не ok: ${live.messages.join('; ')}`)

  if ((await titleOf(poster)) !== 'Афиша от 2026-06-01 · Самотест-афиша') {
    problems.push(`афиша не переименована: «${await titleOf(poster)}»`)
  }
  if ((await count(empty)) !== 0) problems.push('пустая запись без фото не удалена')
  if ((await count(album)) !== 1) problems.push('альбом из двух фото тронут (нельзя)')
  if ((await titleOf(withText)) !== 'Запись от 2026-06-01') {
    problems.push('запись с текстом переименована (нельзя)')
  }
  if ((await count(normal)) !== 1) problems.push('обычная новость пропала')
  if (live.postersRetitled < 1) problems.push(`афиш переименовано ${live.postersRetitled}, ждали хотя бы одну`)
  if (live.emptiesRemoved < 1) problems.push(`пустых удалено ${live.emptiesRemoved}, ждали хотя бы одну`)

  for (const id of createdPostIds) {
    await payload.delete({ collection: 'posts', id, context: ctx }).catch(() => undefined)
  }
  for (const id of createdMediaIds) {
    await payload.delete({ collection: 'media', id, context: ctx }).catch(() => undefined)
  }
  await payload.delete({ collection: 'institutions', id: institution.id, context: ctx })

  if (problems.length > 0) {
    console.error('::error::проверка афиш и пустых не прошла:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  console.log(
    `афиши и пустые ок: сухой не пишет, афиша переименована, пустая удалена, альбом/текст/обычная целы (афиш было ${dry.posters}, пустых ${dry.empties})`,
  )
  process.exit(0)
}

await main()

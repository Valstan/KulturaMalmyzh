import config from '@payload-config'
import { getPayload } from 'payload'

import {
  CI_HEAD_MEDIA_ALT,
  CI_HEAD_MEDIA_FILENAME,
  CI_INSTITUTION_SLUG,
  CI_INSTITUTION_TITLE,
  CI_INSTITUTION_TITLE_UPDATED,
  CI_EVENT_SLUG,
  CI_EVENT_TITLE,
  ciEventDate,
  CI_PAGE_SLUG,
  CI_PAGE_TITLE,
  CI_DRAFT_INSTITUTION_SLUG,
  CI_DRAFT_INSTITUTION_TITLE,
  CI_DRAFT_POST_SLUG,
  CI_DRAFT_POST_TITLE,
  CI_CYRILLIC_POST_SLUG,
  CI_CYRILLIC_POST_TEXT,
  CI_CYRILLIC_POST_TITLE,
  CI_POST_SLUG,
  CI_POST_TITLE,
  CI_POST_TITLE_UPDATED,
} from './ci-fixtures'

// Минимальный сид для гейта CI. Запускается `pnpm payload run scripts/seed-ci.ts`
// ПОСЛЕ наката миграций и ДО сборки, на эфемерной БД раннера. На прод не едет.
//
// Зачем он вообще нужен, если гейт и так собирается:
//
// 1. Пререндер на пустой БД не выполняет ни одной ветки рендера с данными —
//    ошибки на реальных документах в сборке не ловятся (класс G230).
// 2. Схема, накатанная миграцией, проверяется только тем, что через неё
//    реально ходит. Поэтому сид обязан **обновлять уже существующий документ**,
//    а не только создавать: у Калинино ручная миграция потеряла колонки, весь
//    импорт был созданием, всё было зелёным, и дыра прожила 18 дней (G231).
//    Создание и обновление ходят по разным таблицам — проверяем оба пути.
//
// Документы публикуются явным `_status: 'published'`: у коллекций включены
// drafts, и без этого поля документ остаётся черновиком, а публичный рендер его
// не видит (G223 — состояние берётся из `data._status`, а не из `draft: false`).

const ctx = { disableRevalidate: true }

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

  // Учреждение создаётся первым: на него ссылается новость, и связь тоже должна
  // пройти по накатанной схеме — колонка institution_id есть и в `posts`,
  // и в `_posts_v`, а теряются такие колонки обычно именно в versions-таблице.
  const institution = await payload.create({
    collection: 'institutions',
    context: ctx,
    data: {
      title: CI_INSTITUTION_TITLE,
      slug: CI_INSTITUTION_SLUG,
      shortTitle: 'CI',
      settlement: 'Малмыж',
      isHead: true,
      _status: 'published',
    },
  })

  console.log(`шаг 1/6 — создание дома культуры: ок (id ${institution.id})`)

  const institutionUpdated = await payload.update({
    collection: 'institutions',
    id: institution.id,
    context: ctx,
    data: {
      title: CI_INSTITUTION_TITLE_UPDATED,
      _status: 'published',
    },
  })

  console.log('шаг 2/6 — обновление дома культуры: ок')

  const page = await payload.create({
    collection: 'pages',
    context: ctx,
    data: {
      title: CI_PAGE_TITLE,
      slug: CI_PAGE_SLUG,
      _status: 'published',
    },
  })

  console.log(`шаг 3/6 — создание страницы: ок (id ${page.id})`)

  const post = await payload.create({
    collection: 'posts',
    context: ctx,
    data: {
      title: CI_POST_TITLE,
      slug: CI_POST_SLUG,
      date: '2026-01-01T00:00:00.000Z',
      category: 'CI',
      institution: institution.id,
      type: 'event',
      source: 'manual',
      _status: 'published',
    },
  })

  console.log(`шаг 4/6 — создание новости со связью на дом культуры: ок (id ${post.id})`)

  // Путь ОБНОВЛЕНИЯ — то, ради чего сид и стоит в гейте.
  const updated = await payload.update({
    collection: 'posts',
    id: post.id,
    context: ctx,
    data: {
      title: CI_POST_TITLE_UPDATED,
      _status: 'published',
    },
  })

  console.log('шаг 5/6 — обновление существующей новости: ок')

  const event = await payload.create({
    collection: 'posts',
    context: ctx,
    data: {
      title: CI_EVENT_TITLE,
      slug: CI_EVENT_SLUG,
      date: ciEventDate(),
      institution: institution.id,
      type: 'event',
      source: 'manual',
      _status: 'published',
    },
  })

  console.log(`шаг 6/9 — создание предстоящей афиши: ок (id ${event.id})`)

  // Черновики — специально, чтобы негативные проверки e2e имели что не находить.
  // Пока в базе гейта лежало только опубликованное, тест «черновик не виден» был
  // бы зелёным и при полностью снятом фильтре `_status`.
  const draftInstitution = await payload.create({
    collection: 'institutions',
    context: ctx,
    data: {
      title: CI_DRAFT_INSTITUTION_TITLE,
      shortTitle: 'CI-черновик',
      settlement: 'CI',
      slug: CI_DRAFT_INSTITUTION_SLUG,
      _status: 'draft',
    },
    // draft: true обязателен при создании черновика: без него Payload требует
    // полный набор required-полей опубликованного документа.
    draft: true,
  })

  const draftPost = await payload.create({
    collection: 'posts',
    context: ctx,
    data: {
      title: CI_DRAFT_POST_TITLE,
      slug: CI_DRAFT_POST_SLUG,
      date: new Date().toISOString(),
      institution: institution.id,
      source: 'manual',
      _status: 'draft',
    },
    draft: true,
  })

  console.log(
    `шаг 7/9 — черновики для негативных проверок: ок (учреждение ${draftInstitution.id}, новость ${draftPost.id})`,
  )

  // Кириллический адрес: проверяет, что метаданные декодируют `params.slug`.
  // Текст кладём непустой — e2e сверяет, что description пришёл ИЗ ЗАПИСИ,
  // а не из общего layout (иначе тест зелен и при сломанном декодировании).
  const cyrillicPost = await payload.create({
    collection: 'posts',
    context: ctx,
    data: {
      title: CI_CYRILLIC_POST_TITLE,
      slug: CI_CYRILLIC_POST_SLUG,
      date: '2026-01-02T00:00:00.000Z',
      institution: institution.id,
      type: 'news',
      source: 'manual',
      content: lexical(CI_CYRILLIC_POST_TEXT),
      _status: 'published',
    },
  })

  console.log(`шаг 8/9 — новость с кириллическим адресом: ок (id ${cyrillicPost.id})`)

  // Настоящий медиафайл для проверки HEAD (Д1): e2e открывает
  // /api/media/file/<имя> методами GET и HEAD. PNG 1x1 — без сети и CDN.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const headMedia = await payload.create({
    collection: 'media',
    context: ctx,
    data: { alt: CI_HEAD_MEDIA_ALT },
    file: {
      data: pixel,
      name: CI_HEAD_MEDIA_FILENAME,
      mimetype: 'image/png',
      size: pixel.length,
    },
  })

  console.log(`шаг 9/9 — медиа для проверки HEAD: ок (id ${headMedia.id})`)

  // Проверяем результат фактом, а не отсутствием исключения: сид, который
  // «отработал» и ничего не создал, оставил бы пререндер таким же пустым.
  const institutions = await payload.count({ collection: 'institutions' })
  const pages = await payload.count({ collection: 'pages' })
  const posts = await payload.count({ collection: 'posts' })
  const published = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    limit: 0,
  })

  // Связь читается обратно с depth: 1 — только так видно, что запрос по
  // relationship действительно ходит через накатанную схему, а не «сохранилось и ладно».
  const linked = await payload.find({
    collection: 'posts',
    where: { institution: { equals: institution.id }, _status: { equals: 'published' } },
    depth: 1,
    limit: 10,
  })

  const problems: string[] = []
  if (institutions.totalDocs < 1)
    problems.push(`домов культуры создано ${institutions.totalDocs}, ожидался минимум 1`)
  if (institutionUpdated.title !== CI_INSTITUTION_TITLE_UPDATED)
    problems.push('обновление дома культуры не сохранилось')
  if (linked.totalDocs < 1) problems.push('выборка новостей по связи с домом культуры пуста')
  if (linked.totalDocs < 2) problems.push('по связи с домом культуры видно меньше двух материалов')
  const upcoming = await payload.find({
    collection: 'posts',
    where: {
      _status: { equals: 'published' },
      type: { equals: 'event' },
      date: { greater_than_equal: new Date().toISOString() },
    },
    limit: 0,
  })
  if (upcoming.totalDocs < 1)
    problems.push('предстоящих афиш не найдено — на главной блок событий останется пустым')
  if (pages.totalDocs < 1) problems.push(`страниц создано ${pages.totalDocs}, ожидалась минимум 1`)
  if (posts.totalDocs < 1) problems.push(`новостей создано ${posts.totalDocs}, ожидалась минимум 1`)
  if (published.totalDocs < 1) problems.push('ни одна новость не опубликована — пререндер снова пустой')
  if (updated.title !== CI_POST_TITLE_UPDATED) problems.push('обновление не сохранилось')
  // Slug'и фиксированные — по ним e2e открывает страницы в браузере. Хук
  // beforeValidate мог бы их переписать, и тогда браузерный гейт получил бы 404,
  // неотличимый от поломки роутера.
  if (page.slug !== CI_PAGE_SLUG) problems.push(`slug страницы «${page.slug}», ожидался «${CI_PAGE_SLUG}»`)
  if (updated.slug !== CI_POST_SLUG) problems.push(`slug новости «${updated.slug}», ожидался «${CI_POST_SLUG}»`)
  if (cyrillicPost.slug !== CI_CYRILLIC_POST_SLUG)
    problems.push(`slug кириллической новости «${cyrillicPost.slug}», ожидался «${CI_CYRILLIC_POST_SLUG}»`)
  // Имя файла фиксировано — по нему e2e открывает /api/media/file/<имя>.
  // Переименование на стороне Payload дало бы e2e 404, неотличимый от Д1.
  if (headMedia.filename !== CI_HEAD_MEDIA_FILENAME)
    problems.push(`имя медиафайла «${headMedia.filename}», ожидалось «${CI_HEAD_MEDIA_FILENAME}»`)

  if (problems.length > 0) {
    console.error('::error::сид отработал, но результат не тот:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  console.log(
    `сид ок: домов культуры ${institutions.totalDocs}, страниц ${pages.totalDocs}, ` +
      `новостей ${posts.totalDocs} (опубликовано ${published.totalDocs}); ` +
      'создание, обновление и выборка по связи прошли',
  )
  process.exit(0)
}

await main()

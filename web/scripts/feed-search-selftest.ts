import config from '@payload-config'
import { getPayload } from 'payload'

import { getFeedPage } from '../src/lib/feed'

// Гейт поиска по ленте: то, что юнитами не видно, — как `like` ведёт себя на
// живой Postgres, в частности с кириллицей в разных регистрах. Локаль базы на
// проде и на раннере может отличаться, и предполагать регистронезависимость
// нельзя: здесь она проверяется фактом, а не доверием к адаптеру.
//
// Данные свои, уборка за собой обязательна — база гейта общая с остальными шагами.

const SLUG = 'selftest-search-house'

const main = async () => {
  const payload = await getPayload({ config })
  const problems: string[] = []
  const ctx = { disableRevalidate: true }
  const createdPostIds: number[] = []

  const institution = await payload.create({
    collection: 'institutions',
    context: ctx,
    data: {
      title: 'Самотестовый ДК (поиск)',
      shortTitle: 'Самотест-поиск',
      settlement: 'с. Самотестово',
      slug: SLUG,
      _status: 'published',
    },
  })

  const mk = async (
    index: number,
    title: string,
    status: 'draft' | 'published' = 'published',
  ): Promise<number> => {
    const vkUid = `-555444333_${7000 + index}`
    const doc = await payload.create({
      collection: 'posts',
      context: ctx,
      data: {
        title,
        slug: `selftest-search-${index}`,
        date: '2026-03-01T10:00:00.000Z',
        type: 'news',
        source: 'manual',
        institution: institution.id,
        vkUid,
        sourceUrl: `https://vk.com/wall${vkUid}`,
        _status: status,
      },
      ...(status === 'draft' ? { draft: true } : {}),
    })
    createdPostIds.push(doc.id)
    return doc.id
  }

  await mk(1, 'Самотест ПОИСК Концерт в клубе')
  await mk(2, 'Самотест поиск ярмарки мастеров')
  await mk(3, 'Самотест про рыбалку без совпадений')
  await mk(4, 'Самотест поиск черновик-невидимка', 'draft')
  await mk(5, 'Самотест скидка 100% на всё')

  const titles = async (q: string): Promise<string[]> =>
    (await getFeedPage({ q, limit: 50 })).docs.map((doc) => doc.title ?? '')

  const foundLower = await titles('поиск')
  for (const want of ['Самотест ПОИСК Концерт в клубе', 'Самотест поиск ярмарки мастеров']) {
    if (!foundLower.includes(want)) problems.push(`q=поиск не нашёл «${want}»`)
  }
  if (foundLower.some((t) => t.includes('рыбалку')))
    problems.push('q=поиск нашёл постороннюю запись')
  if (foundLower.some((t) => t.includes('невидимка')))
    problems.push('q=поиск отдал черновик')

  // Регистронезависимость кириллицы — фактом на живой базе, а не по документации
  // адаптера: локаль продовой базы могла бы её и не дать.
  const foundUpper = await titles('ПОИСК')
  if (foundUpper.length !== foundLower.length)
    problems.push(`q=ПОИСК нашёл ${foundUpper.length}, а q=поиск — ${foundLower.length}`)

  // Два слова — обе обязаны быть (AND), а не «хоть одна».
  const both = await titles('самотест концерт')
  if (both.length !== 1 || !both[0].includes('Концерт'))
    problems.push(`q=самотест концерт дал не ровно одну запись: ${both.join(' | ')}`)

  // Процент ищется буквально: иначе запрос из `%` нашёл бы вообще всё.
  const pct = await titles('100%')
  if (pct.length !== 1 || !pct[0].includes('100%'))
    problems.push(`q=100% дал не ровно запись про скидку: ${pct.join(' | ')}`)
  const pctOnly = await titles('%')
  if (pctOnly.some((t) => !t.includes('%')))
    problems.push('q=% нашёл записи без знака процента')

  for (const id of createdPostIds) {
    await payload.delete({ collection: 'posts', id, context: ctx }).catch(() => undefined)
  }
  await payload.delete({ collection: 'institutions', id: institution.id, context: ctx })

  if (problems.length > 0) {
    console.error('::error::проверка поиска по ленте не прошла:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  console.log('поиск по ленте ок: регистр не важен, AND по словам, % буквальный, черновики не отдаются')
  process.exit(0)
}

await main()

import { describe, expect, it } from 'vitest'

import {
  FEED_MAX_PAGE_SIZE,
  FEED_PAGE_SIZE,
  emptyFeedPage,
  escapeLike,
  feedWhere,
  mentionWhere,
  mentionedByStems,
  mergeFeedDocs,
  parseFeedQuery,
  searchTokens,
  toFeedCard,
} from './feedShape'
import type { FeedCard } from './feedShape'

type FeedCardLike = Pick<FeedCard, 'id'>

// Лента: разбор запроса, обрезка записи до карточки, условие выборки. БД и HTTP
// — в selftest гейта и в e2e.
describe('parseFeedQuery', () => {
  const parse = (query: string) => parseFeedQuery(new URLSearchParams(query))

  it('по умолчанию — первая страница по 20', () => {
    expect(parse('')).toEqual({ page: 1, limit: FEED_PAGE_SIZE, institutionSlug: null, type: null, q: null })
  })

  it('номер страницы и размер берутся из запроса', () => {
    expect(parse('page=3&limit=20').page).toBe(3)
    expect(parse('page=3&limit=20').limit).toBe(20)
  })

  it('мусор в параметрах не ломает и не съедает выборку', () => {
    expect(parse('page=abc').page).toBe(1)
    expect(parse('page=-4').page).toBe(1)
    expect(parse('limit=99999').limit).toBe(FEED_MAX_PAGE_SIZE)
    expect(parse('limit=0').limit).toBe(1)
  })

  it('слаг дома культуры — только строгий latin-lowercase, иначе игнор', () => {
    expect(parse('institution=rckd').institutionSlug).toBe('rckd')
    expect(parse('institution=nosly').institutionSlug).toBe('nosly')
    expect(parse('institution=Rckd').institutionSlug).toBeNull()
    expect(parse("institution=' OR 1=1").institutionSlug).toBeNull()
    expect(parse('institution=%2Fdk').institutionSlug).toBeNull()
  })

  it('вид записи — только news или event, иначе никакой фильтрации', () => {
    expect(parse('type=event').type).toBe('event')
    expect(parse('type=news').type).toBe('news')
    expect(parse('type=afisha').type).toBeNull()
  })

  it('поиск: пробелы по краям режутся, пустой — null (обычная лента)', () => {
    expect(parse('q=концерт').q).toBe('концерт')
    expect(parse('q=%20%20сабантуй%20%20').q).toBe('сабантуй')
    expect(parse('q=%20%20').q).toBeNull()
    expect(parse('').q).toBeNull()
  })

  it('поиск режется по длине, а не роняет запрос', () => {
    expect(parse(`q=${'а'.repeat(200)}`).q).toHaveLength(64)
  })
})

describe('feedWhere', () => {
  it('без фильтров — только опубликованное', () => {
    expect(feedWhere()).toEqual({ _status: { equals: 'published' } })
  })

  it('дом и вид склеиваются в and, а не затирают статус', () => {
    expect(feedWhere(7, 'event')).toEqual({
      and: [
        { _status: { equals: 'published' } },
        { institution: { equals: 7 } },
        { type: { equals: 'event' } },
      ],
    })
  })

  it('неизвестный дом (null) не превращается в «без дома» — фильтр просто не ставится', () => {
    // Само по себе условие «без фильтра» — это общая лента. Именно поэтому
    // `feed.ts` на несуществующий слаг отдаёт пустую страницу, а не зовёт
    // `feedWhere(null)`: иначе раздел отдавал бы чужие записи.
    expect(feedWhere(null, null)).toEqual({ _status: { equals: 'published' } })
  })

  it('поиск добавляется условием по заголовку, статус не затирается', () => {
    expect(feedWhere(undefined, null, 'концерт')).toEqual({
      and: [{ _status: { equals: 'published' } }, { title: { like: '%концерт%' } }],
    })
  })

  it('каждое слово обязательно (AND), а не «хоть одно»', () => {
    expect(feedWhere(undefined, null, 'концерт Китяк')).toEqual({
      and: [
        { _status: { equals: 'published' } },
        { title: { like: '%концерт%' } },
        { title: { like: '%Китяк%' } },
      ],
    })
  })

  it('пустой поиск фильтра не ставит', () => {
    expect(feedWhere(undefined, null, null)).toEqual({ _status: { equals: 'published' } })
    expect(feedWhere(undefined, null, '   ')).toEqual({ _status: { equals: 'published' } })
  })
})

describe('searchTokens', () => {
  it('режет по пробелам, пустые отбрасывает, больше пяти не берёт', () => {
    expect(searchTokens('концерт  Китяк')).toEqual(['концерт', 'Китяк'])
    expect(searchTokens('  ')).toEqual([])
    expect(searchTokens(null)).toEqual([])
    expect(searchTokens('а б в г д е ж')).toHaveLength(5)
  })

  it('длинные слова режутся, короткие идут как есть', () => {
    expect(searchTokens('а')).toEqual(['а'])
    expect(searchTokens('б'.repeat(40))).toEqual(['б'.repeat(32)])
  })
})

describe('escapeLike', () => {
  it('% и _ ищутся буквально, а не как шаблоны', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
    expect(escapeLike('концерт')).toBe('концерт')
  })

  it('запрос из одного % не превращается в «найди всё»', () => {
    expect(searchTokens('%')).toEqual(['\\%'])
  })
})

describe('emptyFeedPage', () => {
  it('пусто и без «ещё что-то» — догруживать нечего', () => {
    expect(emptyFeedPage()).toEqual({ docs: [], page: 1, totalPages: 1, totalDocs: 0, hasMore: false })
  })

  it('номер страницы сохраняется, чтобы клиент не сбился', () => {
    expect(emptyFeedPage(4).page).toBe(4)
  })
})

describe('mergeFeedDocs', () => {
  const card = (id: number): FeedCardLike => ({ id })

  it('просто дописывает следующую страницу', () => {
    expect(mergeFeedDocs([card(1), card(2)], [card(3), card(4)])).toEqual([
      card(1),
      card(2),
      card(3),
      card(4),
    ])
  })

  it('запись, попавшая на границу страниц, не показывается дважды', () => {
    // Между запросами вышла новая запись — сдвинутая по дате строка закрывает
    // хвост первой страницы и начинает вторую.
    expect(mergeFeedDocs([card(1), card(2), card(3)], [card(3), card(4)])).toEqual([
      card(1),
      card(2),
      card(3),
      card(4),
    ])
  })

  it('пустая страница ничего не меняет (ссылка не должна меняться)', () => {
    const prev = [card(1)]
    expect(mergeFeedDocs(prev, [])).toBe(prev)
  })
})

describe('toFeedCard', () => {  const doc = {
    id: 12,
    title: 'Праздник',
    slug: 'prazdnik',
    date: '2026-08-20T10:00:00.000Z',
    publishedAt: '2026-08-20T10:00:00.000Z',
    type: 'news',
    category: 'Праздники',
    content: { root: { children: [{ type: 'text', text: 'длинный текст' }] } },
    cover: {
      id: 5,
      url: '/api/media/file/original.jpg',
      width: 1200,
      height: 900,
      sizes: { card: { url: '/api/media/file/card.jpg', width: 768, height: 576 } },
    },
    institution: {
      id: 3,
      title: 'Дом культуры',
      shortTitle: 'РЦКД',
      slug: 'rckd',
      website: 'https://example.test/',
      description: 'не нужен в карточке',
      content: { root: { children: [] } },
    },
  }

  it('берёт нужные поля и уменьшенную копию обложки', () => {
    const card = toFeedCard(doc)
    expect(card.id).toBe(12)
    expect(card.title).toBe('Праздник')
    expect(card.category).toBe('Праздники')
    expect(card.cover?.sizes?.card?.url).toBe('/api/media/file/card.jpg')
    expect(card.cover?.sizes?.card?.width).toBe(768)
    expect(card.institution?.shortTitle).toBe('РЦКД')
  })

  it('текст записи и текст карточки в ответ не попадают', () => {
    const card = toFeedCard(doc) as unknown as Record<string, unknown>
    expect(card['content']).toBeUndefined()
    const institution = card['institution'] as Record<string, unknown>
    expect(institution['content']).toBeUndefined()
    expect(institution['description']).toBeUndefined()
  })

  it('обложка-идентификатор (depth: 0) не превращается в превью', () => {
    const card = toFeedCard({ id: 1, slug: 'a', cover: 5 })
    expect(card.cover).toBeNull()
  })

  it('мусор и null переживаются без исключения', () => {
    expect(toFeedCard(null).cover).toBeNull()
    expect(toFeedCard(null).institution).toBeNull()
    expect(toFeedCard({ id: 2, title: 42 }).title).toBeNull()
  })
})

describe('mentionWhere', () => {
  it('каждая основа — отдельное условие по заголовку, все они обязательны', () => {
    expect(mentionWhere(['мал', 'китя'])).toEqual({
      and: [
        { _status: { equals: 'published' } },
        { title: { like: '%мал%' } },
        { title: { like: '%китя%' } },
      ],
    })
  })

  it('вид записи добавляется третьим условием', () => {
    expect(mentionWhere(['носл'], 'event')).toEqual({
      and: [{ _status: { equals: 'published' } }, { title: { like: '%носл%' } }, { type: { equals: 'event' } }],
    })
  })
})

describe('mentionedByStems', () => {
  it('слово с основой в начале считается упоминанием (русские падежи)', () => {
    expect(mentionedByStems('Артисты ДК выступили в деревне Нослы', ['нос'])).toBe(true)
    expect(mentionedByStems('«Девятая пятница» в Дерюшево', ['дерюш'])).toBe(true)
    expect(mentionedByStems('Концерт к Дню пограничника д. Малого Китяка', ['мал', 'китя'])).toBe(true)
  })

  it('одна общая часть не считается упоминанием другого места', () => {
    // Ключевая проверка: «Малый Китяк» и «Большой Китяк» делят слово «Китяк».
    expect(mentionedByStems('Праздничный концерт в Большой Китяк', ['мал', 'китя'])).toBe(false)
    expect(mentionedByStems('Концерт в д. Малый Китяк', ['мал', 'китя'])).toBe(true)
  })

  it('основа должна быть началом слова, а не хвостом', () => {
    expect(mentionedByStems('Праздник в Калинино', ['носл'])).toBe(false)
    expect(mentionedByStems('Концерт без названия места', ['дерюш'])).toBe(false)
  })

  it('пустые основы или текст — не совпадение (иначе раздел показал бы всё подряд)', () => {
    expect(mentionedByStems('любой заголовок', [])).toBe(false)
    expect(mentionedByStems('', ['носл'])).toBe(false)
    expect(mentionedByStems(null, ['носл'])).toBe(false)
  })
})
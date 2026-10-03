import { describe, expect, it } from 'vitest'

import {
  buildPostData,
  deriveTitle,
  extractGatewayKey,
  extractPublishKey,
  normalizeVideos,
  resolveDate,
  resolvePublish,
  secretMatches,
} from './ingest'

// Первый vitest приёмника (мандат 29.09): чистая логика без БД — ключ, дата,
// видео, заголовок и тело документа. Маршрут (сеть + Payload) проверяется
// пробой с бокса после деплоя: без ключа 401.
describe('secretMatches', () => {
  it('свой ключ проходит, чужой — нет', () => {
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abd', 'abc')).toBe(false)
  })

  it('пустой env — «никого не пускать», а не «пускать всех»', () => {
    expect(secretMatches('abc', undefined)).toBe(false)
    expect(secretMatches('', undefined)).toBe(false)
    expect(secretMatches('', 'abc')).toBe(false)
  })

  it('разная длина — отказ без исключения', () => {
    expect(secretMatches('ab', 'abc')).toBe(false)
  })
})

describe('extractGatewayKey', () => {
  it('берёт X-Gateway-Key', () => {
    const req = new Request('http://x/', { headers: { 'x-gateway-key': 'k1' } })
    expect(extractGatewayKey(req)).toBe('k1')
  })

  it('понимает Bearer', () => {
    const req = new Request('http://x/', { headers: { authorization: 'Bearer k2' } })
    expect(extractGatewayKey(req)).toBe('k2')
  })

  it('без заголовков — пустая строка', () => {
    expect(extractGatewayKey(new Request('http://x/'))).toBe('')
  })
})

describe('deriveTitle', () => {
  it('явный заголовок побеждает текст', () => {
    expect(deriveTitle('Афиша', 'какой-то текст', '2026-09-30T00:00:00.000Z')).toBe('Афиша')
  })

  it('без заголовка — первая строка текста', () => {
    expect(deriveTitle('', 'Первая строка\nВторая строка', '2026-09-30T00:00:00.000Z')).toBe('Первая строка')
  })

  it('пустой текст — запасной заголовок с датой', () => {
    expect(deriveTitle('', '   ', '2026-09-30T00:00:00.000Z')).toBe('Запись от 2026-09-30')
  })
})

describe('resolveDate', () => {
  it('валидная дата проходит как есть', () => {
    const warnings: string[] = []
    expect(resolveDate('2026-09-20T10:00:00Z', '2026-09-30T00:00:00.000Z', warnings)).toBe('2026-09-20T10:00:00.000Z')
    expect(warnings).toEqual([])
  })

  it('нет даты — warning и время доставки', () => {
    const warnings: string[] = []
    expect(resolveDate(undefined, '2026-09-30T00:00:00.000Z', warnings)).toBe('2026-09-30T00:00:00.000Z')
    expect(warnings).toHaveLength(1)
  })

  it('мусор вместо даты — warning и время доставки', () => {
    const warnings: string[] = []
    expect(resolveDate('когда-то', '2026-09-30T00:00:00.000Z', warnings)).toBe('2026-09-30T00:00:00.000Z')
    expect(warnings).toHaveLength(1)
  })
})

describe('normalizeVideos', () => {
  it('строки и объекты нормализуются, мусор — в warnings', () => {
    const warnings: string[] = []
    const out = normalizeVideos(['https://vk.com/video1', { url: 'https://vk.com/video2', title: 'Фильм' }, 'ftp://x'], warnings)
    expect(out).toEqual([{ url: 'https://vk.com/video1', title: undefined }, { url: 'https://vk.com/video2', title: 'Фильм' }])
    expect(warnings).toEqual(['video 2: invalid url'])
  })

  it('не-массив — пусто без шума', () => {
    expect(normalizeVideos(undefined, [])).toEqual([])
  })

  it('больше пяти — обрезка с warning', () => {
    const warnings: string[] = []
    const out = normalizeVideos(Array.from({ length: 7 }, (_, i) => `https://vk.com/v${i}`), warnings)
    expect(out).toHaveLength(5)
    expect(warnings).toEqual(['videos truncated to 5'])
  })
})

describe('buildPostData', () => {
  const base = {
    title: 'Концерт',
    text: 'Концерт\nПриходите',
    vkUid: '-123_456',
    sourceUrl: 'https://vk.com/wall-123_456',
    dateIso: '2026-09-20T10:00:00.000Z',
    mediaIds: [] as number[],
    videos: [] as { url: string; title?: string }[],
  }

  it('черновик явно, источник vk, вид news', () => {
    const data = buildPostData(base)
    expect(data._status).toBe('draft')
    expect(data.source).toBe('vk')
    expect(data.type).toBe('news')
  })

  it('slug несёт хвост vkUid — одинаковые заголовки не схлопываются', () => {
    const a = buildPostData({ ...base, vkUid: '-123_1' })
    const b = buildPostData({ ...base, vkUid: '-123_2' })
    expect(a.slug).not.toBe(b.slug)
  })

  it('первое фото — обложка, остальные — галерея', () => {
    const data = buildPostData({ ...base, mediaIds: [11, 22, 33] })
    expect(data.cover).toBe(11)
    expect(data.gallery).toEqual([{ image: 22 }, { image: 33 }])
  })

  it('без фото — обложки нет, контент валиден', () => {
    const data = buildPostData({ ...base, text: '' })
    expect(data.cover).toBeUndefined()
    expect(data.gallery).toEqual([])
    expect(data.content.root.children).toHaveLength(1)
  })

  it('учреждение и догадка рубрики едут в свои поля', () => {
    const data = buildPostData({ ...base, institutionId: 7, category: 'kultura' })
    expect(data.institution).toBe(7)
    expect(data.category).toBe('kultura')
  })

  it('без учреждения и рубрики — поля пустые, а не мусорные', () => {
    const data = buildPostData(base)
    expect(data.institution).toBeUndefined()
    expect(data.category).toBeUndefined()
    expect(data.videos).toBeUndefined()
  })

  it('status published — документ публикуется, по умолчанию черновик', () => {
    expect(buildPostData({ ...base, status: 'published' })._status).toBe('published')
    expect(buildPostData({ ...base, status: 'draft' })._status).toBe('draft')
  })
})

describe('extractPublishKey', () => {
  it('берёт только X-Publish-Key', () => {
    const req = new Request('http://x/', { headers: { 'x-publish-key': 'p1' } })
    expect(extractPublishKey(req)).toBe('p1')
  })

  it('Bearer сюда не подходит — он занят ключом доставки', () => {
    const req = new Request('http://x/', { headers: { authorization: 'Bearer k2' } })
    expect(extractPublishKey(req)).toBe('')
  })

  it('без заголовка — пустая строка', () => {
    expect(extractPublishKey(new Request('http://x/'))).toBe('')
  })
})

describe('resolvePublish', () => {
  it('без флага — черновик без шума', () => {
    const warnings: string[] = []
    expect(resolvePublish(undefined, true, warnings)).toBe('draft')
    expect(resolvePublish(false, true, warnings)).toBe('draft')
    expect(warnings).toEqual([])
  })

  it('флаг с верным ключом — публикация', () => {
    const warnings: string[] = []
    expect(resolvePublish(true, true, warnings)).toBe('published')
    expect(warnings).toEqual([])
  })

  it('флаг без ключа — черновик с warning, доставка не теряется', () => {
    const warnings: string[] = []
    expect(resolvePublish(true, false, warnings)).toBe('draft')
    expect(warnings).toHaveLength(1)
  })
})

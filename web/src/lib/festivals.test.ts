import { describe, expect, it } from 'vitest'

import { FESTIVALS } from './festivals'

// Карточки праздников — статические данные, и ошибиться в них можно ровно одним
// способом: опечаткой в адресе. Проверка формы дешёвая и ловит именно это.
//
// Живой запрос сюда не ставим: сеть в юнит-гейте делает тест мигающим, а сайты
// праздников живут своей жизнью. То, что адрес не отдаёт редирект, проверяется
// глазами при заведении карточки — как было с Сабантуем, у которого письмо
// назвало прежнее имя домена.
describe('карточки праздников', () => {
  it('у каждой карточки есть название, адрес и читаемое имя домена', () => {
    expect(FESTIVALS.length).toBeGreaterThan(0)
    for (const f of FESTIVALS) {
      expect(f.title.trim().length, `пустое название у ${f.slug}`).toBeGreaterThan(0)
      expect(f.host.trim().length, `пустое имя домена у ${f.slug}`).toBeGreaterThan(0)
      expect(f.url, `адрес ${f.slug} должен быть https`).toMatch(/^https:\/\//)
    }
  })

  // Кириллица в href ломается у части клиентов (G133/G134) — адрес обязан быть
  // в punycode, а кириллическое имя живёт отдельно, только для показа человеку.
  it('адрес в punycode, кириллица — только в подписи', () => {
    for (const f of FESTIVALS) {
      expect(f.url, `${f.slug}: адрес не в punycode`).toMatch(/^https:\/\/xn--/)
      expect(f.url, `${f.slug}: кириллица в href`).not.toMatch(/[А-Яа-яЁё]/)
      expect(f.host, `${f.slug}: подпись домена не кириллическая`).toMatch(/[А-Яа-яЁё]/)
    }
  })

  it('slug уникален', () => {
    const slugs = FESTIVALS.map((f) => f.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  // Обложка приходит с чужого домена: карточку пишет сам праздник, и адрес
  // картинки обязан вести на его же сайт, а не куда-то ещё.
  it('обложка, если есть, лежит на домене самого праздника', () => {
    for (const f of FESTIVALS) {
      if (!f.cover) continue
      const host = new URL(f.url).host
      expect(new URL(f.cover.src).host, `${f.slug}: обложка не с домена праздника`).toBe(host)
      expect(f.cover.alt.trim().length, `${f.slug}: пустой alt у обложки`).toBeGreaterThan(0)
    }
  })

  // Заглушка «дата уточняется» — это не «нет данных», а «ждём». У Казанской
  // данные появились: строка от проекта про 2026/2027 (письмо Мозга 09.10).
  // Если заглушка вернётся молча, посетитель снова увидит «уточняется» там, где
  // уже известно, что ярмарки в 2026 не было. Поэтому держим это границей.
  it('у Казанской факт от проекта, а не заглушка «дата уточняется»', () => {
    const kazanskaya = FESTIVALS.find((f) => f.slug === 'kazanskaya')
    expect(kazanskaya, 'карточка Казанской пропала').toBeDefined()
    expect(kazanskaya?.season, 'заглушка вернулась').not.toBe('дата уточняется')
    expect(kazanskaya?.season, 'в сезоне нет упоминания 2027').toContain('2027')
  })
})

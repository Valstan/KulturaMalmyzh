import { describe, expect, it } from 'vitest'

import { FAQ_ITEMS } from './faqItems'

// Тексты FAQ уже обещали то, чего портал не делает («подробности в афише на
// портале», «перечень в разделе», «обратная связь, если есть форма»), и возврат
// такой фразы выглядел бы как зелёный гейт: e2e тексты ответов не сверяет.
const answer = (id: string): string => FAQ_ITEMS.find((item) => item.id === id)?.answer ?? ''

describe('FAQ_ITEMS', () => {
  it('id уникальны', () => {
    const ids = FAQ_ITEMS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('пушкинская карта не обещает цен в афише портала', () => {
    expect(answer('pushkin-card')).not.toContain('в афише на портале')
    expect(answer('pushkin-card')).toContain('по телефонам учреждений')
  })
  it('кружки не обещают перечень в разделе', () => {
    expect(answer('circles-clubs')).not.toContain('перечень по каждому ДК — в его разделе')
    expect(answer('circles-clubs')).toContain('уточняйте в самом доме культуры')
  })
  it('обратная связь не ссылается на несуществующую форму', () => {
    expect(answer('feedback')).not.toContain('если есть форма')
    expect(answer('feedback')).toContain('+7 (83347) 2-22-28')
  })
})

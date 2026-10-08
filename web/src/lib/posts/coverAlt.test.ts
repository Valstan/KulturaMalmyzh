import { describe, expect, it } from 'vitest'

import { coverAlt } from './coverAlt'

describe('coverAlt', () => {
  it('подпись редактора первична', () => {
    expect(coverAlt('Концерт ко Дню Победы', 'Новость')).toBe('Концерт ко Дню Победы')
  })
  it('без подписи — заголовок материала, а не пусто', () => {
    expect(coverAlt(null, 'Афиша от 2026-09-29')).toBe('Афиша от 2026-09-29')
  })
  it('пустая подпись с пробелами — тоже заголовок', () => {
    expect(coverAlt('   ', 'Новость')).toBe('Новость')
  })
  it('без подписи и заголовка — пусто (декоративная)', () => {
    expect(coverAlt(null, null)).toBe('')
  })
})

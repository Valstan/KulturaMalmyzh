import { describe, expect, it } from 'vitest'

import { acceptsPushkinCard } from './pushkin'

// Бейдж «принимаем Пушкинскую карту» — только там, где она действует по FAQ.
// Ошибка в любую сторону видна посетителю: лишний бейдж врёт, missing —
/// молчит там, где карта работает.
describe('acceptsPushkinCard', () => {
  it('РЦКД и музей — да', () => {
    expect(acceptsPushkinCard('rckd')).toBe(true)
    expect(acceptsPushkinCard('kraevedcheskiy-muzej')).toBe(true)
  })
  it('остальные, пусто и мусор — нет', () => {
    expect(acceptsPushkinCard('kalinino')).toBe(false)
    expect(acceptsPushkinCard('')).toBe(false)
    expect(acceptsPushkinCard(null)).toBe(false)
    expect(acceptsPushkinCard(undefined)).toBe(false)
    expect(acceptsPushkinCard('RCKD')).toBe(false)
  })
})

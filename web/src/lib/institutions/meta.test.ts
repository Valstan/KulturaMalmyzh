import { describe, expect, it } from 'vitest'

import { INSTITUTIONS } from './catalog'
import { fallbackInstitutionDescription, institutionDescription } from './meta'

// Описание раздела для метаданных — кодовый фолбэк, собранный из фактов
// карточки (решение владельца 30.10). Проверять тут две вещи: живое описание
// всегда выигрывает, а фолбэк не выдумывает ничего и не выглядит сломанным.
//
// Смысл второй половины проверок — не «красиво», а «поисковик не покажет
// мусор»: описание из названия и населённого пункта обязано быть связным
// предложением, а не склейкой вида «Дом культуры села Калинино — с. Калинино».
describe('описание раздела учреждения', () => {
  it('живое описание выигрывает и обрезается по краям', () => {
    const described = institutionDescription({
      title: 'Дом культуры села Савали',
      settlement: 'с. Савали',
      description: '  Новый дом культуры, открыт в 2026 году.  ',
    })
    expect(described).toBe('Новый дом культуры, открыт в 2026 году.')
  })

  it('пустое описание — это отсутствие описания, а не текст', () => {
    const spaces = institutionDescription({
      title: 'Дом культуры села Савали',
      settlement: 'с. Савали',
      description: '   \n  ',
    })
    expect(spaces).toBe(
      fallbackInstitutionDescription({ title: 'Дом культуры села Савали', settlement: 'с. Савали' }),
    )
    expect(spaces).toContain('новости и афиша')
  })

  it('фолбэк собран из названия и населённого пункта', () => {
    const text = fallbackInstitutionDescription({
      title: 'Аджимский сельский Дом культуры',
      settlement: 'с. Аджим',
    })
    expect(text).toBe(
      'Аджимский сельский Дом культуры — с. Аджим: новости и афиша на портале «Культура Малмыжского района».',
    )
  })

  // У большинства сельских домов культуры название уже называет село. Повтор
  // «Дом культуры села Калинино — с. Калинино» в описании выглядит опечаткой.
  it('населённый пункт не дублируется, если название его уже называет', () => {
    const text = fallbackInstitutionDescription({
      title: 'Дом культуры села Калинино',
      settlement: 'с. Калинино',
    })
    expect(text).toBe(
      'Дом культуры села Калинино: новости и афиша на портале «Культура Малмыжского района».',
    )
    expect(text).not.toContain('Калинино — с.')
  })

  // Обратный случай: «Малмыжский» содержит «Малмыж», но название населённый
  // пункт не называет — значит, «г. Малмыж» в описании остаётся.
  it('похожее слово в названии не считается упоминанием поселения', () => {
    const text = fallbackInstitutionDescription({
      title: 'Малмыжский районный Центр культуры и досуга',
      settlement: 'г. Малмыж',
    })
    expect(text).toContain('г. Малмыж')
  })

  it('без населённого пункта нет висящего разделителя', () => {
    const text = fallbackInstitutionDescription({ title: 'Краеведческий музей Малмыжа' })
    expect(text).toBe(
      'Краеведческий музей Малмыжа: новости и афиша на портале «Культура Малмыжского района».',
    )
    expect(text).not.toContain('—')
  })

  // Без названия придумывать нечего: описание раздела без названия раздела —
  // это описание несуществующего раздела.
  it('без названия фолбэка нет', () => {
    expect(fallbackInstitutionDescription({ settlement: 'с. Савали' })).toBeUndefined()
    expect(fallbackInstitutionDescription({ title: '   ' })).toBeUndefined()
    expect(institutionDescription({ title: '', description: '' })).toBeUndefined()
  })

  // Граница на всём справочнике: у каждой карточки описание должно получиться,
  // помещаться в мета-описание поисковика и не содержать мусора.
  it('у каждой карточки справочника описание получается и оно пригодное', () => {
    for (const institution of INSTITUTIONS) {
      const text = fallbackInstitutionDescription({
        title: institution.title,
        settlement: institution.settlement,
      })
      expect(text, `пустое описание у ${institution.slug}`).toBeTruthy()
      expect(text, `название потерялось у ${institution.slug}`).toContain(institution.title)
      expect(text?.length ?? 0, `слишком длинное описание у ${institution.slug}`).toBeLessThanOrEqual(160)
      expect(text, `двойной пробел у ${institution.slug}`).not.toMatch(/\s{2,}/)
      expect(text, `висящий разделитель у ${institution.slug}`).not.toMatch(/[:—-]\s*[:—-]/)
    }
  })

  // Два раздела, у которых description на проде не было (замер 30.10): здесь
  // закреплён их будущий текст — чтобы смена формулировки была осознанной.
  it('у разделов РЦКД и Калинино описание собирается из их фактов', () => {
    const rckd = INSTITUTIONS.find((i) => i.slug === 'rckd')
    const kalinino = INSTITUTIONS.find((i) => i.slug === 'kalinino')
    expect(rckd, 'карточка РЦКД пропала').toBeDefined()
    expect(kalinino, 'карточка Калинино пропала').toBeDefined()

    expect(
      fallbackInstitutionDescription({ title: rckd?.title, settlement: rckd?.settlement }),
    ).toBe(
      'Малмыжский районный Центр культуры и досуга — г. Малмыж: новости и афиша на портале «Культура Малмыжского района».',
    )
    expect(
      fallbackInstitutionDescription({ title: kalinino?.title, settlement: kalinino?.settlement }),
    ).toBe(
      'Дом культуры села Калинино: новости и афиша на портале «Культура Малмыжского района».',
    )
  })
})

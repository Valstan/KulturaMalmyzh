// Описание раздела учреждения для метаданных страницы (/dk/<slug>).
//
// Поле `institutions.description` заполняет владелец руками в админке — как
// адрес и телефон. На 30.10 оно пустое у всех карточек, и раздел оставался без
// `<meta name="description">`: для поисковика это «страница без описания».
//
// Решение владельца 30.10 — кодовый фолбэк (письмо Мозгу
// `2026-10-30-four-answers-kazanskaya-pr145-hostname-description`): текст
// собирается из фактов, которые уже есть в карточке (название, населённый
// пункт), и из известного свойства портала. За учреждения мы тексты не
// сочиняем — описание учреждения это данные, а код может лишь подставить
// подпись из того, что владелец уже заполнил.
//
// Границы:
//   • живое описание всегда выигрывает — заполнил админку, значит попало в
//     метаданные как есть, без склейки и без «фолбэка»;
//   • подпись под заголовком страницы (hero) остаётся только живой: там текст
//     виден человеку, и автоматическая строка под названием — шум. Фолбэк
//     живёт в метаданных (meta description, OpenGraph, JSON-LD);
//   • если названия нет — фолбэка нет: придумывать имя учреждения нельзя.

import { SITE_NAME } from '../site'
import { stripSettlementPrefix } from './directory'

/** Факты карточки, из которых собирается описание. */
export type InstitutionMetaFacts = {
  title?: string | null
  settlement?: string | null
  description?: string | null
}

/** Хвост фолбэка: что это за страница. Про портал, а не про учреждение. */
const TAIL = `новости и афиша на портале «${SITE_NAME}».`

/**
 * Упоминает ли название населённый пункт.
 *
 * Сравнение по словам, а не по вхождению подстроки: «Малмыжский» содержит
 * «Малмыж», но «г. Малмыж» в названии не назван — повторять его незачем.
 * Разбор по словам, а не регуляркой с `\b`: в JS `\w` не включает кириллицу,
 * а `\b` на кириллице ведёт себя непредсказуемо (G259).
 */
function titleMentionsSettlement(title: string, settlementName: string): boolean {
  const words = title
    .toLowerCase()
    .split(/[\s,;:()«»"'–—-]+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter(Boolean)
  return words.includes(settlementName.toLowerCase())
}

/**
 * Описание раздела из фактов — то, чем заполнить метаданные, если владелец
 * ещё не написал своё.
 *
 * Порядок: название, потом населённый пункт (если название его не называет),
 * потом хвост про портал. Название повторяет населённый пункт у большинства
 * сельских домов культуры («Дом культуры села Калинино» + «с. Калинино»), и
 * такая пара в описании выглядит опечаткой — поэтому повтор убираем.
 */
export function fallbackInstitutionDescription(ref: InstitutionMetaFacts): string | undefined {
  const title = (ref.title ?? '').trim()
  if (!title) return undefined

  const settlement = (ref.settlement ?? '').trim()
  const settlementName = stripSettlementPrefix(settlement)
  const withSettlement =
    settlementName && !titleMentionsSettlement(title, settlementName)
      ? `${title} — ${settlement}:`
      : `${title}:`

  return `${withSettlement} ${TAIL}`
}

/**
 * Описание раздела: сначала то, что написал владелец, иначе фолбэк.
 *
 * Пустая строка и пробелы считаются отсутствием описания — в базе это обычное
 * дело (поле textarea, владелец не трогал).
 */
export function institutionDescription(ref: InstitutionMetaFacts): string | undefined {
  const manual = (ref.description ?? '').trim()
  if (manual) return manual
  return fallbackInstitutionDescription(ref)
}

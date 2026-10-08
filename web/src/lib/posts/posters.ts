import type { Payload } from 'payload'

import { lexicalText } from './excerpt'
import { safeRevalidatePath } from '../safeRevalidate'

// Афиши и пустые записи без текста (заказ владельца 02.10).
//
// Откуда берутся заголовки-пустышки «…запись от ГГГГ-ММ-ДД»: у поста ВК не
// было ни слова текста (фотоальбом, репост картинки, афиша-картинка), а
// документ без title в админке выглядит потерянным — поэтому импорт ставит
// запасной заголовок. Два формата: свой мотор (пауза 30.09) писал
// «<Дом>: запись от <дата>», приёмник пишет «Запись от <дата>».
//
// Правило владельца:
//   - одно фото и нет текста — это афиша: публикуем, заголовок
//     «Афиша от ГГГГ-ММ-ДД» (дата — дата оригинала, не сегодня);
// v2 (вскрытие 08.10, формат на утверждение сухим прогоном): к дате добавляется
// различитель «· Место» (короткое имя дома из его карточки) — иначе соседние
// афиши разных ДК неразличимы, вкладки и сниппеты одинаковые. Префикс заказа
// 02.10 сохранён. Уже переименованные в v1 («Афиша от ДАТА» точь-в-точь) —
// снова кандидаты и переезжают в v2; с хвостом «· Место» под паттерн не
// подходят (идемпотентность). Ручные правки редактора (не точное совпадение)
// не трогаем, как и раньше.
//   - нет ни текста, ни фото, ни видео — удаляем;
//   - всё остальное (есть текст, есть видео, фотоальбом из нескольких) —
//     НЕ трогаем: заказа не было, судьбу решает человек.
//
// Чего операция НЕ делает специально:
//   - slug не переписывает: адрес несёт vkUid и уникален, а ссылки из лент
//     и sitemap на старые адреса обязаны продолжать открываться;
//   - fallback приёмника не меняет: это общий контракт эшелона с порталом,
//     Сабантуем и Казанской — меняется через Мозга, а не коммитом;
//   - записи с текстом не трогает, даже если заголовок-пустышка (текст мог
//     дописать редактор, заголовок — не наше дело).
//
// Идемпотентна: переименованная афиша под паттерн уже не подходит, удалённая
// пустая не находится — повторный прогон находит ноль кандидатов.

// Регистр — явными вариантами, а не флагом: на кириллицу в проверках
// полагаться нельзя (G259, grep -i слеп — та же семья).
const FALLBACK_TITLE_RE = /[Зз]апись от \d{4}-\d{2}-\d{2}/

// v1 операции (заказ 02.10): точное «Афиша от ДАТА» без хвоста. Такие снова
// кандидаты — их переименовываем в v2. Хвост «· Место» v2 сюда не подходит
// (якорь конца), иначе операция гонялась бы по своим же следам.
const V1_POSTER_RE = /^[Аа]фиша от \d{4}-\d{2}-\d{2}$/

export function isDerivedTitle(title: unknown): boolean {
  return (
    typeof title === 'string' && (FALLBACK_TITLE_RE.test(title) || V1_POSTER_RE.test(title))
  )
}

// Различитель афиши: короткое имя дома культуры из его карточки. Поселение —
// запасной путь (префикс «с./д./г./п.» срезаем — в заголовке ему не место).
// Пусто везде — честный старый формат без хвоста, а не выдуманное место.
export function placeLabel(shortTitle?: string | null, settlement?: string | null): string {
  const short = (shortTitle ?? '').trim()
  if (short) return short
  const place = (settlement ?? '').trim().replace(/^(г|с|д|п)\.\s+/u, '')
  return place
}

export function posterTitle(dateIso: string, place?: string | null): string {
  const base = `Афиша от ${dateIso.slice(0, 10)}`
  const label = (place ?? '').trim()
  return label ? `${base} · ${label}` : base
}

export type EmptyTitleDoc = {
  id: number
  title?: string | null
  text?: string | null
  date?: string | null
  photoCount?: number
  videoCount?: number
}

export type EmptyTitleVerdict = 'poster' | 'empty' | 'leave'

const hasText = (text: unknown): boolean =>
  typeof text === 'string' && text.replace(/\s+/g, '').length > 0

export function classifyEmptyTitle(doc: Pick<EmptyTitleDoc, 'title' | 'text' | 'photoCount' | 'videoCount'>): EmptyTitleVerdict {
  if (!isDerivedTitle(doc.title)) return 'leave'
  if (hasText(doc.text)) return 'leave'
  if ((doc.videoCount ?? 0) > 0) return 'leave'
  const photos = doc.photoCount ?? 0
  if (photos === 1) return 'poster'
  if (photos === 0) return 'empty'
  return 'leave'
}

export type EmptyTitleSample = {
  id: number
  title: string
  status?: string | null
  action: 'retitle' | 'delete' | 'skip-no-date'
  newTitle?: string
}

export type EmptyTitleSummary = {
  ok: boolean
  dry: boolean
  scanned: number
  derived: number
  posters: number
  postersRetitled: number
  empties: number
  emptiesRemoved: number
  albumsLeft: number
  skippedNoDate: number
  byInstitution: { slug?: string | null; title?: string | null; retitled: number; removed: number }[]
  samples: EmptyTitleSample[]
  messages: string[]
}

// Разбор текста записи в плоскую строку — общий с метаданными новости
// (`src/lib/posts/excerpt.ts`). Здесь переиспользуется, чтобы не держать
// третью копию обхода lexical: до этого их было две (здесь и в `dedupe.ts`).
type PreparedDoc = EmptyTitleDoc & { status?: string | null; institutionId?: number | null }

export async function retitlePosters(
  payload: Payload,
  options: { dry?: boolean; log?: (message: string) => void } = {},
): Promise<EmptyTitleSummary> {
  const dry = options.dry === true
  const say = (message: string) => options.log?.(message)
  const summary: EmptyTitleSummary = {
    ok: true,
    dry,
    scanned: 0,
    derived: 0,
    posters: 0,
    postersRetitled: 0,
    empties: 0,
    emptiesRemoved: 0,
    albumsLeft: 0,
    skippedNoDate: 0,
    byInstitution: [],
    samples: [],
    messages: [],
  }

  // Читаем ОСНОВНЫЕ записи, без `draft: true`: с флагом Payload отдаёт версии
  // из `_posts_v`, а писать мы будем не туда (урок reslug).
  const all = await payload.find({
    collection: 'posts',
    pagination: false,
    depth: 0,
    limit: 5000,
    sort: 'id',
  })
  const rows = all.docs as unknown as Record<string, unknown>[]
  summary.scanned = rows.length

  const slugs = new Map<number, { slug?: string | null; title?: string | null; short?: string | null; settlement?: string | null }>()
  const institutions = await payload.find({
    collection: 'institutions',
    pagination: false,
    depth: 0,
    limit: 200,
  })
  for (const doc of institutions.docs as unknown as {
    id: number
    slug?: string | null
    title?: string | null
    shortTitle?: string | null
    settlement?: string | null
  }[]) {
    slugs.set(doc.id, { slug: doc.slug ?? null, title: doc.title ?? null, short: doc.shortTitle ?? null, settlement: doc.settlement ?? null })
  }

  const prepared: PreparedDoc[] = rows.map((row) => {
    const institutionId = typeof row['institution'] === 'number' ? row['institution'] : null
    const gallery = Array.isArray(row['gallery']) ? row['gallery'].length : 0
    return {
      id: row['id'] as number,
      title: (row['title'] as string | null) ?? null,
      text: lexicalText(row['content']),
      date: (row['date'] as string | null) ?? null,
      photoCount: (row['cover'] ? 1 : 0) + gallery,
      videoCount: Array.isArray(row['videos']) ? row['videos'].length : 0,
      status: (row['_status'] as string | null) ?? null,
      institutionId,
    }
  })

  const derived = prepared.filter((doc) => isDerivedTitle(doc.title))
  summary.derived = derived.length

  const posters = derived.filter((doc) => classifyEmptyTitle(doc) === 'poster')
  const empties = derived.filter((doc) => classifyEmptyTitle(doc) === 'empty')
  summary.posters = posters.length
  summary.empties = empties.length
  summary.albumsLeft = derived.filter(
    (doc) => !hasText(doc.text) && (doc.videoCount ?? 0) === 0 && (doc.photoCount ?? 0) > 1,
  ).length

  const noDate = posters.filter((doc) => !doc.date)
  summary.skippedNoDate = noDate.length
  const dated = posters.filter((doc) => doc.date)

  const tally = new Map<string, { slug?: string | null; title?: string | null; retitled: number; removed: number }>()
  const bump = (doc: PreparedDoc, field: 'retitled' | 'removed') => {
    const ref = doc.institutionId ? slugs.get(doc.institutionId) : undefined
    const key = ref?.slug ?? 'без-дк'
    const row = tally.get(key) ?? { slug: ref?.slug ?? null, title: ref?.title ?? null, retitled: 0, removed: 0 }
    row[field] += 1
    tally.set(key, row)
  }

  const placeOf = (doc: PreparedDoc): string => {
    const ref = doc.institutionId ? slugs.get(doc.institutionId) : undefined
    return placeLabel(ref?.short, ref?.settlement)
  }

  for (const doc of dated.slice(0, 20)) {
    summary.samples.push({
      id: doc.id,
      title: doc.title ?? '',
      status: doc.status,
      action: 'retitle',
      newTitle: posterTitle(doc.date as string, placeOf(doc)),
    })
  }
  for (const doc of empties.slice(0, 20)) {
    summary.samples.push({ id: doc.id, title: doc.title ?? '', status: doc.status, action: 'delete' })
  }
  for (const doc of noDate.slice(0, 5)) {
    summary.samples.push({ id: doc.id, title: doc.title ?? '', status: doc.status, action: 'skip-no-date' })
  }

  if (dry) {
    say(
      `сухой прогон: записей ${summary.scanned}, с пустышкой в заголовке ${summary.derived}; ` +
        `афиш к переименованию ${summary.posters} (без даты пропущено ${summary.skippedNoDate}), ` +
        `пустых к удалению ${summary.empties}, альбомов оставляем ${summary.albumsLeft}`,
    )
    return summary
  }

  for (const doc of dated) {
    bump(doc, 'retitled')
    try {
      await payload.update({
        collection: 'posts',
        id: doc.id,
        context: { disableRevalidate: true },
        data: { title: posterTitle(doc.date as string, placeOf(doc)) },
      })
      summary.postersRetitled += 1
    } catch (err) {
      summary.ok = false
      summary.messages.push(`запись #${doc.id} не переименовалась: ${(err as Error)?.message ?? err}`)
    }
  }

  for (const doc of empties) {
    bump(doc, 'removed')
    try {
      await payload.delete({
        collection: 'posts',
        id: doc.id,
        context: { disableRevalidate: true },
      })
      summary.emptiesRemoved += 1
    } catch (err) {
      summary.ok = false
      summary.messages.push(`запись #${doc.id} не удалилась: ${(err as Error)?.message ?? err}`)
    }
  }

  summary.byInstitution = [...tally.values()]
    .sort((a, b) => b.retitled + b.removed - (a.retitled + a.removed))
    .slice(0, 40)

  // Приёмка «после», а не «до»: перечитываем базу, и если хоть один кандидат
  // уцелел — отказ, а не отчёт «сколько сделали».
  const after = await payload.find({ collection: 'posts', pagination: false, depth: 0, limit: 5000, sort: 'id' })
  const left = (after.docs as unknown as Record<string, unknown>[]).filter((row) => {
    const gallery = Array.isArray(row['gallery']) ? row['gallery'].length : 0
    return (
      classifyEmptyTitle({
        title: (row['title'] as string | null) ?? null,
        text: lexicalText(row['content']),
        photoCount: (row['cover'] ? 1 : 0) + gallery,
        videoCount: Array.isArray(row['videos']) ? row['videos'].length : 0,
      }) !== 'leave'
    )
  })
  if (left.length > 0) {
    summary.ok = false
    summary.messages.push(`после прогона осталось кандидатов: ${left.length}`)
  }

  if (summary.postersRetitled + summary.emptiesRemoved > 0) {
    safeRevalidatePath('/', 'page')
    safeRevalidatePath('/news', 'page')
    safeRevalidatePath('/news/[slug]', 'page')
    safeRevalidatePath('/dk', 'page')
    safeRevalidatePath('/dk/[slug]', 'page')
  }

  say(
    `итог: записей было ${summary.scanned}, афиш переименовано ${summary.postersRetitled} из ${summary.posters}, ` +
      `пустых удалено ${summary.emptiesRemoved} из ${summary.empties}, без даты пропущено ${summary.skippedNoDate}, ошибок ${summary.messages.length}`,
  )
  return summary
}

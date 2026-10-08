import Link from 'next/link'
import Image from 'next/image'

import { formatPostDate } from '../../../lib/format'
import { institutionBadge, institutionHref, institutionLabel } from '../../../lib/institutions'
import { coverAlt } from '../../../lib/posts/coverAlt'

// Карточка материала с превью — общая для главной и разделов домов культуры
// (заказ владельца 30.09: в ленте раздела тоже картинки, не только заголовки).
//
// Загрузка картинок — по современным правилам и без клиентского JS:
//   - серверный рендер: лента видна сразу целиком, без спиннеров и догрузок;
//   - уменьшенная копия `card` (768px), а не оригинал — в разы меньше байт;
//   - `priority` только у первых двух (кандидаты в LCP), остальные — lazy;
//   - явные width/height у каждой картинки — нет сдвига раскладки (CLS);
//   - `sizes` — мобильным браузер сам возьмёт маленькую копию.
// Без обложки — заглушка тем же размером: сетка не прыгает.
//
// Требует `depth: 1` при выборке: обложка приходит объектом с `sizes`, при
// `depth: 0` — только идентификатором, и превью нечего рисовать.

type MediaSize = { url?: string | null; width?: number | null; height?: number | null }

export type MediaDoc = {
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  sizes?: { card?: MediaSize | null; thumbnail?: MediaSize | null } | null
}

export type PostCardDoc = {
  id: string | number
  title?: string | null
  slug?: string | null
  date?: string | null
  publishedAt?: string | null
  category?: string | null
  type?: string | null
  institution?: unknown
  cover?: MediaDoc | string | number | null
}

// Уровень заголовка карточки: `h3` внутри блока с `h2` (главная, раздел ДК),
// `h2` — когда карточки идут сразу под `h1` (общая лента /news). Пропускать
// уровень нельзя: это ломает навигацию по заголовкам для скринридера.
export type CardHeading = 'h2' | 'h3'

// Список карточек. `priorityCount` — сколько первых грузим сразу (кандидаты в
// LCP), остальные — lazy: на разделе с полусотней записей eagerly грузить всю
// ленту нельзя, единственный vCPU этого не стоит.
export function PostCards({
  posts,
  showInstitution = true,
  showType = true,
  showCategory = false,
  headingLevel = 'h3',
  priorityCount = 2,
}: {
  posts: PostCardDoc[]
  showInstitution?: boolean
  showType?: boolean
  showCategory?: boolean
  headingLevel?: CardHeading
  priorityCount?: number
}) {
  return (
    <ul className="news-cards">
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          post={post}
          priority={index < priorityCount}
          showInstitution={showInstitution}
          showType={showType}
          showCategory={showCategory}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  )
}

export function PostCard({
  post,
  priority,
  showInstitution = true,
  showType = true,
  showCategory = false,
  headingLevel = 'h3',
}: {
  post: PostCardDoc
  priority: boolean
  showInstitution?: boolean
  showType?: boolean
  showCategory?: boolean
  headingLevel?: CardHeading
}) {
  const cover = typeof post.cover === 'object' && post.cover ? post.cover : null
  const size = cover?.sizes?.card ?? cover?.sizes?.thumbnail ?? null
  const src = size?.url || cover?.url || null
  const href = `/news/${encodeURIComponent(post.slug ?? '')}`
  const title = post.title || 'Без заголовка'
  const Heading = headingLevel
  return (
    <li className="news-card">
      {src ? (
        <Link className="news-card__cover-link" href={href} aria-hidden="true" tabIndex={-1}>
          <Image
            className="news-card__cover"
            src={src}
            // alt есть всегда (для поиска по картинкам), а дерево доступности
            // не трогаем: ссылка-обёртка aria-hidden, заголовок рядом озвучен.
            // Подробности — в комментарии к coverAlt.
            alt={coverAlt(cover?.alt, title)}
            width={size?.width || cover?.width || 768}
            height={size?.height || cover?.height || 432}
            sizes="(max-width: 640px) 100vw, 200px"
            priority={priority}
          />
        </Link>
      ) : (
        <div className="news-card__cover news-card__cover--empty" aria-hidden="true">
          🎭
        </div>
      )}
      <div className="news-card__body">
        <Heading>
          <Link href={href}>{title}</Link>
        </Heading>
        <p className="post-list__meta">
          {showType && post.type === 'event' ? 'Афиша · ' : ''}
          {formatPostDate(post.date || post.publishedAt)}
          {showCategory && post.category ? ` · ${post.category}` : ''}
          {showInstitution ? <PostInstitutionBadge institution={post.institution} /> : null}
        </p>
      </div>
    </li>
  )
}

// Бейдж учреждения. Материал без привязки — общерайонный, бейджа не получает.
export function PostInstitutionBadge({ institution }: { institution: unknown }) {
  const ref = institutionBadge(institution)
  if (!ref) return null
  return (
    <>
      {' · '}
      <Link href={institutionHref(ref)}>{institutionLabel(ref)}</Link>
    </>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { FEED_PAGE_SIZE, mergeFeedDocs, type FeedCard } from '../../../lib/feedShape'
import { PostCards, type CardHeading } from './PostCard'

// Лента с постраничной догрузкой: на сервере рендерится первая страница (20),
// дальше по мере прокрутки клиент тянет `/api/feed` и дописывает следующие 20.
//
// Почему не «показать ещё» по кнопке как единственный способ: просмотрщик до
// конца ленты не доходит почти никогда, а кнопка требует нажатия. Наблюдатель за
// маяком подгружает сам; кнопка остаётся как запасной путь — без клиентского JS
// и для скринридера, у которого автозагрузка при наведении ссылки хуже.
//
// Ошибка запроса не теряет уже загруженное: показываем кнопку «Попробовать
// снова» под тем, что уже есть.
export type PostFeedProps = {
  initial: FeedCard[]
  page: number
  totalPages: number
  institutionSlug?: string | null
  type?: 'news' | 'event' | null
  q?: string | null
  showInstitution?: boolean
  showCategory?: boolean
  showType?: boolean
  headingLevel?: CardHeading
  emptyText?: string
}

export function PostFeed({
  initial,
  page: initialPage,
  totalPages,
  institutionSlug = null,
  type = null,
  q = null,
  showInstitution = true,
  showCategory = false,
  showType = true,
  headingLevel = 'h3',
  emptyText = 'Пока нет новостей.',
}: PostFeedProps) {
  const [docs, setDocs] = useState<FeedCard[]>(initial)
  const [page, setPage] = useState(initialPage)
  const [hasMore, setHasMore] = useState(initialPage < totalPages)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const busy = useRef(false)

  const loadMore = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ page: String(page + 1), limit: String(FEED_PAGE_SIZE) })
      if (institutionSlug) params.set('institution', institutionSlug)
      if (type) params.set('type', type)
      if (q) params.set('q', q)
      const res = await fetch(`/api/feed?${params.toString()}`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`статус ${res.status}`)
      const data = (await res.json()) as { docs?: FeedCard[]; page?: number; totalPages?: number }
      const incoming = data.docs ?? []
      setDocs((prev) => mergeFeedDocs(prev, incoming))
      const nextPage = typeof data.page === 'number' ? data.page : page + 1
      const nextTotal = typeof data.totalPages === 'number' ? data.totalPages : nextPage
      setPage(nextPage)
      setHasMore(nextPage < nextTotal)
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [institutionSlug, page, q, type])

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      // Подгружаем заранее, за экраном: на медленной связи к моменту, когда
      // пользователь долистает, страница уже будет готова.
      { rootMargin: '600px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  if (initial.length === 0) {
    return <p className="muted">{emptyText}</p>
  }

  return (
    <>
      <PostCards
        posts={docs}
        showInstitution={showInstitution}
        showType={showType}
        showCategory={showCategory}
        headingLevel={headingLevel}
      />
      <div className="post-feed__more">
        <div className="post-feed__sentinel" ref={sentinel} aria-hidden="true" />
        {hasMore ? (
          <button className="button button--secondary" type="button" onClick={() => void loadMore()}>
            {loading ? 'Загружаем…' : failed ? 'Попробовать снова' : `Показать ещё ${FEED_PAGE_SIZE}`}
          </button>
        ) : (
          <p className="muted">Это все материалы.</p>
        )}
        <p className="muted" role="status">
          {loading ? 'Загружаем следующие материалы…' : `Показано ${docs.length}`}
        </p>
      </div>
    </>
  )
}

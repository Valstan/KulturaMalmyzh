import { FEED_PAGE_SIZE, getFeedPageSafe } from '../../../lib/feed'
import { PostFeed } from '../components/PostFeed'

// Общая лента «Афиша и новости» — карточками с превью, по дате от новых к
// старым, по 20 штук с догрузкой по мере прокрутки (заказ владельца 30.09).
//
// Материалы всех домов культуры и общерайонные — вперемешку, одной лентой: на
// портале это «всё сразу», разбирать по домам — работа адресата `/dk`.
//
// Поиск — обычной GET-формой (`/news?q=…`): работает без JS, адрес sharable,
// кнопка «назад» ведёт куда ждали. `key` у ленты обязателен: без него клиент
// сохранил бы карточки прошлого запроса при переходе на новый.
export async function NewsView({ q = null }: { q?: string | null }) {
  const feed = await getFeedPageSafe({ limit: FEED_PAGE_SIZE, q })

  return (
    <section>
      <h1>Новости</h1>
      {/* Классы `dk-search` переиспользуем как есть: вид один, нового CSS нет. */}
      <form className="dk-search" action="/news" method="get" role="search">
        <label className="dk-search__label" htmlFor="news-search-input">
          Поиск по новостям
        </label>
        <input
          id="news-search-input"
          className="dk-search__input"
          type="search"
          name="q"
          defaultValue={q ?? ''}
          maxLength={64}
          autoComplete="off"
          placeholder="например: концерт, ярмарка, Китяк"
        />
        <p className="dk-search__status" role="status">
          {q ? `Найдено ${feed.totalDocs}` : `Всего ${feed.totalDocs}`}
        </p>
      </form>
      {feed.docs.length === 0 ? (
        <p className="muted">
          {q ? `По запросу «${q}» ничего не нашлось.` : 'Пока нет новостей.'}
        </p>
      ) : (
        <PostFeed
          key={q ?? ''}
          initial={feed.docs}
          page={feed.page}
          totalPages={feed.totalPages}
          q={q}
          showCategory
          headingLevel="h2"
        />
      )}
    </section>
  )
}

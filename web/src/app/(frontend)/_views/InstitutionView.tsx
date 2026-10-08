import type { Metadata } from 'next'
import Link from 'next/link'
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'

import { canonicalOf, openGraphWithImage, SITE_NAME } from '../../../lib/site'
import { withRetry } from '../../../lib/withRetry'
import { RichText } from '../../../lib/RichText'
import { FEED_PAGE_SIZE, getFeedPageSafe, type FeedPage } from '../../../lib/feed'
import { isMentionFeed, MENTION_FEED_NOTE } from '../../../lib/institutions/mentionFeed'
import { acceptsPushkinCard } from '../../../lib/institutions/pushkin'
import { institutionJsonLd } from '../../../lib/jsonLd'
import { JsonLd } from '../components/JsonLd'
import { SectionTheme, themeOf } from '../components/SectionTheme'
import { PostFeed } from '../components/PostFeed'

type InstitutionDoc = {
  id: string | number
  title?: string | null
  shortTitle?: string | null
  theme?: string | null
  settlement?: string | null
  description?: string | null
  content?: unknown
  address?: string | null
  phone?: string | null
  website?: string | null
  vkSources?: { id?: string | null; url?: string | null }[] | null
}

async function getInstitution(slug: string): Promise<InstitutionDoc | null> {
  return withRetry(async () => {
    const payload = await getPayload({ config })
    const res = await payload.find({
      collection: 'institutions',
      where: { slug: { equals: slug }, _status: { equals: 'published' } },
      depth: 0,
      limit: 1,
    })
    return (res.docs[0] as InstitutionDoc | undefined) ?? null
  })
}

// Лента учреждения — ТОЛЬКО его материалы (заказ владельца 30.09), по дате от
// новых к старым, по 20 с догружкой по скроллу. Афиша и новости — две
// независимые ленты по виду записи, а не одна выборка с разделением в коде:
// догруживать по скроллу пришлось бы по каждой, и пагинация разъезжалась бы
// между блоками.
//
// Сбой выборки не должен прятать саму карточку дома культуры — адрес и телефон
// нужнее ленты, поэтому мягкая деградация (логируется в журнал, ISR чинит сама).
async function getFeed(slug: string, type?: 'news' | 'event'): Promise<FeedPage> {
  return withRetry(() =>
    getFeedPageSafe({ limit: FEED_PAGE_SIZE, institutionSlug: slug, type: type ?? null }),
  )
}

export async function institutionMeta(slug: string): Promise<Metadata> {
  try {
    const institution = await getInstitution(decodeURIComponent(slug))
    if (!institution) return {}
    return {
      title: institution.title || SITE_NAME,
      description: institution.description || undefined,
      alternates: { canonical: canonicalOf(`/dk/${slug}`) },
      openGraph: openGraphWithImage({
        path: `/dk/${slug}`,
        title: institution.title || SITE_NAME,
      }),
    }
  } catch {
    return {}
  }
}

export async function InstitutionView({ slug }: { slug: string }) {
  // Сбой чтения пробрасываем (не кэшируем ложный 404 под ISR); реальное
  // отсутствие → notFound().
  const institution = await getInstitution(decodeURIComponent(slug))
  if (!institution) notFound()

  // У части учреждений сообществ несколько: РЦКД печатает и в группе, и на
  // личной странице, у пяти сельских ДК рядом с действующей живёт прежняя.
  const vkLinks = (institution.vkSources ?? [])
    .map((source) => source?.url)
    .filter((url): url is string => Boolean(url))

  // Личный домен учреждения (у РЦКД — алиас портала, у Калинино — 301 сюда).
  const website = (institution.website || '').trim()
  const hasWebsite = /^https?:\/\//i.test(website)

  const sectionSlug = decodeURIComponent(slug)
  // Раздел без своего сообщества (Нослы, Дерюшево, Малый Китяк): лента собрана
  // по упоминанию села, поэтому у записей показывается бейдж ДОМА, который их
  // выпустил, — в обычном разделе бейдж своего ДК был бы лишним.
  const mentionFeed = isMentionFeed(sectionSlug)
  // Афиша и новости — две ленты одного дома культуры, каждая по-своему
  // пагинируется и догружается.
  const [events, news] = await Promise.all([
    getFeed(sectionSlug, 'event'),
    getFeed(sectionSlug, 'news'),
  ])

  return (
    <SectionTheme theme={themeOf(institution)}>
    <article>
      <JsonLd
        data={institutionJsonLd({
          slug: sectionSlug,
          title: institution.title || '',
          description: institution.description,
          address: institution.address,
          phone: institution.phone,
        })}
      />
      <p className="eyebrow eyebrow--crumbs">
        <Link href="/dk">Дома культуры района</Link>
        {institution.settlement ? ` · ${institution.settlement}` : ''}
      </p>
      <h1>{institution.title}</h1>
      {institution.description ? <p className="hero__subtitle">{institution.description}</p> : null}
      {mentionFeed ? <p className="muted">{MENTION_FEED_NOTE}</p> : null}

      <RichText data={institution.content} />

      {institution.address || institution.phone || hasWebsite || vkLinks.length > 0 ? (
        <section className="institution-block">
          <h2>Контакты</h2>
          {institution.address ? <p>{institution.address}</p> : null}
          {institution.phone ? <p>{institution.phone}</p> : null}
          {hasWebsite ? (
            <p>
              <a href={website}>Сайт учреждения</a>
            </p>
          ) : null}
          {vkLinks.map((url, i) => (
            <p key={url}>
              <a href={url} rel="noopener" target="_blank">
                {vkLinks.length > 1 ? `Сообщество ВКонтакте (${i + 1})` : 'Сообщество ВКонтакте'}
              </a>
            </p>
          ))}
          {acceptsPushkinCard(sectionSlug) ? <p>🎫 Здесь принимают Пушкинскую карту.</p> : null}
        </section>
      ) : null}

      {events.docs.length > 0 ? (
        <section className="institution-block">
          <p className="eyebrow">Не пропустите</p>
          <h2>Афиша</h2>
          <PostFeed
            initial={events.docs}
            page={events.page}
            totalPages={events.totalPages}
            institutionSlug={sectionSlug}
            type="event"
            showInstitution={mentionFeed}
            showType={false}
            emptyText="Афиши пока нет."
          />
        </section>
      ) : null}

      <section className="institution-block">
        <h2>Новости</h2>
        <PostFeed
          initial={news.docs}
          page={news.page}
          totalPages={news.totalPages}
          institutionSlug={sectionSlug}
          type="news"
          showInstitution={mentionFeed}
          emptyText={`Новостей про ${institution.settlement ?? 'наше место'} пока нет.`}
        />
      </section>
    </article>
    </SectionTheme>
  )
}

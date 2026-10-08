import type { Metadata } from 'next'

import { canonicalOf, openGraphWithImage } from '../../../lib/site'
import { NewsView } from '../_views/NewsView'

// Лента новостей. Тело — _views/NewsView. ISR.
export const revalidate = 60

// Описание списка — про ленту, а не про портал вообще: раньше description
// /news дублировал общий из layout (вскрытие 08.10). Одна константа на
// meta-description и og:description, чтобы не разъехались.
const NEWS_DESC =
  'Новости и афиши домов культуры Малмыжского района: анонсы событий, отчёты о прошедшем, жизнь сёл. Свежие — сверху.'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const firstParam = async (searchParams: SearchParams): Promise<string | null> => {
  const raw = (await searchParams)['q']
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 64)
  return value ? value : null
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  const q = await firstParam(searchParams)
  const title = q ? `Поиск «${q}» — Новости` : 'Новости'
  return {
    title,
    description: NEWS_DESC,
    alternates: { canonical: canonicalOf('/news') },
    openGraph: openGraphWithImage({ path: '/news', title, description: NEWS_DESC }),
  }
}

export default async function NewsPage({ searchParams }: { searchParams: SearchParams }) {
  return <NewsView q={await firstParam(searchParams)} />
}

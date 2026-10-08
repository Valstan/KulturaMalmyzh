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

export const metadata: Metadata = {
  title: 'Новости',
  description: NEWS_DESC,
  alternates: { canonical: canonicalOf('/news') },
  openGraph: openGraphWithImage({ path: '/news', title: 'Новости', description: NEWS_DESC }),
}

export default function NewsPage() {
  return <NewsView />
}

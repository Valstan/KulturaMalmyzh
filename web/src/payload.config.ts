import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Institutions } from './collections/Institutions'
import { Pages } from './collections/Pages'
import { Posts } from './collections/Posts'
import { Media } from './collections/Media'
import { Users } from './collections/Users'
import { HomeContent } from './globals/HomeContent'
import { SiteHeader } from './globals/SiteHeader'
import { SiteFooter } from './globals/SiteFooter'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Основной домен портала — культура.вмалмыже.рф; домкультуры.вмалмыже.рф остаётся
// на переходный период (301 в nginx, но админка и API по нему ещё могут ходить).
const PORTAL_ORIGIN = 'https://xn--80atdujec4e.xn--80adkdyec4j.xn--p1ai'
const LEGACY_ORIGIN = 'https://xn--d1amdcjpngc5fh.xn--80adkdyec4j.xn--p1ai'

const ORIGINS = Array.from(
  new Set([process.env.NEXT_PUBLIC_SERVER_URL, PORTAL_ORIGIN, LEGACY_ORIGIN].filter(Boolean)),
) as string[]

// Тип transportOptions берём из сигнатуры самого адаптера, а не из предположения
// о нём: так утверждение ниже последует за адаптером, если он обновится.
//
// Утверждение нужно потому, что в nodemailer 10 поле `auth` переехало с уровня
// соединения на уровень транспорта, а `@payloadcms/email-nodemailer@3.90.1`
// типизирует transportOptions как `SMTPConnection.Options` — где `auth` больше
// нет. Это отстал ТИП адаптера, а не наше использование: рантайм проверен —
// адаптер отдаёт объект прямо в `nodemailer.createTransport()`, а `SMTPTransport`
// в 10.x читает `options.auth` и без него письма не авторизуются. Без
// утверждения `tsc` падает с «'auth' does not exist in type
// 'SMTPConnectionOptions'» на живом, работающем SMTP.
type AdapterTransportOptions = NonNullable<
  NonNullable<Parameters<typeof nodemailerAdapter>[0]>['transportOptions']
>

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' — Культура Малмыжского района',
    },
  },
  editor: lexicalEditor(),
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
    // push автосинхронизирует схему по конфигу, минуя миграции. Это удобно в dev и
    // недопустимо там, где схему должна давать миграция: с включённым push гейт
    // проверяет автосинхро, а миграция, ломающая прод-схему, проходит зелёной.
    // Поэтому в CI выставляется PAYLOAD_DB_PUSH=false; по умолчанию (dev) push включён.
    push: process.env.PAYLOAD_DB_PUSH !== 'false',
  }),
  collections: [Institutions, Pages, Posts, Media, Users],
  globals: [HomeContent, SiteHeader, SiteFooter],
  // Email-уведомления (опционально). Провайдеро-независимо: любой внешний SMTP-relay
  // задаётся через env. Пока SMTP_HOST не задан, адаптер не подключаем → Payload
  // пишет письма в консоль (dev/CI) — сборка и типы остаются зелёными без секретов.
  // Реальные SMTP-доступы живут ТОЛЬКО в /etc/dkmalmyzh/dkmalmyzh.env на проде.
  email: process.env.SMTP_HOST
    ? nodemailerAdapter({
        defaultFromAddress: process.env.SMTP_FROM_ADDRESS || 'no-reply@xn--80atdujec4e.xn--80adkdyec4j.xn--p1ai',
        defaultFromName: process.env.SMTP_FROM_NAME || 'Культура Малмыжского района',
        transportOptions: {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          // 465 = implicit TLS (secure); 587/2525 = STARTTLS (secure:false).
          secure: process.env.SMTP_SECURE
            ? process.env.SMTP_SECURE === 'true'
            : Number(process.env.SMTP_PORT) === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        } as AdapterTransportOptions,
      })
    : undefined,
  // Оба домена: боевой URL бейкается один, но второе имя (алиас раздела ДК)
  // обращается к тому же API. csrf задан явно тем же списком —
  // без него Payload выводит его из cors/serverURL, и это неявное поведение
  // ломается ровно тогда, когда список перестаёт быть одноэлементным.
  cors: [...ORIGINS],
  csrf: [...ORIGINS],
  secret: process.env.PAYLOAD_SECRET || '',
  sharp,
  i18n: {
    fallbackLanguage: 'ru',
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

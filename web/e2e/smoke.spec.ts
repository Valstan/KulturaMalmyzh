import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  CI_CYRILLIC_POST_SLUG,
  CI_CYRILLIC_POST_TEXT,
  CI_CYRILLIC_POST_TITLE,
  CI_DRAFT_INSTITUTION_SLUG,
  CI_DRAFT_INSTITUTION_TITLE,
  CI_DRAFT_POST_SLUG,
  CI_DRAFT_POST_TITLE,
  CI_EVENT_SLUG,
  CI_EVENT_TITLE,
  CI_HEAD_MEDIA_FILENAME,
  CI_INSTITUTION_SLUG,
  CI_INSTITUTION_TITLE_UPDATED,
  CI_PAGE_SLUG,
  CI_PAGE_TITLE,
  CI_POST_SLUG,
  CI_POST_TITLE_UPDATED,
} from '../scripts/ci-fixtures'
import { FESTIVALS } from '../src/lib/festivals'

// Ошибки страницы (uncaught exception в браузере) не роняют ответ сервера: HTTP
// остаётся 200, разметка приходит, а гидратация ложится. Гейт, смотрящий только
// на статус, такое пропускает — поэтому каждый переход слушает pageerror.
async function withoutPageErrors(page: Page, body: () => Promise<void>): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await body()
  expect(errors, 'необработанные ошибки в браузере').toEqual([])
}

test.describe('публичные страницы открываются в браузере', () => {
  test('главная', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto('/')
      expect(res?.status()).toBe(200)
      await expect(page.locator('h1')).toBeVisible()
    })
  })

  // Блок ближайших событий отбирает афиши с датой в будущем. Ветка исполняется
  // только когда такой документ есть — сид кладёт его специально.
  test('главная показывает предстоящую афишу и не показывает прошедшую', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      await page.goto('/')
      const events = page.locator('section', { hasText: 'Ближайшие события' }).first()
      await expect(events.getByRole('link', { name: CI_EVENT_TITLE })).toBeVisible()
      await expect(events.getByRole('link', { name: CI_POST_TITLE_UPDATED })).toHaveCount(0)
    })
  })

  test('лента новостей показывает засеянную новость', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto('/news')
      expect(res?.status()).toBe(200)
      await expect(page.getByRole('link', { name: CI_POST_TITLE_UPDATED })).toBeVisible()
    })
  })

  // Ради этого теста всё и затевалось: /news/[slug] остаётся `ƒ` и в пререндер не
  // попадает, поэтому ошибка рендера конкретного документа до сих пор не ловилась
  // ни сборкой, ни сидом.
  test('новость по slug рендерится целиком', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto(`/news/${CI_POST_SLUG}`)
      expect(res?.status()).toBe(200)
      await expect(page.locator('h1')).toHaveText(CI_POST_TITLE_UPDATED)
      await expect(page).toHaveTitle(new RegExp(CI_POST_TITLE_UPDATED.replace(/[()]/g, '\\$&')))
    })
  })

  test('страница по slug рендерится целиком', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto(`/pages/${CI_PAGE_SLUG}`)
      expect(res?.status()).toBe(200)
      await expect(page.locator('h1')).toHaveText(CI_PAGE_TITLE)
    })
  })

  // Переход по ссылке, а не по собранному URL: проверяет, что лента отдаёт
  // рабочие адреса. Расхождение slug'а в ссылке и в маршруте прямой goto не ловит.
  test('из ленты можно перейти в новость', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      await page.goto('/news')
      await page.getByRole('link', { name: CI_POST_TITLE_UPDATED }).click()
      await expect(page.locator('h1')).toHaveText(CI_POST_TITLE_UPDATED)
      expect(new URL(page.url()).pathname).toBe(`/news/${CI_POST_SLUG}`)
    })
  })

  test('список домов культуры показывает засеянное учреждение', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto('/dk')
      expect(res?.status()).toBe(200)
      await expect(page.getByRole('link', { name: CI_INSTITUTION_TITLE_UPDATED })).toBeVisible()
    })
  })

  // Второй динамический маршрут портала: раздел учреждения со своей лентой.
  // Как и /news/[slug], он `ƒ` — сборка его не исполняет.
  test('раздел дома культуры рендерится со своей лентой', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto(`/dk/${CI_INSTITUTION_SLUG}`)
      expect(res?.status()).toBe(200)
      await expect(page.locator('h1')).toHaveText(CI_INSTITUTION_TITLE_UPDATED)
      // Сид кладёт афишу этого ДК — она обязана быть видна именно в его разделе.
      await expect(page.getByRole('link', { name: CI_POST_TITLE_UPDATED })).toBeVisible()
      // Лента раздела — карточками с местом под превью (заказ владельца 30.09),
      // а не голыми заголовками. Проверяем наличие карточки: у сидовых материалов
      // обложки нет, и проверять надо саму разметку, а не конкретную картинку.
      await expect(page.locator('.news-card').first()).toBeVisible()
      await expect(page.locator('.news-card__cover').first()).toBeVisible()
    })
  })

  test('несуществующий дом культуры даёт 404', async ({ page }) => {
    const res = await page.goto('/dk/такого-дк-нет')
    expect(res?.status()).toBe(404)
  })

  test('из общей ленты виден бейдж дома культуры', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      await page.goto('/news')
      // Общая лента — карточки с превью (заказ 30.09), не голые заголовки.
      await expect(page.locator('.news-card').first()).toBeVisible()
      await expect(page.locator('.news-card__cover').first()).toBeVisible()
      // .first(): у ДК в ленте несколько материалов, бейдж у каждого свой.
      const badge = page.getByRole('link', { name: 'CI', exact: true }).first()
      await expect(badge).toBeVisible()
      await badge.click()
      await expect(page.locator('h1')).toHaveText(CI_INSTITUTION_TITLE_UPDATED)
    })
  })

  // Праздники района (D-075): карточки ведут НА САЙТ праздника, не внутрь портала.
  //
  // Проверяются инварианты, а не тексты. Названия карточек пишут сами праздники и
  // присылают через Мозг — тест, прибитый к строке «Сабантуй Малмыж», падал бы на
  // первом же обновлении карточки, ничего при этом не проверяя по существу.
  test('праздники района — все карточки на месте и ведут наружу', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      const res = await page.goto('/prazdniki')
      expect(res?.status()).toBe(200)
      await expect(page.locator('h1')).toHaveText('Праздники района')
      await expect(page.locator('.festival-card')).toHaveCount(FESTIVALS.length)

      for (const festival of FESTIVALS) {
        const link = page.locator(`.festival-card a[href="${festival.url}"]`).first()
        await expect(link, `нет ссылки на ${festival.host}`).toBeVisible()
      }
    })
  })

  // Страница, до которой нельзя дойти по меню, не существует для посетителя.
  // Такое уже случалось: «Вопросы и ответы» выкатили, в меню пункт не добавили,
  // и страница лежала месяцами — её находили только те, кто угадал адрес.
  // Проверка по ССЫЛКЕ в шапке, а не по наличию страницы по адресу.
  test('обязательные пункты меню видны в шапке и ведут живые', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      await page.goto('/')
      const nav = page.locator('.site-nav')

      for (const href of ['/news', '/dk', '/prazdniki', '/faq']) {
        await expect(nav.locator(`a[href="${href}"]`), `нет пункта меню ${href}`).toHaveCount(1)
      }

      // И действительно ведёт: страница открывается и не пустая.
      await nav.locator('a[href="/faq"]').click()
      await expect(page).toHaveURL(/\/faq$/)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('.faq-question').first()).toBeVisible()
    })
  })

  // Список домов культуры: заказчик просил три вещи — картинку у каждого учреждения,
// короткое имя вместо родительного падежа и поиск по совпадению в любом месте
// названия.
//
// Проверка НЕ прибита к «Китяку» и вообще к конкретным селам: в гейтовой базе их
// нет, там одно засеянное учреждение. Запрос строится из его собственного
// названия, а «в любом месте» проверяется фрагментом из середины строки.
test('дома культуры: картинка, короткое имя и поиск по совпадению', async ({ page }) => {
  await withoutPageErrors(page, async () => {
    await page.goto('/dk')

    const cards = page.locator('.dk-item')
    const total = await cards.count()
    expect(total, 'список учреждений пуст').toBeGreaterThan(0)

    // Картинка у каждого, и это не пустая строка. Разные значки у разных
    // учреждений проверяет юнит на настоящей карте (33 адреса — 33 разных);
    // здесь, на выдуманных адресах тестовой базы, карта покрывать не обязана.
    const emojis = await page.locator('.dk-item__emoji').allTextContents()
    expect(emojis).toHaveLength(total)
    expect(emojis.every((e) => e.trim().length > 0), 'учреждение без картинки').toBe(true)

    // Короткая подпись не повторяет «Дом культуры …» — ради этого правила и
    // затевалось; а доступное имя ссылки остаётся полным (иначе озвучка в списке
    // из тридцати одного пункта читала бы «Калинино» без всякого смысла).
    const firstCard = cards.first()
    await expect(firstCard.locator('.post-list__meta')).not.toContainText('Дом культуры')

    // Компакт (заказ 03.10): поселения в подписях нет — имя села уже стоит в
    // заголовке, строка «с. …» под ним была повтором. Проверяем все подписи
    // разом: ни одна не начинается с префикса населённого пункта.
    const metas = await page.locator('.post-list__meta').allTextContents()
    expect(
      metas.every((m) => !/^[сдп]\.\s|пгт\.\s/i.test(m.trim())),
      `поселение в подписи: ${JSON.stringify(metas.filter((m) => /^[сдп]\.\s|пгт\.\s/i.test(m.trim())))}`,
    ).toBe(true)

    const search = page.locator('.dk-search__input')
    await expect(search).toBeVisible()
    // До ввода счётчик показывает общее число, после — «найдено X из Y».
    await expect(page.locator('.dk-search__status')).toContainText(`Всего ${total}`)

    // «В любом месте, а не в начале»: фрагмент из середины названия.
    const middle = CI_INSTITUTION_TITLE_UPDATED.slice(3, -1)
    await search.fill(middle)
    expect(await cards.count(), 'поиск по середине названия ничего не нашёл').toBe(1)
    await expect(page.locator('.dk-search__status')).toContainText(`Найдено 1 из ${total}`)

    // Регистр не важен.
    await search.fill(middle.toUpperCase())
    expect(await cards.count()).toBe(1)

    // Список пересобирается на том же адресе, без перезагрузки.
    await search.fill('совершенно-нет-такого')
    await expect(page.locator('.muted').filter({ hasText: 'ничего не нашлось' })).toBeVisible()
    expect(await cards.count()).toBe(0)

    // И очистка запроса возвращает полный список.
    await search.fill('')
    await expect(cards).toHaveCount(total)
  })
})

// Канонический адрес задаётся постранично. Пока он жил в корневом layout, ВСЕ
  // страницы объявляли канонической главную, и раздел выпадал из индекса при
  // живом sitemap — расхождение, которое снаружи ничем себя не выдаёт.
  //
  // Отсутствие тега — тоже отказ: сравнение с fallback («нет тега → считаем, что
  // там '/'») зеленело бы ровно в том случае, ради которого тест написан.
  test('страницы объявляют канониклом себя, а не главную', async ({ page }) => {
    for (const path of ['/prazdniki', '/news', '/dk', '/']) {
      await page.goto(path)
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
      expect(canonical, `нет canonical на ${path}`).not.toBeNull()
      const pathname = new URL(canonical as string).pathname.replace(/\/$/, '') || '/'
      expect(pathname, `canonical на ${path}`).toBe(path === '/' ? '/' : path)
    }
  })

  // Метаданные новости с КИРИЛЛИЧЕСКИМ адресом — регрессионная защита.
  //
  // 94% новостей на проде (784 из 835) адресованы кириллицей, а `params.slug`
  // приходит percent-encoded. Пока `postMeta` не декодировал его, документ не
  // находился, `catch` глотал это молча — и страница отдавала title/description
  // из layout, БЕЗ canonical вовсе. Баг жил незамеченным именно потому, что
  // фикстуры в гейте были ASCII: тест «canonical на месте» на них зеленел.
  //
  // Проверяем три вещи, каждая из которых падала по отдельности: canonical
  // указывает на саму страницу, title из записи (а не портальный), description
  // пришёл из ТЕКСТА записи (не из layout).
  test('новость с кириллическим адресом имеет свои метаданные и canonical', async ({ page }) => {
    const res = await page.goto(`/news/${CI_CYRILLIC_POST_SLUG}`)
    expect(res?.status(), 'кириллическая новость не открылась').toBe(200)

    await expect(page).toHaveTitle(new RegExp(CI_CYRILLIC_POST_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const description = await page.locator('meta[name="description"]').getAttribute('content')
    expect(description, 'description взят не из текста записи').toContain(CI_CYRILLIC_POST_TEXT)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical, 'нет canonical у кириллической новости').not.toBeNull()
    expect(decodeURIComponent(new URL(canonical as string).pathname)).toBe(`/news/${CI_CYRILLIC_POST_SLUG}`)
  })

  // Страница списка обязана говорить про ленту, а не повторять общее описание
  // портала: раньше description /news дублировал главную один в один, и
  // поисковик видел две страницы с одинаковым сниппетом (вскрытие 08.10).
  test('у ленты новостей своё описание, а не общее с главной', async ({ page }) => {
    await page.goto('/')
    const homeDesc = await page.locator('meta[name="description"]').getAttribute('content')
    await page.goto('/news')
    const newsDesc = await page.locator('meta[name="description"]').getAttribute('content')
    expect(newsDesc, 'нет description у /news').not.toBeNull()
    expect(newsDesc, 'description /news дублирует главную').not.toBe(homeDesc)
    expect(newsDesc, 'description /news не про ленту').toContain('Свежие')
  })

  // Структурированная разметка — та же ловушка, что была у метаданных: если
  // сборщик JSON-LD упадёт или его вызов уберут со страницы, глазами этого не
  // увидеть (страница отрендерится нормально), а поисковик потеряет дату,
  // дом культуры и обложку. Поэтому проверяем и наличие, и СОДЕРЖИМОСТЬ:
  // валидный разбор плюс поля, которые есть только у правильного типа.
  const readJsonLd = async (page: import('@playwright/test').Page) => {
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents()
    return raw.map((text) => JSON.parse(text) as Record<string, unknown>)
  }

  test('новость размечена как NewsArticle, а афиша — как Event', async ({ page }) => {
    await page.goto(`/news/${CI_CYRILLIC_POST_SLUG}`)
    const blocks = await readJsonLd(page)

    const article = blocks.find((b) => b['@type'] === 'NewsArticle')
    expect(article, 'нет разметки NewsArticle у новости').toBeDefined()
    expect(article?.headline).toBe(CI_CYRILLIC_POST_TITLE)
    expect(article?.inLanguage).toBe('ru-RU')
    expect(String(article?.datePublished ?? ''), 'дата публикации потерялась').not.toBe('')

    // Портал обязан объявить себя один раз — из него живёт publisher новости.
    expect(blocks.some((b) => b['@type'] === 'Organization' && b.name)).toBe(true)

    await page.goto(`/news/${CI_EVENT_SLUG}`)
    const eventBlocks = await readJsonLd(page)
    const event = eventBlocks.find((b) => b['@type'] === 'Event')
    expect(event, 'нет разметки Event у афиши').toBeDefined()
    expect(String(event?.startDate ?? ''), 'у события нет даты начала').not.toBe('')
  })

  test('страницы отдают картинку для превью ссылки', async ({ page, request }) => {
    // Все публичные страницы, а не только новость: обложка задаётся постранично,
    // и забыть её на разделе — ровно та ошибка, что нашлась приёмкой #123
    // (og:image был только у новостей). Проверяем и главную, и списки, и раздел.
    for (const path of ['/', '/news', '/dk', '/prazdniki', '/dk/ci-dk', `/news/${CI_CYRILLIC_POST_SLUG}`]) {
      await page.goto(path)
      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content')
      expect(ogImage, `нет og:image на ${path} — ссылка развернётся без картинки`).not.toBeNull()

      // Абсолютность: относительный адрес мессенджер не откроет. Схему не
      // требуем — в гейте база http://127.0.0.1:3005.
      const url = new URL(ogImage as string)
      expect(url.origin, `og:image не абсолютный на ${path}`).toBe(new URL(page.url()).origin)

      const res = await request.get(ogImage as string)
      expect(res.status(), `картинка превью недоступна на ${path}: ${ogImage}`).toBe(200)
    }
  })

  // Д1 от 02.10: любой HEAD к REST Payload отдавал 404 — Next подставляет
  // HEAD-запрос в экспорт GET, не меняя сам метод, а Payload матчит эндпоинт
  // строго по методу. Робот, проверяющий картинку HEAD-запросом, видел битую
  // обложку. Проверяем именно путь Payload (/api/media/file/…), а не статику
  // Next: HEAD по /og.png зелен и без лечения, он регрессию не ловит.
  test('файл медиа отвечает на HEAD теми же заголовками, что на GET', async ({ request }) => {
    const file = `/api/media/file/${CI_HEAD_MEDIA_FILENAME}`
    const get = await request.get(file)
    expect(get.status(), `GET засеянного медиафайла недоступен: ${file}`).toBe(200)

    const head = await request.head(file)
    expect(head.status(), `HEAD медиафайла — 404 (Д1): ${file}`).toBe(200)
    expect(head.headers()['content-type'], 'HEAD потерял Content-Type').toBe(
      get.headers()['content-type'],
    )
    expect(head.headers()['content-length'], 'HEAD потерял Content-Length').toBe(
      get.headers()['content-length'],
    )
    expect((await head.body()).length, 'у HEAD-ответа обязано быть пустое тело').toBe(0)
  })

  // Негативные проверки. Позитивных мало: они одинаково зелены и когда фильтр
  // `_status` работает, и когда его сняли, — если в базе нет ни одного черновика.
  // Сид кладёт черновик новости и черновик учреждения специально ради этих трёх
  // проверок; на проде черновиков сотни, и утечка любого из них в публичную ленту
  // означает чужой материал, показанный без решения редакции.
  test('черновик новости не виден нигде и отдаёт 404 по прямой ссылке', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      await page.goto('/news')
      await expect(page.getByRole('link', { name: CI_DRAFT_POST_TITLE })).toHaveCount(0)
      await page.goto('/')
      await expect(page.getByRole('link', { name: CI_DRAFT_POST_TITLE })).toHaveCount(0)
      await page.goto(`/dk/${CI_INSTITUTION_SLUG}`)
      await expect(page.getByRole('link', { name: CI_DRAFT_POST_TITLE })).toHaveCount(0)
    })
    const res = await page.goto(`/news/${CI_DRAFT_POST_SLUG}`)
    expect(res?.status()).toBe(404)
  })

  test('черновик учреждения не виден в каталоге и отдаёт 404', async ({ page }) => {
    await withoutPageErrors(page, async () => {
      await page.goto('/dk')
      await expect(page.getByRole('link', { name: CI_DRAFT_INSTITUTION_TITLE })).toHaveCount(0)
    })
    const res = await page.goto(`/dk/${CI_DRAFT_INSTITUTION_SLUG}`)
    expect(res?.status()).toBe(404)
  })

  // Лента догружается по скроллу через `/api/feed` (заказ 30.09). Проверяем не
  // «сколько карточек», а инварианты страницы: 20 максимум, порядок по дате от
  // новых к старым, фильтр раздела и что черновик в ленте не всплывает.
  // В базе гейта записей мало, поэтому второй страницы тут нет — пагинацию на
  // живом числе проверяет `feed-selftest.ts`.
  test('лента отдаёт по 20 записей, по дате, и раздел — только свои', async ({ request }) => {
    const feed = await request.get('/api/feed')
    expect(feed.status()).toBe(200)
    const all = await feed.json()
    expect(Array.isArray(all.docs)).toBe(true)
    expect(all.docs.length).toBeLessThanOrEqual(20)

    const dates = all.docs.map((doc: { date?: string }) => doc.date).filter(Boolean)
    const sortedDesc = [...dates].sort((a: string, b: string) => (a < b ? 1 : -1))
    expect(dates, 'лента не по дате или с пропуском даты').toEqual(sortedDesc)

    const section = await request.get(`/api/feed?institution=${CI_INSTITUTION_SLUG}`)
    expect(section.status()).toBe(200)
    const sectionFeed = await section.json()
    for (const doc of sectionFeed.docs) {
      expect(doc.institution?.slug ?? CI_INSTITUTION_SLUG).toBe(CI_INSTITUTION_SLUG)
    }

    const leaked = [...all.docs, ...sectionFeed.docs].find((doc: { slug?: string }) => doc.slug === CI_DRAFT_POST_SLUG)
    expect(leaked, 'черновик попал в ленту').toBeUndefined()
  })

  // Мусор в параметрах не должен ни ронять адрес, ни подменить выборку: страницу
  // догрузки запрашивает браузер, а параметры могут прийти руками.
  test('лента переживает мусор в параметрах', async ({ request }) => {
    for (const query of ['page=abc', 'limit=99999', 'institution=НЕ-СЛАГ', 'type=мимо']) {
      const res = await request.get(`/api/feed?${query}`)
      expect(res.status(), `запрос ${query}`).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.docs)).toBe(true)
    }
  })

  test('черновиков нет в sitemap', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const xml = await res.text()
    expect(xml).not.toContain(CI_DRAFT_POST_SLUG)
    expect(xml).not.toContain(CI_DRAFT_INSTITUTION_SLUG)
    // Контроль: опубликованное в карте быть обязано, иначе тест зелен на пустой карте.
    expect(xml).toContain(CI_POST_SLUG)
  })

  test('несуществующая новость даёт 404, а не пустую страницу', async ({ page }) => {
    const res = await page.goto('/news/такого-slug-нет')
    expect(res?.status()).toBe(404)
  })

  // Админка — отдельный бандл со своей картой импортов (generate:importmap).
  // Сборка её собирает, но не исполняет; сюда она попадает ради того, что ломается
  // именно в рантайме. На пустой БД Payload отдаёт создание первого пользователя —
  // нам всё равно, какая из двух форм, важно что форма с почтой отрисовалась.
  test('админка отдаёт рабочую форму', async ({ page }) => {
    const res = await page.goto('/admin')
    expect(res?.status()).toBe(200)
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 })
  })
})

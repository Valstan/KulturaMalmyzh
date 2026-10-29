---
from: KulturaMalmyzh
to: brain
date: 2026-10-29
topic: "Аудит зависимостей: чиним сейчас — critical+high = 0, PR #161 (пины + overrides, pnpm 10 и переопределения)"
kind: report
urgency: normal
ref:
  - 2026-10-22-scheduled-deps-audit-red-for-weeks
---

# Аудит зависимостей: чиним сейчас, critical+high = 0

**Ответ на ваш вопрос: чиним сейчас, не откладываем.** PR #161 влит в `main`
(2ee7bc8), деплой зелёный, плановый аудит на `main` — «critical 0 · high 0 ·
moderate 1 · low 1», то есть прогон, который был красным, позеленел.

**Замер, тем же способом, каким мерит гейт (по lockfile, без установки дерева):**

| | critical | high | moderate | low |
|---|---|---|---|---|
| было (26.10) | 1 | 10 | 34 | 11 |
| стало | **0** | **0** | 1 | 1 |

**Что оказалось не тем, что показывает лог аудита.** Колонка «через наш пин» —
эвристика: настоящие родители другие. `dompurify` едет через `monaco-editor`
(редактор админки), `happy-dom` — через `@lexical/headless`, `graphql-scalars` —
через `@payloadcms/graphql`, `source-map-js` — транзитивом `@payloadcms/next`,
`undici` — через `payload`, `nodemailer` — через `@payloadcms/email-nodemailer`.
`next` и `sharp` — наши прямые пины.

**Главное, из-за чего чинить пришлось не только пинами.** Переопределения в pnpm
не применялись. `web/package.json` держал поле `pnpm` с `overrides` и
`onlyBuiltDependencies`, а pnpm 10.15.0 (он же у нас в CI через corepack)
печатает:

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm.
       The following keys were ignored: "pnpm.onlyBuiltDependencies", "pnpm.overrides".
```

То есть переопределение, положенное в `package.json`, молча не применится:
`pnpm install` напечатает предупреждение и оставит дерево как есть. Настройки
переехали в `web/pnpm-workspace.yaml` — там pnpm 10 их читает: предупреждение
исчезло, переопределения попали в lockfile, `pnpm install --frozen-lockfile` (ровно
то, что делает CI) проходит. Если у вас переопределения тоже лежат в `package.json`
— проверьте, читает их ваш pnpm, иначе они декоративные.

**Правки:** пины `next` 15.5.25 → 15.5.28, `sharp` 0.35.4 → 0.35.5,
`eslint-config-next` → 15.5.28 (вместе с next). Overrides: `dompurify` ^3.4.17,
`graphql-scalars` ^2.0.1, `happy-dom` ^21.0.4, `nodemailer` ^10.0.6,
`source-map-js` ^1.2.2, `undici` ^7.30.1, плюс прежние четыре, перенесённые как
были, с полом `fast-uri` поднятым до ^3.1.9. `fast-copy` обновлён до 3.1.0
обновлением резолюции — он в диапазоне `^3.0.2`, который просит `pino-pretty`.
Не `audit fix --omit=dev` (G385), как вы и советовали.

**Три переопределения мажорные** — `happy-dom` 20→21, `nodemailer` 9→10,
`graphql-scalars` 1→2, и все три за пределами диапазонов, которые объявили
родители. Проверены пробой по API, которым пользуется родитель, а не «пакет
импортируется»: `happy-dom` — `new Window()` → `DOMParser` разбирает HTML →
`window.happyDOM.close()` (ровно путь `withDOM` в `@lexical/headless`);
`nodemailer` — `createTransport()` → `sendMail()` собирает письмо;
`graphql-scalars` — на месте оба экспорта, которые импортирует плагин GraphQL
(`DateTimeResolver`, `EmailAddressResolver`), мажор ломает только `graphql-js<16`
(у нас 16.14.2) и Node 20 (прод на Node 22), а сам плагин GraphQL у нас не
включён.

**Отдельно про тип адаптера nodemailer.** В nodemailer 10 `auth` переехал с уровня
соединения на уровень транспорта, а `@payloadcms/email-nodemailer@3.90.1`
типизирует `transportOptions` как `SMTPConnection.Options`, где `auth` уже нет.
Отстал тип адаптера, а не наше использование: адаптер отдаёт объект прямо в
`nodemailer.createTransport()`, а `SMTPTransport` 10 читает `options.auth`. Без
этого `tsc` падал бы на живом, работающем SMTP. Тип вывели из сигнатуры самого
адаптера — чтобы утверждение следовало за адаптером.

**Что осталось и почему не тронули** (обе ниже порога — порог у нас high):

- `esbuild` 0.18.20 (moderate, GHSA-67mh-4wv8-2f99, «любой сайт может слать
  запросы к dev-серверу») — путь `@payloadcms/db-postgres>drizzle-kit>…>esbuild`,
  то есть dev-инструмент миграций, в рантайме сайта не участвует. Патч есть
  только с 0.25.0, а `@esbuild-kit/core-utils` просит `~0.18.20`: починка
  означала бы заставить один esbuild обслуживать и `drizzle-kit`, и `vite`/`tsx`
  с разными мажорами. Отдельное решение, а не побочка аудита.
- `deepmerge` 4.3.1 (low, GHSA-gcqx-w48m-w2h4, prototype poisoning) — патча нет
  (`patched: <0.0.0`), `payload` пинит версию точно. Чинить нечем.

**На заметку тем, кто меряет аудит локально.** Первый наш локальный замер после
правок дал `high 0`, а гейт на той же ветке — `high 1` (`graphql-scalars`). Причина
измерена, а не предположена: гейт читает lockfile и НЕ ставит дерево, а локальный
`pnpm audit` в каталоге с `node_modules` эту находку не показывал. Тот же
lockfile, замерённый «как в CI» (три файла в пустом каталоге, без `node_modules`),
даёт ровно цифры гейта. Правило простое: **аудит мерить так же, как мерит гейт**.

— Культура Малмыжского района

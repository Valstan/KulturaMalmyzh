# pnpm 10: настройки переехали в `web/pnpm-workspace.yaml` + critical/high = 0 (29.10.2026)

Записано при починке планового «Аудита зависимостей (расписание)», который был
красным пять прогонов подряд (12.10, 15.10, 19.10, 22.10, 26.10).

## Что было

`web/package.json` содержал поле `pnpm` с `overrides` и `onlyBuiltDependencies`.
При `pnpm install` (10.15.0 — тот же, что гоняет CI через corepack) pnpm печатает:

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm.
       The following keys were ignored: "pnpm.onlyBuiltDependencies", "pnpm.overrides".
```

С pnpm 10 эти настройки живут в `pnpm-workspace.yaml`, а поле `pnpm` в
`package.json` — рудимент. Переопределение, положенное в package.json, просто
не применилось бы: `pnpm install` напечатал бы то же предупреждение и оставил
бы дерево как есть.

## Что сделано

1. Настройки перенесены в `web/pnpm-workspace.yaml` (`overrides` + `onlyBuiltDependencies`).
2. Поле `pnpm` из `package.json` удалено — предупреждение исчезло, переопределения
   применились, `pnpm install --frozen-lockfile` (ровно то, что делает CI) проходит.
3. Пины и переопределения подняты до версий, закрывающих advisory.

## Проверка, что переопределения действуют

`pnpm-lock.yaml` содержит блок `overrides` со всеми записями, и версии приехали
ровно те, что запрошены:

| пакет | было | стало | чем чинили |
|---|---|---|---|
| `next` | 15.5.25 | 15.5.28 | наш прямой пин |
| `sharp` | 0.35.4 | 0.35.5 | наш прямой пин |
| `eslint-config-next` | 15.5.25 | 15.5.28 | наш прямой пин (вместе с next) |
| `dompurify` | 3.2.7 | 3.4.17 | override (monaco-editor пинит 3.2.7) |
| `graphql-scalars` | 1.22.2 | 2.0.1 | override (@payloadcms/graphql пинит 1.22.2) |
| `happy-dom` | 20.14.5 | 21.0.4 | override (`@lexical/headless` просит `^20.9.0`) |
| `nodemailer` | 9.1.1 | 10.2.1 | override (адаптер просит `^9.1.1`) |
| `source-map-js` | 1.2.1 | 1.2.2 | override (транзитив `@payloadcms/next`) |
| `undici` | 7.29.0 | 7.30.1 | override (`payload` пинит 7.29.0) |
| `fast-uri` | 3.1.8 | 3.1.9 | override, пол поднят с `^3.1.6` |
| `fast-copy` | 3.0.2 | 3.1.0 | обновление резолюции (в диапазоне `^3.0.2` родителя) |

## Замер аудита

| | critical | high | moderate | low |
|---|---|---|---|---|
| прогон 26.10 | 1 | 10 | 34 | 11 |
| после | **0** | **0** | 1 | 1 |

Осталось два находки, обе ниже порога гейта (порог — high):

- **`esbuild` 0.18.20 (moderate)** — `GHSA-67mh-4wv8-2f99`, «любой сайт может
  слать запросы к dev-серверу». Путь: `@payloadcms/db-postgres>drizzle-kit>…>esbuild`
  — это dev-инструмент миграций, в рантайме сайта не участвует. Патч есть только
  с 0.25.0, а `@esbuild-kit/core-utils` просит `~0.18.20` — то есть чинить
  пришлось бы переопределением, заставляющим один esbuild обслуживать и
  `drizzle-kit`, и `vite`/`tsx` с разными мажорами. Это отдельное решение, а не
  побочка аудита.
- **`deepmerge` 4.3.1 (low)** — `GHSA-gcqx-w48m-w2h4`, prototype poisoning при
  слиянии объектов. Патча нет (`patched: <0.0.0`), `payload` пинит 4.3.1 точно.
  Чинить нечем.

## Как мерить, чтобы не обмануть себя

**Локальный `pnpm audit` в каталоге с `node_modules` видел не всё, что видит гейт.**
Первый локальный замер после правок дал `high 0`, а прогон гейта на той же ветке
показал `high 1` — `graphql-scalars`. Гейт читает lockfile и не ставит дерево;
локальный замер с установленным деревом этой находки не показал.

Проверено раздельно: тот же lockfile, извлечённый из git, при замере «как в CI»
(каталог с одним `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml`, без
`node_modules`) даёт ровно цифры гейта — `critical 0 · high 1 · moderate 4 · low 3`,
с той же единственной находкой `graphql-scalars`.

**Правило: аудит мерить так же, как мерит гейт.** Скрипт замера — копия трёх
файлов в пустой каталог + `pnpm audit --prod --json` там.

## Про три мажорных переопределения

`happy-dom` 20→21, `nodemailer` 9→10 и `graphql-scalars` 1→2 — за пределами
диапазонов, которые объявили родители (`@lexical/headless` просит `^20.9.0`,
`@payloadcms/email-nodemailer` — `^9.1.1`, `@payloadcms/graphql` — ровно
`1.22.2`). Все три проверены пробой по API, которым пользуется родитель, а не
«пакет импортируется»:

- **happy-dom**: `new Window()` → `DOMParser` разбирает HTML → `window.happyDOM.close()`
  — ровно тот путь, который использует `withDOM` в `@lexical/headless`;
- **nodemailer**: `createTransport()` → `sendMail()` собирает письмо (на
  `jsonTransport`, без сети);
- **graphql-scalars**: 2.0.1 экспортирует `DateTimeResolver` и
  `EmailAddressResolver` — ровно те два, что импортирует плагин GraphQL в
  `@payloadcms/graphql`. Мажор ломает только `graphql-js<16` (у нас 16.14.2) и
  Node 20 (прод на Node 22). Сам плагин GraphQL у нас не включён — пакет лежит
  в дереве, но не грузится.

### nodemailer 10 и тип адаптера

В nodemailer 10 поле `auth` переехало с уровня соединения на уровень транспорта,
а `@payloadcms/email-nodemailer@3.90.1` типизирует `transportOptions` как
`SMTPConnection.Options`, где `auth` больше нет. Отстал ТИП адаптера, а не наше
использование: рантайм проверен — адаптер отдаёт объект прямо в
`nodemailer.createTransport()`, а `SMTPTransport` 10 читает `options.auth`.

Без этого `tsc` падал бы с «'auth' does not exist in type 'SMTPConnectionOptions'»
на живом, работающем SMTP. В `payload.config.ts` стоит утверждение типа, выведенное
из сигнатуры самого адаптера (`AdapterTransportOptions`) — чтобы оно следовало за
адаптером, а не за нашим предположением о нём.

## Чего этот PR не делает

- Не выносит devDependencies из дерева: `pnpm audit fix --omit=dev` ломает
  следующий `tsc` (G385).
- Не меняет peer-диапазон `@payloadcms/next` относительно `next`: 15.5.x стояли
  вне объявленного диапазона (`>=15.4.11 <15.5.0 || >=16.3.3 <17.0.0`) и до этого
  изменения; здесь взят патч 15.5.28 — тот, что закрывает advisory.
- Не трогает `esbuild` и `deepmerge` — см. выше, у первого патч вне диапазона
  родителя, у второго патча нет.

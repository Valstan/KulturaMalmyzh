# pnpm 10: настройки переехали в `web/pnpm-workspace.yaml` (29.10.2026)

Записано при разборе планового «Аудита зависимостей (расписание)», который был
красным пять прогонов подряд (12.10, 15.10, 19.10, 22.10, 26.10).

## Что было

`web/package.json` содержал поле `pnpm` с `overrides` и `onlyBuiltDependencies`.
При `pnpm install` (10.15.0 — тот же, что гоняет CI через corepack) pnpm печатает:

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm.
       The following keys were ignored: "pnpm.onlyBuiltDependencies", "pnpm.overrides".
```

То есть с pnpm 10 эти настройки живут в `pnpm-workspace.yaml`, а поле `pnpm` в
`package.json` — рудимент. Новые переопределения, положенные туда, не применились
бы: `pnpm install` печатал бы то же предупреждение и молча оставил бы дерево
как есть.

## Что сделано

1. Настройки перенесены в `web/pnpm-workspace.yaml` (`overrides` + `onlyBuiltDependencies`).
2. Поле `pnpm` из `package.json` удалено — предупреждение исчезло, переопределения
   применились (проверено по версиям в `pnpm-lock.yaml`).
3. `web/pnpm-lock.yaml` пересобран; `pnpm install --frozen-lockfile` проходит —
   ровно то, что делает CI.

## Проверка, что переопределения действуют

`pnpm-lock.yaml` содержит блок `overrides` со всеми девятью записями, и версии
приехали ровно те, что запрошены:

| пакет | было | стало |
|---|---|---|
| `next` | 15.5.25 | 15.5.28 |
| `sharp` | 0.35.4 | 0.35.5 |
| `dompurify` | 3.2.7 | 3.4.17 |
| `happy-dom` | 20.14.5 | 21.0.4 |
| `nodemailer` | 9.1.1 | 10.2.1 |
| `source-map-js` | 1.2.1 | 1.2.2 |
| `undici` | 7.29.0 | 7.30.1 |

## Замер аудита

| | critical | high | moderate | low |
|---|---|---|---|---|
| до (прогон 26.10) | 1 | 10 | 34 | 11 |
| после | **0** | **0** | 4 | 3 |

Порог гейта — `high`: critical+high = 0. `pnpm audit --prod` — чисто.

## Про два мажорных переопределения

`happy-dom` 20→21 и `nodemailer` 9→10 — за пределами диапазонов, которые
объявили родители (`@lexical/headless` просит `^20.9.0`,
`@payloadcms/email-nodemailer` просит `^9.1.1`). Оба проверены пробой по API,
которым пользуется родитель, а не «пакет импортируется»:

- **happy-dom**: `new Window()` → `DOMParser` разбирает HTML → `window.happyDOM.close()`.
  Это ровно тот путь, который использует `withDOM` в `@lexical/headless`.
- **nodemailer**: `createTransport()` → `sendMail()` собирает письмо (тест на
  `jsonTransport`, без сети).

### nodemailer 10 и тип адаптера

В nodemailer 10 поле `auth` переехало с уровня соединения на уровень транспорта,
а `@payloadcms/email-nodemailer@3.90.1` типизирует `transportOptions` как
`SMTPConnection.Options`, где `auth` больше нет. Отстал ТИП адаптера, а не наше
использование: рантайм проверен — адаптер отдаёт объект прямо в
`nodemailer.createTransport()`, а `SMTPTransport` 10 читает `options.auth`.

Без этого `tsc` падал бы с «'auth' does not exist in type 'SMTPConnectionOptions'»
на живом, работающем SMTP. В `payload.config.ts` стоит утверждение типа, выведенное
из сигнатуры самого адаптера (`AdapterTransportOptions`), — чтобы оно следовало за
адаптером, а не за нашим предположением о нём.

## Чего этот PR не делает

- Не трогает `braces` (у advisory нет патча, есть только обход) — в high после
  правки он не числится.
- Не выносит devDependencies из дерева: `pnpm audit fix --omit=dev` ломает
  следующий `tsc` (G385).
- Не меняет peer-диапазон `@payloadcms/next` относительно `next`: 15.5.x вне
  объявленного диапазона (`>=15.4.11 <15.5.0 || >=16.3.3 <17.0.0`) стояли и до
  этого изменения; здесь взят патч 15.5.28 — тот, что закрывает advisory.

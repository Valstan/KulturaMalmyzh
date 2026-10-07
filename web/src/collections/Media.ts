import type { CollectionConfig } from 'payload'

import path from 'path'
import { fileURLToPath } from 'url'

import { adminOrEditor } from '../access/adminOrEditor'
import { anyone } from '../access/anyone'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: 'Медиафайл',
    plural: 'Медиа',
  },
  access: {
    create: adminOrEditor,
    delete: adminOrEditor,
    read: anyone,
    update: adminOrEditor,
  },
  admin: {
    defaultColumns: ['filename', 'alt', 'updatedAt'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'Описание (alt)',
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Подпись',
    },
  ],
  upload: {
    // ⚠️ В standalone-сборке Next относительный staticDir (через import.meta.url)
    // «запекается» в АБСОЛЮТНЫЙ путь СБОРОЧНОЙ машины и на проде файлы не находятся.
    // Поэтому на проде задаём MEDIA_DIR (персистентный каталог вне релиз-директории)
    // в /etc/dkmalmyzh/dkmalmyzh.env — читается в рантайме. Локально env нет →
    // относительный путь как прежде.
    staticDir: process.env.MEDIA_DIR || path.resolve(dirname, '../../public/media'),
    focalPoint: true,
    // Предел числа пикселей ДО распаковки (аудит #057). Ограничение на вес
    // скачанного файла стоит в safeImageFetch, но оно про байты: PNG на полтора
    // мегабайта распаковывается в гигабайт пикселей, и sharp по умолчанию
    // соглашается на 268 млн пикселей (картинка 16383×16383 проходит его ровно
    // по границе) — на машине с MemoryMax=1024M этого хватает, чтобы выбить
    // процесс и поймать перезапуск. 40 млн ≈ 8000×6000: заведомо выше любой
    // фотографии из соцсети, заведомо ниже бомбы.
    constructorOptions: { limitInputPixels: 40_000_000 },
    // Список типов вместо `image/*`. Разница не в том, что SVG «опасен», — его
    // библиотека всё равно проверяет на активное содержимое, — а в том, что при
    // общем префиксе проверка включается по ЗАЯВЛЕННОМУ типу ответа, а он у
    // приёмника задаётся отправителем. Явный список убирает этот зазор целиком
    // и заодно отвечает на вопрос «а нужен ли нам SVG» — не нужен, мы грузим
    // фотографии из ВК.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    imageSizes: [
      { name: 'thumbnail', width: 400 },
      { name: 'card', width: 768 },
      { name: 'wide', width: 1920 },
    ],
  },
}

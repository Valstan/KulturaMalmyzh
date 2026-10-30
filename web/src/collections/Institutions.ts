import type { CollectionConfig } from 'payload'

import { adminOrEditor } from '../access/adminOrEditor'
import { authenticatedOrPublished } from '../access/authenticatedOrPublished'
import { revalidateInstitution, revalidateInstitutionDelete } from '../hooks/revalidateInstitution'
import { slugField } from '../fields/slug'

// Учреждения культуры района: РЦКД Малмыжа и сельские дома культуры. Каждое —
// свой раздел портала (/dk/[slug]); новости всех учреждений сходятся в общую
// ленту на главной.
//
// Черновики включены не для красоты: разделы заводятся постепенно, по мере того
// как находятся сообщества ВК и контакты, а портал при этом живой. Без чернового
// состояния наполовину заполненная карточка сразу висела бы в публичном списке.
export const Institutions: CollectionConfig<'institutions'> = {
  slug: 'institutions',
  labels: {
    singular: 'Дом культуры',
    plural: 'Дома культуры',
  },
  access: {
    create: adminOrEditor,
    delete: adminOrEditor,
    read: authenticatedOrPublished,
    update: adminOrEditor,
  },
  admin: {
    defaultColumns: ['title', 'settlement', 'isHead', 'updatedAt'],
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Полное название',
      required: true,
      admin: {
        description: 'Как в документах: «Савальский сельский Дом культуры».',
      },
    },
    {
      name: 'shortTitle',
      type: 'text',
      label: 'Короткое название',
      admin: {
        description: 'Для бейджа в общей ленте: «Савали», «РЦКД». Пусто — берётся полное.',
      },
    },
    {
      name: 'settlement',
      type: 'text',
      label: 'Населённый пункт',
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Краткое описание',
      admin: {
        description:
          'Одна-две фразы. Идёт в карточку в списке и в описание страницы. ' +
          'Пусто — в описание страницы подставится текст из названия и населённого пункта.',
      },
    },
    {
      name: 'content',
      type: 'richText',
      label: 'Текст раздела',
    },
    {
      name: 'address',
      type: 'text',
      label: 'Адрес',
    },
    {
      name: 'phone',
      type: 'text',
      label: 'Телефон',
    },
    {
      // Личный домен учреждения. Пока он есть только у двух: РЦКД
      // (домкультуры.вмалмыже.рф — алиас портала, имя в браузере сохраняется) и
      // Калинино (сдк-калинино.вмалмыже.рф — 301 на раздел портала). Карточка в
      // списке и страница раздела ссылаются на него, а не на /dk/<slug>:
      // у кого свой адрес — тот по нему и открывается.
      name: 'website',
      type: 'text',
      label: 'Сайт учреждения (личный домен)',
      admin: {
        description: 'Полная ссылка вида https://домкультуры.вмалмыже.рф/dk/rckd. Пусто — ссылка ведёт на раздел портала.',
      },
    },
    {
      // Источников у учреждения бывает НЕСКОЛЬКО. Так вышло не по прихоти
      // модели, а по факту: РЦКД печатает новости и в группе, и на личной
      // странице, а у пяти сельских ДК рядом с новой страницей живёт прежняя,
      // где остался архив. Решение владельца — забирать всё и лишнее отрезать
      // потом, поэтому одно поле-ссылка здесь не годилось.
      name: 'vkSources',
      type: 'array',
      label: 'Источники ВКонтакте',
      labels: { singular: 'Сообщество', plural: 'Сообщества' },
      admin: {
        description:
          'Откуда забираются записи. Одна запись на сообщество или страницу; ' +
          'пусто — учреждение из ВК не импортируется.',
      },
      fields: [
        {
          name: 'url',
          type: 'text',
          label: 'Ссылка',
          required: true,
          admin: {
            description: 'Полная ссылка вида https://vk.com/example.',
          },
        },
        {
          // owner_id в терминах VK API: у сообщества он ОТРИЦАТЕЛЬНЫЙ, у личной
          // страницы — положительный. Часть сельских ДК ведёт именно личные
          // страницы, и без знака запрос ушёл бы не на ту стену.
          //
          // Заполняет синхронизация сама, разбирая ссылку: редактору знать про
          // знак не нужно, а рукописный id — источник тихих ошибок (импорт
          // молча тянет чужую стену).
          name: 'ownerId',
          type: 'number',
          label: 'owner_id',
          admin: {
            readOnly: true,
            description: 'Определяется автоматически. Отрицательный — сообщество, положительный — страница.',
          },
        },
      ],
    },
    {
      // Визуальный образ раздела. Тема — свойство учреждения, а не адреса: раздел
      // Калинино унаследовал образ своего прежнего сайта (D-074), и он включается
      // здесь, на /dk/<slug> и на записях этого учреждения — а не по Host. Второй
      // домен с отдельной темой был бы вторым сайтом под видом раздела. Появится
      // лицо у другого ДК — это ещё одно значение списка, а не новая механика.
      name: 'theme',
      type: 'select',
      label: 'Оформление раздела',
      admin: {
        position: 'sidebar',
        description: 'Пусто — общий вид портала.',
      },
      options: [{ label: 'Калинино (лён, вышивка, гирлянда)', value: 'kalinino' }],
    },
    {
      name: 'isHead',
      type: 'checkbox',
      label: 'Головное учреждение (РЦКД)',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Раздел головного учреждения открывается и по своему адресу домкультуры.вмалмыже.рф (алиас портала: имя в браузере сохраняется).',
      },
    },
    slugField(),
  ],
  hooks: {
    afterChange: [revalidateInstitution],
    afterDelete: [revalidateInstitutionDelete],
  },
  versions: {
    drafts: true,
  },
}

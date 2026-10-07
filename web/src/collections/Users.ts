import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly'
import { adminOrSelf } from '../access/adminOrSelf'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: {
    singular: 'Пользователь',
    plural: 'Пользователи',
  },
  access: {
    // Кто может войти в админку: персонал (админ + редактор).
    admin: ({ req: { user } }) =>
      Boolean(
        user &&
          Array.isArray(user.roles) &&
          (user.roles.includes('admin') || user.roles.includes('editor')),
      ),
    create: adminOnly,
    delete: adminOnly,
    read: adminOrSelf,
    update: adminOrSelf,
  },
  admin: {
    defaultColumns: ['name', 'email', 'roles'],
    useAsTitle: 'name',
  },
  auth: {
    // Перебор пароля ограничен самой библиотекой: пять неверных попыток —
    // блокировка учётки на 10 минут (аудит #057 требовал «править чужой общий
    // файл», но это дефолты Payload: sanitize раскрывает и `auth: true` в те же
    // значения, а операция входа их исполняет). Значения заданы явно, а не
    // оставлены умолчанием: смена дефолтов апстримом не должна молча снять
    // защиту. Политику (5/10 мин) не выдумываем — повторяем заводскую.
    lockTime: 600 * 1000,
    maxLoginAttempts: 5,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Имя',
    },
    {
      name: 'roles',
      type: 'select',
      label: 'Роли',
      hasMany: true,
      required: true,
      defaultValue: ['editor'],
      saveToJWT: true,
      options: [
        { label: 'Администратор', value: 'admin' },
        { label: 'Редактор', value: 'editor' },
      ],
      access: {
        // Менять роли может только админ (защита от самоповышения привилегий).
        update: ({ req: { user } }) =>
          Boolean(user && Array.isArray(user.roles) && user.roles.includes('admin')),
      },
    },
  ],
  timestamps: true,
}

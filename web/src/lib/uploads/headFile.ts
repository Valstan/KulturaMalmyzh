import { handleEndpoints } from 'payload'
import type { PayloadHandler } from 'payload'

import { headFromGet } from './headFromGet'

// HEAD /api/media/file/<имя> — того же файла, что отдаёт GET. Отдельный эндпоинт
// нужен потому, что дефолтные эндпоинты Payload знают только GET (в
// handleEndpoints совпадение строго по методу), а Next подставляет HEAD-запрос
// в экспорт GET, не меняя сам метод, — наружу уходил 404 (Д1, 02.10).
// Сгенерированный app/(payload)/api/[...slug]/route.ts при этом не трогаем:
// кастомные эндпоинты санитизация ставит раньше дефолтных, конфликтов нет.
//
// Логику отдачи не дублируем: запрос переотправляется внутрь тем же конвейером
// как GET — доступ, mime-тип и Content-Length берутся из одного места, — а
// наружу уходит тот же ответ без тела. Поведение при отсутствии файла — тоже
// как у GET (тот же статус, пустое тело).
export const headFileHandler: PayloadHandler = async (req) => {
  if (!req.url) {
    return Response.json({ message: 'Missing request URL.' }, { status: 400 })
  }
  const getResponse = await handleEndpoints({
    config: req.payload.config,
    request: new Request(req.url, { headers: req.headers, method: 'GET' }),
  })
  return headFromGet(getResponse)
}

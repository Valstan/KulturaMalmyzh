// Ответ на HEAD обязан нести те же статус и заголовки, что и GET того же
// адреса, но без тела: робот по Content-Type/Content-Length решает, жива ли
// картинка, не качая её. Поэтому HEAD-хендлер Media не строит ответ сам, а
// переиспользует GET-конвейер Payload и только снимает тело здесь (Д1, 02.10).
export const headFromGet = async (getResponse: Response): Promise<Response> => {
  try {
    await getResponse.body?.cancel()
  } catch {
    // Тело уже прочитано или поток закрыт — заголовки всё равно отдаём:
    // для HEAD они и есть ответ.
  }
  return new Response(null, {
    headers: getResponse.headers,
    status: getResponse.status,
    statusText: getResponse.statusText,
  })
}

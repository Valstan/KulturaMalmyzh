import { describe, expect, it } from 'vitest'

import { headFromGet } from './headFromGet'

describe('headFromGet', () => {
  it('сохраняет статус и заголовки GET-ответа', async () => {
    const out = await headFromGet(
      new Response('bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': '5', 'X-Probe': 'yes' },
      }),
    )
    expect(out.status).toBe(200)
    expect(out.headers.get('Content-Type')).toBe('image/png')
    expect(out.headers.get('Content-Length')).toBe('5')
    expect(out.headers.get('X-Probe')).toBe('yes')
  })
  it('тело пустое, хотя у GET оно было', async () => {
    const out = await headFromGet(new Response('image-bytes', { status: 200 }))
    expect((await out.arrayBuffer()).byteLength).toBe(0)
  })
  it('пробрасывает ошибочный статус без тела', async () => {
    const out = await headFromGet(new Response('{"message":"x"}', { status: 404 }))
    expect(out.status).toBe(404)
    expect(await out.text()).toBe('')
  })
  it('не падает, если тело GET уже прочитано', async () => {
    const res = new Response('data', { status: 200 })
    await res.text()
    const out = await headFromGet(res)
    expect(out.status).toBe(200)
    expect(await out.text()).toBe('')
  })
})

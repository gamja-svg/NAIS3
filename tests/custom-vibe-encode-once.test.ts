import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVibeEncoding } from '../src/main/refs/vibe-encoding-cache'

// [custom] 동시 생성: 같은 바이브를 두 계정이 동시에 인코딩(계정마다 2 Anlas)하지 않는다

const db = vi.hoisted(() => ({
  row: {
    id: 1,
    filePath: '',
    strength: 0.6,
    infoExtracted: 1,
    encoded: null as string | null,
    encodedIe: null as number | null
  }
}))
vi.mock('../src/main/refs/repo', () => ({
  enabledVibeRows: () => [{ ...db.row }],
  vibeRowsByIds: (ids: number[]) => (ids.includes(db.row.id) ? [{ ...db.row }] : []),
  saveVibeEncoding: (id: number, encoded: string, ie: number) => {
    if (id === db.row.id) Object.assign(db.row, { encoded, encodedIe: ie })
  },
  charRefRowsByIds: () => [],
  enabledCharRefRows: () => []
}))
vi.mock('../src/main/sharp', () => ({ default: {} }))
vi.mock('../src/main/i18n', () => ({ t: (id: string) => id }))

const { prepareVibes } = await import('../src/main/refs/prepare')

type Call = { token: string; model: string; finish: (data: string) => void }

describe('custom: vibe encoding shared between accounts', () => {
  let calls: Call[]

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'vibe-'))
    db.row.filePath = join(dir, 'v.png')
    writeFileSync(db.row.filePath, 'png')
    Object.assign(db.row, { encoded: null, encodedIe: null })
    calls = []
    vi.stubGlobal(
      'fetch',
      (_url: string, init: { headers: Record<string, string>; body: string }) =>
        new Promise((resolve) => {
          calls.push({
            token: init.headers.Authorization,
            model: (JSON.parse(init.body) as { model: string }).model,
            finish: (data) =>
              resolve({
                ok: true,
                arrayBuffer: async () => new TextEncoder().encode(data).buffer
              })
          })
        })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('encodes once when two accounts start with the same new vibe', async () => {
    const a = prepareVibes('token-a', 'nai-diffusion-4-5-full')
    const b = prepareVibes('token-b', 'nai-diffusion-4-5-full')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0].finish('ENC')
    const [ra, rb] = await Promise.all([a, b])
    expect(calls).toHaveLength(1) // b는 따로 인코딩하지 않는다
    expect(ra.vibes[0].encodedVibeBase64).toBe(rb.vibes[0].encodedVibeBase64)
    expect([ra.newlyEncoded, rb.newlyEncoded]).toEqual([[1], []])
    // 다음 생성은 저장된 인코딩을 쓴다
    await prepareVibes('token-b', 'nai-diffusion-4-5-full')
    expect(calls).toHaveLength(1)
  })

  it('keeps both encodings when two accounts encode for different models at once', async () => {
    const a = prepareVibes('token-a', 'nai-diffusion-4-5-full')
    const b = prepareVibes('token-b', 'nai-diffusion-4-5-curated')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    calls[0].finish('FULL')
    calls[1].finish('CURATED')
    await Promise.all([a, b])
    const full = getVibeEncoding(db.row.encoded, db.row.encodedIe, 'nai-diffusion-4-5-full', 1)
    const curated = getVibeEncoding(
      db.row.encoded,
      db.row.encodedIe,
      'nai-diffusion-4-5-curated',
      1
    )
    expect(full).not.toBeNull()
    expect(curated).not.toBeNull()
    expect(full).not.toBe(curated)
  })
})

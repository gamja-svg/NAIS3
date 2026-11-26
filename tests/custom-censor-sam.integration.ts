import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAM_MODELS, ensureModels, pickShape } from '../src/main/custom/censor-sam'
import sharp from '../src/main/sharp'

// [custom] 콕 찍기 모델: 받기·확인, 그리고 (모델이 있을 때만) 실제로 모양 따기
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-sam-'))
})
afterEach(() => rmSync(environment.directory, { recursive: true, force: true }))

describe('custom: tap-to-shape model download', () => {
  it('throws away a download that fails the checksum and leaves nothing behind', async () => {
    const dir = join(environment.directory, 'models')
    const progress: number[] = []
    const fake = (async () =>
      new Response(new Uint8Array(1000), { status: 200 })) as unknown as typeof fetch
    await expect(
      ensureModels({ dir, fetch: fake, progress: (p) => progress.push(p) })
    ).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([]) // 반쯤 받은 파일도 남기지 않는다
    expect(progress.every((p) => p < 100)).toBe(true)
  })

  it('reports a failed request and does not ask again for files that are already there', async () => {
    const dir = join(environment.directory, 'models')
    const down = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(ensureModels({ dir, fetch: down })).rejects.toThrow(/404/)
    // 크기가 맞는 파일이 있으면 받지 않는다 (내용 확인은 받을 때 한 번)
    for (const model of Object.values(SAM_MODELS))
      writeFileSync(join(dir, model.file), Buffer.alloc(model.size))
    const never = vi.fn() as unknown as typeof fetch
    await ensureModels({ dir, fetch: never })
    expect(never).not.toHaveBeenCalled()
  })
})

// 모델 폴더를 NAIS3_SAM_MODELS로 알려 주면 실제 모델로 돌려 본다 (평소 시험에서는 건너뛴다 — 45MB를 받지 않게)
const models = process.env.NAIS3_SAM_MODELS
describe.skipIf(!models || !existsSync(models))('custom: tap-to-shape on a real model', () => {
  it('finds the shape under the point', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216">
      <rect width="100%" height="100%" fill="#f1c9b0"/>
      <ellipse cx="160" cy="300" rx="40" ry="25" fill="#7a3b3b"/></svg>`
    const file = join(environment.directory, 'pic.png')
    writeFileSync(file, await sharp(Buffer.from(svg)).png().toBuffer())
    const result = await pickShape({ dir: models! }, file, 160, 300)
    const shape = result.shapes[result.pick]
    expect(Math.abs(shape.x - 120)).toBeLessThanOrEqual(4)
    expect(Math.abs(shape.y - 275)).toBeLessThanOrEqual(4)
    expect(Math.abs(shape.width - 80)).toBeLessThanOrEqual(6)
    expect(Math.abs(shape.height - 50)).toBeLessThanOrEqual(6)
    const { data, info } = await sharp(Buffer.from(shape.png, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4
    expect([...data.subarray(center, center + 4)]).toEqual([255, 255, 255, 255])
    expect(data[3]).toBe(0) // 네모의 모서리는 모양 밖
  }, 120_000)
})

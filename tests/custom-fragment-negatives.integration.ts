import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getFragmentNegatives,
  isSceneNegativeOff,
  listSceneNegativeOff,
  setFragmentNegative,
  setSceneNegativeOff,
  withFragmentNegatives
} from '../src/main/custom/fragment-negatives'
import { parseFragmentRequest, runFragmentRequest } from '../src/main/custom/fragment-request'
import { closeDb, initDb } from '../src/main/db'
import { createFragment, deleteFragment, fragmentSource } from '../src/main/fragments/repo'
import { preprocessRequest } from '../src/main/fragments/request'
import { parseSceneImport } from '../src/main/scenes/import-formats'
import {
  applyImportedScenes,
  createPreset,
  createScene,
  deleteScene
} from '../src/main/scenes/repo'
import type { GenerationRequest } from '../src/shared/types'

// [custom] 조각의 네거 짝: 뽑을 때 자동으로 붙고, 씬마다 끌 수 있다
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-negpair-'))
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

const request = (prompt: string, negativePrompt = '', sceneId?: number): GenerationRequest =>
  ({ prompt, negativePrompt, characterPrompts: [], sceneId }) as unknown as GenerationRequest

describe('custom: fragment negative pairs', () => {
  it('adds the paired negative at generation, expanded like any fragment', () => {
    const face = createFragment('초아', null, 'blue eyes')
    const neg = createFragment('초아 네거', null, 'short hair')
    setFragmentNegative(face, neg)
    expect(getFragmentNegatives()).toEqual({ [face]: neg })

    const raw = request('1girl, <초아>', 'lowres')
    const paired = withFragmentNegatives(raw)
    expect(paired.negativePrompt).toBe('lowres, <초아 네거>')
    expect(raw.negativePrompt).toBe('lowres') // 원래 요청은 그대로
    const sent = preprocessRequest(paired, fragmentSource())
    expect(sent.prompt).toBe('1girl, blue eyes')
    expect(sent.negativePrompt).toBe('lowres, short hair')

    // 조각이 없는 프롬프트, 이미 적힌 네거는 그대로
    expect(withFragmentNegatives(request('1girl')).negativePrompt).toBe('')
    expect(withFragmentNegatives(request('<초아>', '<초아 네거>')).negativePrompt).toBe(
      '<초아 네거>'
    )
  })

  it('can be turned off per scene, and forgets deleted scenes and fragments', () => {
    const face = createFragment('초아', null, 'blue eyes')
    const neg = createFragment('초아 네거', null, 'short hair')
    setFragmentNegative(face, neg)
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    const b = createScene(preset, 'b')
    expect(setSceneNegativeOff(a, true)).toBe(true)
    expect(setSceneNegativeOff(a, true)).toBe(false)
    expect(isSceneNegativeOff(a)).toBe(true)
    expect(withFragmentNegatives(request('<초아>', '', a)).negativePrompt).toBe('')
    expect(withFragmentNegatives(request('<초아>', '', b)).negativePrompt).toBe('<초아 네거>')
    expect(listSceneNegativeOff()).toEqual([a])
    deleteScene(a)
    expect(listSceneNegativeOff()).toEqual([])

    setFragmentNegative(face, face) // 자기 자신은 짝이 될 수 없다 → 짝 없앰
    expect(getFragmentNegatives()).toEqual({})
    setFragmentNegative(face, neg)
    deleteFragment(neg)
    expect(getFragmentNegatives()).toEqual({})
  })

  it('follows "autoNegative" in a scene JSON', () => {
    const preset = createPreset('p')
    const made = applyImportedScenes(
      preset,
      parseSceneImport(
        JSON.stringify({
          scenes: [
            { name: 'a', prompt: 'one', autoNegative: false },
            { name: 'b', prompt: 'two' }
          ]
        })
      ) ?? []
    )
    const [a, b] = made.sceneIds
    expect([isSceneNegativeOff(a), isSceneNegativeOff(b)]).toEqual([true, false])
    const again = applyImportedScenes(
      preset,
      parseSceneImport(JSON.stringify({ scenes: [{ name: 'a', autoNegative: true }] })) ?? []
    )
    expect(isSceneNegativeOff(a)).toBe(false)
    expect(again.sceneIds).toEqual([a])
  })

  it('sets and reports pairs through a fragment request', () => {
    const run = (body: Record<string, unknown>): ReturnType<typeof runFragmentRequest> => {
      const parsed = parseFragmentRequest({ action: 'fragments', ...body })
      if (!parsed || typeof parsed === 'string') throw new Error(String(parsed))
      return runFragmentRequest(parsed)
    }
    const made = run({
      set: [
        { name: '초아', content: 'blue eyes', negative: '초아 네거' }, // 짝이 같은 요청의 뒤에 있어도 된다
        { name: '초아 네거', content: 'short hair' }
      ]
    })
    expect(made.items).toEqual([
      { name: '초아', content: 'blue eyes', negative: '초아 네거' },
      { name: '초아 네거', content: 'short hair' }
    ])
    // 칸이 없으면 그대로, 없는 이름은 알리고 그대로, null이면 없앤다
    expect(run({ set: [{ name: '초아', content: 'blue eyes' }] }).items[0].negative).toBe(
      '초아 네거'
    )
    const missing = run({ set: [{ name: '초아', content: 'blue eyes', negative: '없는 조각' }] })
    expect(missing.outcome.missing).toEqual(['없는 조각'])
    expect(missing.items[0].negative).toBe('초아 네거')
    expect(run({ set: [{ name: '초아', content: 'blue eyes', negative: null }] }).items[0]).toEqual(
      {
        name: '초아',
        content: 'blue eyes'
      }
    )
  })
})

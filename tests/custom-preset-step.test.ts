// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import type { Scene, ScenePreset } from '../src/shared/types'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { useScenesStore } from '../src/renderer/src/stores/scenes-store'
import { useToastStore } from '../src/renderer/src/stores/toast-store'

// [custom] 프리셋 자리 옮기기 · 이전/다음 프리셋으로 넘기기 (검수 모드는 이어 간다)
const presets = [
  { id: 1, name: 'A' },
  { id: 2, name: 'B' },
  { id: 3, name: 'C' }
] as ScenePreset[]
const scene = (id: number, presetId: number, extra: Partial<Scene> = {}): Scene =>
  ({ id, presetId, name: String(id), thumbnailPath: '', pending: false, ...extra }) as Scene
const scenesOf: Record<number, Scene[]> = {
  1: [scene(10, 1, { thumbnailPath: 'a.png' })],
  2: [
    scene(20, 2),
    scene(21, 2, { thumbnailPath: 'b.png' }),
    scene(22, 2, { thumbnailPath: 'c.png', pending: true })
  ],
  3: [scene(30, 3)]
}
let calls: [string, unknown][] = []

beforeEach(() => {
  calls = []
  window.nais = {
    invoke: vi.fn(async (channel: string, payload: { presetId?: number }) => {
      calls.push([channel, payload])
      if (channel === 'scenes:list') return { items: scenesOf[payload.presetId ?? 0] ?? [] }
      if (channel === 'scenes:reservedTotal') return { total: 0 }
      return undefined
    }),
    on: () => () => {}
  } as unknown as NaisApi
  useLanguageStore.setState({ lang: 'ko' })
  useToastStore.setState({ toasts: [] })
  useScenesStore.setState({
    presets,
    activePresetId: 1,
    scenes: scenesOf[1],
    reviewSceneId: null,
    pendingOnly: false
  })
})

describe('custom: preset order and stepping', () => {
  it('moves a preset one place up or down and saves the new order', async () => {
    await useScenesStore.getState().movePreset(1, 1)
    expect(useScenesStore.getState().presets.map((p) => p.id)).toEqual([2, 1, 3])
    expect(calls.at(-1)).toEqual(['scenePresets:reorder', { ids: [2, 1, 3] }])
    calls = []
    await useScenesStore.getState().movePreset(2, -1) // 이미 맨 위
    expect(calls).toEqual([])
  })

  it('steps to the next preset and stops at the ends', async () => {
    await useScenesStore.getState().stepPreset(1)
    expect(useScenesStore.getState()).toMatchObject({ activePresetId: 2, reviewSceneId: null })
    await useScenesStore.getState().stepPreset(1)
    await useScenesStore.getState().stepPreset(1) // 끝
    expect(useScenesStore.getState().activePresetId).toBe(3)
    useScenesStore.setState({ activePresetId: 1 })
    await useScenesStore.getState().stepPreset(-1)
    expect(useScenesStore.getState().activePresetId).toBe(1)
  })

  it('keeps reviewing from the first picture of the preset it stepped to', async () => {
    useScenesStore.setState({ reviewSceneId: 10 })
    await useScenesStore.getState().stepPreset(1)
    expect(useScenesStore.getState()).toMatchObject({ activePresetId: 2, reviewSceneId: 21 })

    // 미생성만 보는 중이면 미생성 씬의 그림부터
    useScenesStore.setState({ activePresetId: 1, reviewSceneId: 10, pendingOnly: true })
    await useScenesStore.getState().stepPreset(1)
    expect(useScenesStore.getState().reviewSceneId).toBe(22)

    // 그림이 없는 프리셋이면 검수를 닫고 알린다
    useScenesStore.setState({ pendingOnly: false })
    await useScenesStore.getState().stepPreset(1)
    expect(useScenesStore.getState()).toMatchObject({ activePresetId: 3, reviewSceneId: null })
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      '프리셋 "C"에는 검수할 그림이 없습니다'
    )
  })

  it('keeps the same scene when stepping presets in review: same name, else same position', async () => {
    const pic = { thumbnailPath: 'p.png' }
    scenesOf[1] = [
      scene(10, 1, { name: '교복', ...pic }),
      scene(11, 1, { name: '수영복', ...pic }),
      scene(12, 1, { name: '잠옷', ...pic })
    ]
    scenesOf[2] = [
      scene(20, 2, { name: '잠옷', ...pic }),
      scene(21, 2, { name: '다른 옷', ...pic }),
      scene(22, 2, { name: '빈 씬' }),
      scene(23, 2, { name: '끝', ...pic })
    ]
    const go = async (from: number): Promise<number | null> => {
      useScenesStore.setState({ activePresetId: 1, scenes: scenesOf[1], reviewSceneId: from })
      await useScenesStore.getState().stepPreset(1)
      return useScenesStore.getState().reviewSceneId
    }
    expect(await go(12)).toBe(20) // 같은 이름
    expect(await go(11)).toBe(21) // 이름이 없으면 같은 순서
    scenesOf[1].push(
      scene(13, 1, { name: '넷째', ...pic }),
      scene(14, 1, { name: '다섯째', ...pic })
    )
    expect(await go(14)).toBe(23) // 더 짧은 프리셋이면 가장 가까운 그림
    scenesOf[1][2] = scene(12, 1, { name: '셋째', ...pic })
    expect(await go(12)).toBe(23) // 그 자리에 그림이 없으면 가까운 쪽 (뒤 먼저)
  })
})

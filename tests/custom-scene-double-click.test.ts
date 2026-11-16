// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from '../src/shared/types'
import {
  noteSceneCardClick,
  useSceneCardDoubleClick
} from '../src/renderer/src/lib/custom-scene-double-click'
import { useScenesStore } from '../src/renderer/src/stores/scenes-store'

// [custom] 씬 카드 더블클릭(더블탭) = 그 씬부터 검수 모드. 첫 클릭은 평소처럼 상세를 연다

const scene = (id: number, thumbnailPath = `/img/${id}.png`): Scene => ({
  id,
  presetId: 1,
  name: `씬 ${id}`,
  prompt: '',
  negativePrompt: '',
  width: 832,
  height: 1216,
  reserveCount: 0,
  reserves: {},
  thumbnailUrl: '',
  thumbnailPath,
  imageCount: thumbnailPath ? 1 : 0,
  hasFavorite: false,
  pending: false
})

function Probe(): null {
  useSceneCardDoubleClick()
  return null
}

describe('custom: scene card double click opens review', () => {
  let root: Root
  let container: HTMLDivElement
  let target: HTMLButtonElement
  let now = 0
  const reached: string[] = []

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    reached.length = 0
    container = document.createElement('div')
    target = document.createElement('button') // 상세 화면에서 두 번째 누름이 떨어지는 자리
    for (const type of ['pointerdown', 'pointerup', 'click'])
      target.addEventListener(type, () => reached.push(type))
    document.body.append(container, target)
    root = createRoot(container)
    await act(async () => root.render(h(Probe)))
    // 첫 클릭으로 상세가 열린 상태
    useScenesStore.setState({ selectedId: 1, reviewSceneId: null })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    target.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const press = (x: number, y: number): void => {
    const init = { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y }
    target.dispatchEvent(new PointerEvent('pointerdown', init))
    target.dispatchEvent(new PointerEvent('pointerup', init))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
  }

  it('closes the detail and opens review from that scene, without passing the press on', () => {
    noteSceneCardClick(scene(1), { clientX: 100, clientY: 100 })
    now += 250
    act(() => press(110, 105))
    expect(useScenesStore.getState().selectedId).toBeNull()
    expect(useScenesStore.getState().reviewSceneId).toBe(1)
    expect(reached).toEqual([])
    // 그다음 누름은 평소대로
    now += 1500
    act(() => press(110, 105))
    expect(reached).toEqual(['pointerdown', 'pointerup', 'click'])
  })

  it('leaves slow or distant second presses to the detail screen', () => {
    noteSceneCardClick(scene(1), { clientX: 100, clientY: 100 })
    now += 700
    act(() => press(100, 100))
    noteSceneCardClick(scene(1), { clientX: 100, clientY: 100 })
    now += 100
    act(() => press(300, 100))
    expect(useScenesStore.getState().selectedId).toBe(1)
    expect(useScenesStore.getState().reviewSceneId).toBeNull()
    expect(reached).toEqual([
      'pointerdown',
      'pointerup',
      'click',
      'pointerdown',
      'pointerup',
      'click'
    ])
  })

  it('does nothing for a scene without an image (nothing to review)', () => {
    noteSceneCardClick(scene(1, ''), { clientX: 100, clientY: 100 })
    now += 100
    act(() => press(100, 100))
    expect(useScenesStore.getState().reviewSceneId).toBeNull()
    expect(useScenesStore.getState().selectedId).toBe(1)
  })
})

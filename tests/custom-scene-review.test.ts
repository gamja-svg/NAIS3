// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import type { GenerationRequest, QueueItem, Scene } from '../src/shared/types'
import { SceneReview } from '../src/renderer/src/components/custom-scene-review'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { DEFAULT_REQUEST, useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { useScenesStore } from '../src/renderer/src/stores/scenes-store'
import { useToastStore } from '../src/renderer/src/stores/toast-store'

// [custom] 검수 모드: 바로 다시 뽑기(G·버튼), 다시 뽑는 동안 진행 화면

const scene = (id: number, extra: Partial<Scene> = {}): Scene => ({
  id,
  presetId: 1,
  name: `씬 ${id}`,
  prompt: `scene ${id}`,
  negativePrompt: '',
  width: 832,
  height: 1216,
  reserveCount: 0,
  reserves: {},
  thumbnailUrl: '',
  thumbnailPath: `/img/${id}.png`,
  imageCount: 1,
  hasFavorite: false,
  pending: false,
  ...extra
})

const queueItem = (id: string, state: QueueItem['state'], sceneId: number): QueueItem => ({
  id,
  state,
  request: { ...DEFAULT_REQUEST, sceneId }
})

describe('custom: scene review regenerate now', () => {
  let root: Root
  let container: HTMLDivElement
  let enqueued: { request: GenerationRequest; count: number }[]
  const scenes = [scene(1), scene(2, { hasFavorite: true })]

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    enqueued = []
    window.nais = {
      invoke: vi.fn(async (channel: string, payload: unknown) => {
        if (channel === 'queue:enqueue') {
          enqueued.push(payload as { request: GenerationRequest; count: number })
          return { ids: ['q1'] }
        }
        return {}
      }),
      on: () => () => {}
    } as unknown as NaisApi
    useLanguageStore.setState({ lang: 'ko' })
    useToastStore.setState({ toasts: [] })
    useGenerationStore.setState({
      request: { ...DEFAULT_REQUEST, prompt: 'base', seed: 1234 },
      seedLocked: true,
      queue: null,
      previewPng: null
    })
    useScenesStore.setState({
      scenes,
      presets: [],
      activePresetId: 1,
      reviewSceneId: 1,
      casts: [],
      activeCastId: ''
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const press = async (
    code: string,
    key = code.replace(/^Key/, '').toLowerCase()
  ): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key }))
    })
  }

  it('generates one more image of the scene on G, with a new seed even when locked', async () => {
    await act(async () => root.render(h(SceneReview, { scenes })))
    await press('KeyG')
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].count).toBe(1)
    expect(enqueued[0].request.sceneId).toBe(1)
    expect(enqueued[0].request.prompt).toContain('scene 1')
    expect(enqueued[0].request.width).toBe(832)
    expect(enqueued[0].request.seed).not.toBe(1234) // 고정 시드 그대로면 같은 그림이 나온다
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['씬 1 다시 뽑는 중'])
  })

  it('does the same from the header button and says the favorite stays as the cover', async () => {
    useScenesStore.setState({ reviewSceneId: 2 })
    await act(async () => root.render(h(SceneReview, { scenes })))
    const button = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '바로 다시 뽑기'
    )
    expect(button).toBeDefined()
    await act(async () => button?.click())
    expect(enqueued.map((e) => e.request.sceneId)).toEqual([2])
    expect(useToastStore.getState().toasts[0].message).toContain('즐겨찾기가 대표 이미지라')
  })

  it('shows the live frame while this scene is being generated and the waiting count', async () => {
    useGenerationStore.setState({
      previewPng: 'LIVE',
      queue: {
        items: [queueItem('a', 'generating', 1), queueItem('b', 'pending', 1)],
        running: true,
        delayMs: 0
      }
    })
    await act(async () => root.render(h(SceneReview, { scenes })))
    const srcs = [...document.body.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(srcs).toContain('data:image/png;base64,LIVE')
    expect(document.body.textContent).toContain('생성 중')
    expect(document.body.textContent).toContain('대기 1장')

    // 다른 씬으로 넘기면 그 씬의 대표 이미지 (진행 화면은 그 씬 것이 아니다)
    await press('ArrowRight', 'ArrowRight')
    const after = [...document.body.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(after).not.toContain('data:image/png;base64,LIVE')
    expect(document.body.textContent).not.toContain('대기 1장')
  })
})

describe('custom: scene review double tap and fixed list', () => {
  let root: Root
  let container: HTMLDivElement
  let enqueued: number[]
  let now = 0
  const pending = (id: number): Scene => scene(id, { pending: true })

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    enqueued = []
    window.nais = {
      invoke: vi.fn(async (channel: string, payload: unknown) => {
        if (channel === 'queue:enqueue') {
          enqueued.push((payload as { request: GenerationRequest }).request.sceneId ?? -1)
          return { ids: ['q1'] }
        }
        return {}
      }),
      on: () => () => {}
    } as unknown as NaisApi
    useLanguageStore.setState({ lang: 'ko' })
    useToastStore.setState({ toasts: [] })
    useGenerationStore.setState({ request: { ...DEFAULT_REQUEST }, queue: null, previewPng: null })
    useScenesStore.setState({
      scenes: [pending(1), pending(2), scene(3)],
      presets: [],
      activePresetId: 1,
      reviewSceneId: 1,
      casts: [],
      activeCastId: ''
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const pointer = (type: string, x: number, y: number): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y
    })

  /** 누르고 (hold ms 뒤) 떼기 — 떼는 자리를 바꾸면 끌기. 실제 브라우저처럼 안 끌었으면 click도 보낸다 */
  const tap = async (target: Element, x = 200, y = 300, hold = 60, toX = x): Promise<void> => {
    await act(async () => {
      target.dispatchEvent(pointer('pointerdown', x, y))
      now += hold
      target.dispatchEvent(pointer('pointerup', toX, y))
      if (toX === x)
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
    })
  }
  const picture = (): Element => document.body.querySelector('main[data-review-stage] img')!
  const title = (): string | null | undefined =>
    document.body.querySelector('header span.truncate.font-semibold')?.textContent

  it('regenerates the scene on a double tap on the picture, not on a single tap', async () => {
    await act(async () => root.render(h(SceneReview, { scenes: [pending(1), pending(2)] })))
    await tap(picture())
    expect(enqueued).toEqual([])
    now += 200
    await tap(picture(), 210, 305)
    expect(enqueued).toEqual([1])
    // 세 번째 탭은 새 더블탭의 첫 탭
    now += 200
    await tap(picture())
    expect(enqueued).toEqual([1])
  })

  it('ignores taps too far apart in time or place, on buttons, and swipes', async () => {
    await act(async () => root.render(h(SceneReview, { scenes: [pending(1), pending(2)] })))
    await tap(picture())
    now += 900
    await tap(picture())
    await tap(picture(), 600, 300)
    const next = document.body.querySelector('button[aria-label="다음"]')!
    await tap(next, 900, 400)
    now += 100
    await tap(next, 900, 400)
    expect(enqueued).toEqual([])
    expect(title()).toBe('씬 2') // 다음 버튼 두 번 = 두 장 넘김 (마지막에서 멈춤)
    await tap(picture(), 150, 300, 60, 300) // 오른쪽으로 끌기 = 이전 장
    expect(title()).toBe('씬 1')
    expect(enqueued).toEqual([])
  })

  it('keeps a scene in the review after it stops being pending', async () => {
    await act(async () => root.render(h(SceneReview, { scenes: [pending(1), pending(2)] })))
    // 다시 뽑기가 끝나 미생성이 풀림 → 미생성만 보기 목록에서는 빠진다
    await act(async () => {
      useScenesStore.setState({ scenes: [scene(1), pending(2), scene(3)] })
      root.render(h(SceneReview, { scenes: [pending(2)] }))
    })
    expect(useScenesStore.getState().reviewSceneId).toBe(1)
    expect(title()).toBe('씬 1')
    expect(document.body.textContent).toContain('1 / 2')
  })
})

describe('custom: mark all pending scenes as checked', () => {
  beforeEach(() => {
    window.nais = { invoke: vi.fn(async () => undefined), on: () => () => {} } as unknown as NaisApi
  })

  it('clears the marks and turns off the pending-only view when none are left', async () => {
    useScenesStore.setState({
      scenes: [scene(1, { pending: true }), scene(2, { pending: true }), scene(3)],
      pendingOnly: true
    })
    await useScenesStore.getState().ackPendingScenes([1, 2])
    expect(window.nais.invoke).toHaveBeenCalledWith('scenes:clearPendingMany', { ids: [1, 2] })
    expect(useScenesStore.getState().scenes.map((s) => s.pending)).toEqual([false, false, false])
    expect(useScenesStore.getState().pendingOnly).toBe(false)
  })

  it('keeps the pending-only view while other scenes are still pending', async () => {
    useScenesStore.setState({
      scenes: [scene(1, { pending: true }), scene(2, { pending: true })],
      pendingOnly: true
    })
    await useScenesStore.getState().ackPendingScenes([1])
    expect(useScenesStore.getState().pendingOnly).toBe(true)
  })
})

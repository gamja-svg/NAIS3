// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import type { QueueItem, QueueLane, QueueStatus, Scene } from '../src/shared/types'
import { PreviewPane } from '../src/renderer/src/components/preview-pane'
import { PromptPanel } from '../src/renderer/src/components/prompt-panel'
import { SceneDetail } from '../src/renderer/src/components/scene-detail'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import {
  bindParallelEvents,
  useParallelStore
} from '../src/renderer/src/stores/custom-parallel-store'
import { DEFAULT_REQUEST, useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { useLayoutStore } from '../src/renderer/src/stores/layout-store'
import { useScenesStore } from '../src/renderer/src/stores/scenes-store'

// [custom] 동시 생성 화면: 계정별 진행 기록, 미리보기 계정 탭, 씬별 프레임, 생성 버튼 줄

const item = (
  id: string,
  state: QueueItem['state'],
  sceneId?: number,
  extra: Partial<QueueItem> = {}
): QueueItem => ({
  id,
  state,
  request: { ...DEFAULT_REQUEST, ...(sceneId != null ? { sceneId } : {}) },
  ...extra
})

const lane = (
  accountId: string,
  generatingId: string | null,
  extra: Partial<QueueLane> = {}
): QueueLane => ({
  accountId,
  generatingId,
  pausedUntil: null,
  pauseReason: null,
  done: 0,
  ...extra
})

function status(items: QueueItem[], lanes?: QueueLane[]): QueueStatus {
  return {
    items,
    running: items.some((i) => i.state === 'pending' || i.state === 'generating'),
    delayMs: 0,
    ...(lanes ? { lanes } : {})
  }
}

const ACCOUNTS = [
  { id: 'a', label: '계정 1' },
  { id: 'b', label: '계정 2' }
]

const streamSrcs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('img')]
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.startsWith('data:image/png'))

function resetParallel(): void {
  useParallelStore.setState({
    config: { enabled: true, target: null },
    accounts: ACCOUNTS,
    balances: {},
    live: {},
    starts: {},
    viewLane: null
  })
}

describe('custom: parallel event binding', () => {
  let handlers: Record<string, (payload: unknown) => void>
  let unbind: () => void

  beforeEach(() => {
    handlers = {}
    window.nais = {
      invoke: vi.fn(async () => ({ accounts: [], activeId: null })),
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        handlers[channel] = handler
        return () => {}
      })
    } as unknown as NaisApi
    resetParallel()
    unbind = bindParallelEvents()
  })

  afterEach(() => unbind())

  const emit = (queue: QueueStatus): void => {
    useGenerationStore.setState({ queue })
    handlers['queue:changed'](queue)
  }

  it('keeps one live frame per item while accounts generate side by side', () => {
    emit(
      status([item('x', 'generating'), item('y', 'generating')], [lane('a', 'x'), lane('b', 'y')])
    )
    handlers['generation:progress']({ id: 'x', stepIx: 3, totalSteps: 23, previewPng: 'XXX' })
    handlers['generation:progress']({ id: 'y', stepIx: 5, totalSteps: 23, previewPng: 'YYY' })
    // 프레임 없이 단계만 오면 직전 프레임 유지
    handlers['generation:progress']({ id: 'x', stepIx: 4, totalSteps: 23 })
    const st = useParallelStore.getState()
    expect(st.live).toEqual({
      x: { png: 'XXX', stepIx: 4, totalSteps: 23 },
      y: { png: 'YYY', stepIx: 5, totalSteps: 23 }
    })
    expect(Object.keys(st.starts).sort()).toEqual(['x', 'y'])
    expect(st.viewLane).toBe('a')

    emit(
      status(
        [item('x', 'done', undefined, { filePath: '/x.png' }), item('y', 'generating')],
        [lane('a', null, { done: 1 }), lane('b', 'y')]
      )
    )
    expect(Object.keys(useParallelStore.getState().live)).toEqual(['y'])
    expect(Object.keys(useParallelStore.getState().starts)).toEqual(['y'])
  })

  it('records nothing when generation is not parallel', () => {
    emit(status([item('x', 'generating')]))
    handlers['generation:progress']({ id: 'x', stepIx: 1, totalSteps: 23, previewPng: 'XXX' })
    expect(useParallelStore.getState().live).toEqual({})
    expect(useParallelStore.getState().starts).toEqual({})
  })

  it('moves the viewed tab to a generating account when the viewed one is gone', () => {
    useParallelStore.setState({ viewLane: 'gone' })
    emit(status([item('y', 'generating')], [lane('a', null), lane('b', 'y')]))
    expect(useParallelStore.getState().viewLane).toBe('b')
  })

  it('stores each account gauge from lane balance events', () => {
    const usage = { percent: 63, isNegative: false, timeUntilNextPercent: 600 }
    handlers['custom:laneBalance']({ accountId: 'b', anlas: 1200, tier: 'opus', usage })
    expect(useParallelStore.getState().balances.b).toEqual({ anlas: 1200, tier: 'opus', usage })
  })
})

describe('custom: parallel screens', () => {
  let root: Root
  let container: HTMLDivElement
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    invoke = vi.fn(async (channel: string, payload?: { target?: string | null }) => {
      if (channel === 'promptPresets:list') return { items: [] }
      if (channel === 'custom:parallelSet')
        return { enabled: true, target: payload?.target ?? null }
      return { value: null, counts: [], items: [], total: 0 }
    })
    window.nais = { invoke, on: () => () => {} } as unknown as NaisApi
    useLanguageStore.setState({ lang: 'ko' })
    useLayoutStore.setState({ centerMode: 'main', quickGenerationControlsEnabled: false })
    useGenerationStore.setState({
      request: { ...DEFAULT_REQUEST },
      queue: null,
      previewPng: null,
      progress: null,
      viewingFilePath: null,
      viewPinned: false
    })
    resetParallel()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('shows a tab per account and streams the chosen account', async () => {
    useParallelStore.setState({
      live: {
        x: { png: 'XXX', stepIx: 3, totalSteps: 23 },
        y: { png: 'YYY', stepIx: 9, totalSteps: 23 }
      },
      balances: {
        b: {
          anlas: 0,
          tier: 'opus',
          usage: { percent: 63, isNegative: false, timeUntilNextPercent: 1 }
        }
      }
    })
    useGenerationStore.setState({
      // 전역 프레임은 두 계정 것이 번갈아 들어오므로 동시 생성 중엔 쓰지 않는다
      previewPng: 'GLOBAL',
      queue: status(
        [item('x', 'generating'), item('y', 'generating')],
        [lane('a', 'x'), lane('b', 'y', { done: 41 })]
      )
    })
    await act(async () => root.render(h(PreviewPane)))
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(tabs[0].textContent).toContain('계정 1')
    expect(tabs[0].textContent).toContain('생성 중')
    expect(tabs[1].textContent).toContain('63%')
    expect(tabs[1].textContent).toContain('이번에 41장')
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,XXX'])
    expect(container.textContent).toContain('3/23')

    await act(async () => tabs[1].click())
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,YYY'])
    expect(container.textContent).toContain('9/23')
  })

  it('shows why an account is resting', async () => {
    useGenerationStore.setState({
      queue: status(
        [item('y', 'generating')],
        [
          lane('a', null, { pauseReason: 'exhausted', pausedUntil: Date.now() + 60_000 }),
          lane('b', 'y')
        ]
      )
    })
    await act(async () => root.render(h(PreviewPane)))
    const tabs = [...container.querySelectorAll('[role="tab"]')]
    expect(tabs[0].textContent).toContain('쉬는 중 · 게이지 소진')
    // 보고 있는 계정이 쉬는 중이면 가운데에 다른 계정의 진행을 끌어오지 않는다
    expect(streamSrcs(container)).toEqual([])
  })

  it('keeps the original single preview without tabs when not parallel', async () => {
    useGenerationStore.setState({
      queue: status([item('x', 'generating')]),
      previewPng: 'GLOBAL',
      progress: { stepIx: 2, totalSteps: 23 }
    })
    await act(async () => root.render(h(PreviewPane)))
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,GLOBAL'])
    expect(container.textContent).toContain('2/23')
  })

  it('streams the frame of the account generating this scene', async () => {
    const scene = (id: number): Scene => ({
      id,
      presetId: 1,
      name: `Scene ${id}`,
      prompt: '',
      negativePrompt: '',
      width: 832,
      height: 1216,
      reserveCount: 0,
      reserves: {},
      thumbnail: '',
      thumbnailPath: '',
      imageCount: 0,
      hasFavorite: false
    })
    useScenesStore.setState({ images: [], imagesTotal: 0, imagesLoading: false })
    useParallelStore.setState({
      live: {
        x: { png: 'XXX', stepIx: 3, totalSteps: 23 },
        y: { png: 'YYY', stepIx: 9, totalSteps: 23 }
      }
    })
    useGenerationStore.setState({
      previewPng: 'GLOBAL',
      queue: status(
        [item('x', 'generating', 7), item('y', 'generating', 8)],
        [lane('a', 'x'), lane('b', 'y')]
      )
    })
    await act(async () => root.render(h(SceneDetail, { scene: scene(8) })))
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,YYY'])
  })

  it('keeps the generate button while accounts generate, with a small cancel next to it', async () => {
    useGenerationStore.setState({
      queue: status(
        [item('x', 'generating'), item('y', 'generating')],
        [lane('a', 'x'), lane('b', 'y')]
      )
    })
    await act(async () => root.render(h(PromptPanel)))
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(buttons).toContain('생성')
    expect(container.querySelector('button[aria-label="전부 취소 (2)"]')).not.toBeNull()
    expect(container.textContent).toContain('보낼 곳')
    expect(container.querySelector('[aria-label="보낼 곳"]')?.textContent).toContain('자동')

    // 동시 생성이 아니면 원래대로 생성 버튼 자리가 취소 버튼
    await act(async () => useGenerationStore.setState({ queue: status([item('x', 'generating')]) }))
    expect(
      [...container.querySelectorAll('button')].map((b) => b.textContent?.trim())
    ).not.toContain('생성')
    expect(container.textContent).not.toContain('보낼 곳')
  })

  it('shows the chosen account in the send-to picker and saves a new choice', async () => {
    useParallelStore.setState({ config: { enabled: true, target: 'b' } })
    useGenerationStore.setState({ queue: status([], [lane('a', null), lane('b', null)]) })
    await act(async () => root.render(h(PromptPanel)))
    expect(container.querySelector('[aria-label="보낼 곳"]')?.textContent).toContain('계정 2')
    await act(async () => useParallelStore.getState().setTarget(null))
    expect(invoke).toHaveBeenCalledWith('custom:parallelSet', { target: null })
    expect(container.querySelector('[aria-label="보낼 곳"]')?.textContent).toContain('자동')
  })
})

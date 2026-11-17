// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import { WATCH_AUTOGEN_KEY } from '../src/shared/custom-watch'
import { AutoGenToggle } from '../src/renderer/src/components/custom-autogen-toggle'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { useAutoGenStore } from '../src/renderer/src/stores/custom-autogen-store'
import { bindSceneEvents } from '../src/renderer/src/stores/scenes-store'
import { useToastStore } from '../src/renderer/src/stores/toast-store'

// [custom] 불러온 씬 자동 생성: 타이틀바 버튼·설정·요청 파일이 한 값을 같이 쓴다

const settings = new Map<string, string>()
const listeners = new Map<string, (payload: never) => void>()
let watchEnabled = true

beforeEach(() => {
  settings.clear()
  listeners.clear()
  watchEnabled = true
  window.nais = {
    invoke: vi.fn(async (channel: string, payload: { key: string; value?: string }) => {
      if (channel === 'settings:get') return { value: settings.get(payload.key) ?? null }
      if (channel === 'settings:set') settings.set(payload.key, payload.value ?? '')
      if (channel === 'custom:watchGet') return { enabled: watchEnabled, dir: 'C:\\watch' }
      return undefined
    }),
    on: (channel: string, listener: (payload: never) => void) => {
      listeners.set(channel, listener)
      return () => listeners.delete(channel)
    }
  } as unknown as NaisApi
  useLanguageStore.setState({ lang: 'ko' })
  useToastStore.setState({ toasts: [] })
  useAutoGenStore.setState({ enabled: false, watching: false })
})

describe('custom: auto-generate switch', () => {
  it('restores the saved value and whether the watch folder is on', async () => {
    settings.set(WATCH_AUTOGEN_KEY, '1')
    await useAutoGenStore.getState().hydrate()
    expect(useAutoGenStore.getState()).toMatchObject({ enabled: true, watching: true })

    settings.delete(WATCH_AUTOGEN_KEY)
    watchEnabled = false
    await useAutoGenStore.getState().hydrate()
    expect(useAutoGenStore.getState()).toMatchObject({ enabled: false, watching: false })
  })

  it('follows a request file that turned it on or off, and says so', () => {
    const unbind = bindSceneEvents()
    try {
      const done = listeners.get('custom:watchRequestDone')!
      done({
        file: '자동생성.request.json',
        ok: true,
        exports: [],
        errors: [],
        autoGenerate: true
      } as never)
      expect(useAutoGenStore.getState().enabled).toBe(true)
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
        '요청 파일 자동생성.request.json: 불러온 씬 자동 생성을 켰습니다'
      )
      done({
        file: 'b.request.json',
        ok: true,
        exports: [],
        errors: [],
        autoGenerate: false
      } as never)
      expect(useAutoGenStore.getState().enabled).toBe(false)
      expect(settings.size).toBe(0) // 저장은 이미 요청을 처리한 쪽이 했다
    } finally {
      unbind()
    }
  })
})

describe('custom: titlebar auto-generate button', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const button = (): HTMLButtonElement | null =>
    container.querySelector('button[aria-label="불러온 씬 자동 생성"]')

  it('is hidden while the watch folder is off', async () => {
    await act(async () => root.render(h(AutoGenToggle)))
    expect(button()).toBeNull()
    await act(async () => useAutoGenStore.setState({ watching: true }))
    expect(button()?.textContent).toBe('자동 생성')
  })

  it('turns auto-generation on and off and saves it', async () => {
    useAutoGenStore.setState({ watching: true })
    await act(async () => root.render(h(AutoGenToggle)))
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    expect(button()!.title).toContain('꺼짐')

    await act(async () => button()!.click())
    expect(button()!.getAttribute('aria-pressed')).toBe('true')
    expect(button()!.title).toContain('켜짐')
    expect(settings.get(WATCH_AUTOGEN_KEY)).toBe('1')

    await act(async () => button()!.click())
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    expect(settings.get(WATCH_AUTOGEN_KEY)).toBe('0')
  })

  it('shows a change made by a request file', async () => {
    useAutoGenStore.setState({ watching: true })
    await act(async () => root.render(h(AutoGenToggle)))
    await act(async () => useAutoGenStore.getState().sync(true))
    expect(button()!.getAttribute('aria-pressed')).toBe('true')
  })
})

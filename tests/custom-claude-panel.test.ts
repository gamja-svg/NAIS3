// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import { ClaudePanel } from '../src/renderer/src/components/custom-claude-panel'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import {
  CLAUDE_HOME,
  isClaudeUrl,
  sameRoom,
  useClaudePanelStore
} from '../src/renderer/src/stores/custom-claude-panel-store'
import { useToastStore } from '../src/renderer/src/stores/toast-store'

// [custom] Claude 창: 지정한 방·폭·열림 저장, 전용 파티션, 지금 보는 방 지정

const settings = new Map<string, string>()

beforeEach(() => {
  settings.clear()
  window.nais = {
    invoke: vi.fn(async (channel: string, payload: { key: string; value?: string }) => {
      if (channel === 'settings:get') return { value: settings.get(payload.key) ?? null }
      if (channel === 'settings:set') settings.set(payload.key, payload.value ?? '')
      return undefined
    }),
    on: () => () => {}
  } as unknown as NaisApi
  useLanguageStore.setState({ lang: 'ko' })
  useToastStore.setState({ toasts: [] })
})

describe('custom: Claude panel settings', () => {
  it('restores the pinned chat, zoom and open state, and ignores pages that are not Claude', async () => {
    settings.set('custom_claude_open', '1')
    settings.set('custom_claude_url', 'https://claude.ai/chat/abc')
    settings.set('custom_claude_zoom', '1.2')
    settings.set('custom_claude_width', '5000')
    await useClaudePanelStore.getState().hydrate()
    expect(useClaudePanelStore.getState()).toMatchObject({
      open: true,
      homeUrl: 'https://claude.ai/chat/abc',
      zoom: 1.2
    })
    expect(useClaudePanelStore.getState().width).toBeLessThan(5000) // 창 폭에 맞춰 줄인다

    settings.set('custom_claude_url', 'https://example.com/phish')
    await useClaudePanelStore.getState().hydrate()
    expect(useClaudePanelStore.getState().homeUrl).toBe(CLAUDE_HOME)
  })

  it('tells chats apart by address path', () => {
    expect(sameRoom('https://claude.ai/chat/abc/', 'https://claude.ai/chat/abc?x=1#y')).toBe(true)
    expect(sameRoom('https://claude.ai/chat/abc', 'https://claude.ai/chat/abd')).toBe(false)
    expect(isClaudeUrl('https://claude.ai/project/1')).toBe(true)
    expect(isClaudeUrl('http://claude.ai/')).toBe(false)
    expect(isClaudeUrl('https://claude.ai.example.com/')).toBe(false)
  })
})

describe('custom: Claude panel', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    useClaudePanelStore.setState({
      open: true,
      width: 400,
      homeUrl: 'https://claude.ai/chat/old',
      zoom: 1
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const button = (label: string): HTMLButtonElement =>
    container.querySelector(`button[aria-label="${label}"]`)!
  const PIN = '이 방을 지정 (창을 열 때마다 이 방)'

  it('opens the pinned chat in its own partition and pins the chat being viewed', async () => {
    await act(async () => root.render(h(ClaudePanel)))
    await act(async () => vi.advanceTimersByTime(300))
    const webview = container.querySelector('webview') as HTMLElement & Record<string, unknown>
    expect(webview.getAttribute('src')).toBe('https://claude.ai/chat/old')
    expect(webview.getAttribute('partition')).toBe('persist:claude-chat')
    expect(webview.hasAttribute('allowpopups')).toBe(true)

    const loadURL = vi.fn(async () => {})
    Object.assign(webview, {
      getURL: () => 'https://claude.ai/chat/new',
      canGoBack: () => true,
      setZoomFactor: vi.fn(),
      loadURL
    })
    await act(async () => webview.dispatchEvent(new Event('did-navigate')))
    expect(button(PIN).getAttribute('aria-pressed')).toBe('false')
    await act(async () => button(PIN).click())
    expect(settings.get('custom_claude_url')).toBe('https://claude.ai/chat/new')
    expect(button('지정한 방').getAttribute('aria-pressed')).toBe('true')

    await act(async () => button('지정한 방으로').click())
    expect(loadURL).toHaveBeenCalledWith('https://claude.ai/chat/new')
  })

  it('refuses to pin pages outside claude.ai', async () => {
    await act(async () => root.render(h(ClaudePanel)))
    await act(async () => vi.advanceTimersByTime(300))
    const webview = container.querySelector('webview') as HTMLElement
    Object.assign(webview, { getURL: () => 'https://accounts.google.com/x', canGoBack: () => true })
    await act(async () => webview.dispatchEvent(new Event('did-navigate')))
    await act(async () => button(PIN).click())
    expect(settings.has('custom_claude_url')).toBe(false)
    expect(useToastStore.getState().toasts[0]?.type).toBe('error')
  })

  it('hides on close but keeps the chat loaded, and saves that it is closed', async () => {
    await act(async () => root.render(h(ClaudePanel)))
    await act(async () => vi.advanceTimersByTime(300))
    await act(async () => button('닫기').click())
    expect(useClaudePanelStore.getState().open).toBe(false)
    expect(settings.get('custom_claude_open')).toBe('0')
    expect(container.querySelector('aside')?.classList.contains('hidden')).toBe(true)
    expect(container.querySelector('webview')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(31 * 60_000)) // 오래 안 열면 내린다
    expect(container.querySelector('webview')).toBeNull()
  })
})

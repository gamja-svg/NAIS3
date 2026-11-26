import { create } from 'zustand'

/** [custom] Claude 창 설정 — 열림·폭·지정한 방·배율 (settings에 저장) */

export const CLAUDE_HOME = 'https://claude.ai/'
export const CLAUDE_PANEL_DEFAULT_WIDTH = 400
const MIN_WIDTH = 300
const KEYS = {
  open: 'custom_claude_open',
  width: 'custom_claude_width',
  url: 'custom_claude_url',
  zoom: 'custom_claude_zoom'
} as const

export function isClaudeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' && (u.hostname === 'claude.ai' || u.hostname.endsWith('.claude.ai'))
    )
  } catch {
    return false
  }
}

/** 같은 방인지 — 끝의 `/`와 `?`·`#` 뒤는 보지 않는다 */
export function sameRoom(a: string, b: string): boolean {
  const key = (s: string): string => {
    try {
      const u = new URL(s)
      return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
    } catch {
      return s
    }
  }
  return key(a) === key(b)
}

function clampWidth(width: number): number {
  const max = Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6))
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)))
}

interface ClaudePanelState {
  open: boolean
  width: number
  /** 지정한 방 — 창을 새로 열 때·집 버튼으로 가는 곳 */
  homeUrl: string
  zoom: number
  setOpen: (open: boolean) => void
  toggle: () => void
  /** save=true일 때만 저장 (끄는 동안에는 화면만 바꾼다) */
  setWidth: (width: number, save?: boolean) => void
  setHomeUrl: (url: string) => void
  setZoom: (zoom: number) => void
  hydrate: () => Promise<void>
}

const persist = (key: string, value: string): void => {
  void window.nais.invoke('settings:set', { key, value })
}

export const useClaudePanelStore = create<ClaudePanelState>((set, get) => ({
  open: false,
  width: CLAUDE_PANEL_DEFAULT_WIDTH,
  homeUrl: CLAUDE_HOME,
  zoom: 1,
  setOpen: (open) => {
    set({ open })
    persist(KEYS.open, open ? '1' : '0')
  },
  toggle: () => get().setOpen(!get().open),
  setWidth: (width, save = false) => {
    const next = clampWidth(width)
    set({ width: next })
    if (save) persist(KEYS.width, String(next))
  },
  setHomeUrl: (homeUrl) => {
    set({ homeUrl })
    persist(KEYS.url, homeUrl)
  },
  setZoom: (zoom) => {
    const next = Math.min(2, Math.max(0.5, Math.round(zoom * 10) / 10))
    set({ zoom: next })
    persist(KEYS.zoom, String(next))
  },
  hydrate: async () => {
    const [open, width, url, zoom] = await Promise.all(
      [KEYS.open, KEYS.width, KEYS.url, KEYS.zoom].map((key) =>
        window.nais.invoke('settings:get', { key })
      )
    )
    set({
      open: open.value === '1',
      width: clampWidth(Number(width.value) || CLAUDE_PANEL_DEFAULT_WIDTH),
      homeUrl: url.value && isClaudeUrl(url.value) ? url.value : CLAUDE_HOME,
      zoom: Number(zoom.value) || 1
    })
  }
}))

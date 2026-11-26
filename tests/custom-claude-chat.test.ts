import { beforeEach, describe, expect, it, vi } from 'vitest'

// [custom] Claude 창(webview): 새 창 링크는 기본 브라우저로, 로그인 창은 같은 창에서, 권한은 최소만

type PermissionHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void
) => void
const electron = vi.hoisted(() => ({
  permission: undefined as PermissionHandler | undefined,
  chat: {
    setPermissionRequestHandler: (handler: PermissionHandler) => {
      electron.permission = handler
    }
  },
  other: {},
  opened: [] as string[]
}))
vi.mock('electron', () => ({
  session: {
    fromPartition: (name: string) =>
      name === 'persist:claude-chat' ? electron.chat : electron.other
  },
  shell: {
    openExternal: async (url: string) => {
      electron.opened.push(url)
    }
  }
}))

const { CLAUDE_CHAT_PARTITION, guardClaudeChatGuest } =
  await import('../src/main/custom/claude-chat')

type Handler = (details: { url: string }) => { action: string }

function guest(session: object): {
  contents: Parameters<typeof guardClaudeChatGuest>[0]
  open: () => Handler
  loaded: string[]
} {
  let handler: Handler | undefined
  const loaded: string[] = []
  const contents = {
    session,
    setWindowOpenHandler: (h: Handler) => {
      handler = h
    },
    loadURL: async (url: string) => {
      loaded.push(url)
    }
  } as unknown as Parameters<typeof guardClaudeChatGuest>[0]
  return { contents, open: () => handler!, loaded }
}

describe('custom: Claude chat webview', () => {
  beforeEach(() => {
    electron.opened.length = 0
  })

  it('uses its own saved partition', () => {
    expect(CLAUDE_CHAT_PARTITION).toBe('persist:claude-chat')
  })

  it('leaves other webviews (web search) to the default rules', () => {
    const { contents } = guest(electron.other)
    expect(guardClaudeChatGuest(contents)).toBe(false)
  })

  it('sends new-window links to the default browser and keeps the chat where it is', () => {
    const g = guest(electron.chat)
    expect(guardClaudeChatGuest(g.contents)).toBe(true)
    expect(g.open()({ url: 'https://example.com/source' })).toEqual({ action: 'deny' })
    expect(electron.opened).toEqual(['https://example.com/source'])
    expect(g.loaded).toEqual([])
  })

  it('opens sign-in windows in the chat itself and drops other schemes', () => {
    const g = guest(electron.chat)
    guardClaudeChatGuest(g.contents)
    g.open()({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' })
    g.open()({ url: 'javascript:alert(1)' })
    g.open()({ url: 'file:///C:/Windows' })
    expect(g.loaded).toEqual(['https://accounts.google.com/o/oauth2/auth?x=1'])
    expect(electron.opened).toEqual([])
  })

  it('grants only clipboard and fullscreen requests', () => {
    guardClaudeChatGuest(guest(electron.chat).contents)
    const answer = (permission: string): boolean => {
      let ok = false
      electron.permission?.(null, permission, (granted) => {
        ok = granted
      })
      return ok
    }
    expect(answer('clipboard-sanitized-write')).toBe(true)
    expect(answer('fullscreen')).toBe(true)
    expect(answer('media')).toBe(false)
    expect(answer('notifications')).toBe(false)
    expect(answer('geolocation')).toBe(false)
  })
})

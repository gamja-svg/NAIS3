import { session, shell, type WebContents } from 'electron'

/**
 * [custom] Claude 창 — 화면 오른쪽의 작은 claude.ai 창(<webview>). 로그인이 남도록 전용 파티션을 쓰고,
 * 앱·웹 검색과 쿠키를 나누지 않는다. preload·node 차단은 모든 webview 공통(will-attach-webview).
 */
export const CLAUDE_CHAT_PARTITION = 'persist:claude-chat'

/** 로그인 창은 같은 창에서 연다 (바깥 브라우저로 보내면 그쪽에 로그인된다) */
const SIGN_IN_HOSTS = new Set(['accounts.google.com', 'appleid.apple.com'])
/** 대화 화면에 필요한 것만 — 마이크·카메라·위치·알림 등은 묻지 않고 막는다 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'])

let prepared = false

/** 이 webview가 Claude 창이면 링크·권한 규칙을 걸고 true */
export function guardClaudeChatGuest(contents: WebContents): boolean {
  const chat = session.fromPartition(CLAUDE_CHAT_PARTITION)
  if (contents.session !== chat) return false
  if (!prepared) {
    prepared = true
    chat.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(ALLOWED_PERMISSIONS.has(permission))
    )
  }
  // 새 창으로 여는 링크(출처·첨부 등)는 기본 브라우저로 — 대화 화면이 바뀌지 않게
  contents.setWindowOpenHandler(({ url }) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { action: 'deny' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { action: 'deny' }
    if (SIGN_IN_HOSTS.has(parsed.hostname)) void contents.loadURL(url)
    else void shell.openExternal(url)
    return { action: 'deny' }
  })
  return true
}

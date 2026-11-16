import { ArrowLeft, Home, Link2, Loader2, Minus, Pin, Plus, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import {
  CLAUDE_PANEL_DEFAULT_WIDTH,
  isClaudeUrl,
  sameRoom,
  useClaudePanelStore
} from '../stores/custom-claude-panel-store'
import { askText } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'

/**
 * [custom] Claude 창 — 화면 오른쪽에 여닫는 작은 claude.ai 창. 지정한 방이 열 때마다 뜨고,
 * 로그인은 전용 파티션에 남는다(앱·웹 검색과 쿠키를 나누지 않음). 새 창 링크는 기본 브라우저로 간다
 * (main/custom/claude-chat.ts). 닫아도 한동안은 쓰던 화면 그대로 숨겨 둔다.
 */

const PARTITION = 'persist:claude-chat'
/** 닫은 뒤 이만큼 다시 열지 않으면 창을 내려 메모리를 돌려준다 */
const KEEP_ALIVE_MS = 30 * 60_000

// <webview> JSX 타입은 React에 내장 — 쓰는 메서드(Electron WebviewTag)만 선언
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  goBack(): void
  reload(): void
  canGoBack(): boolean
  getURL(): string
  setZoomFactor(factor: number): void
}

/** 한 번 연 뒤로는 닫아도 잠시 남겨 둔다 — 다시 열 때 새로 불러오지 않게 */
function useKeepAlive(open: boolean): boolean {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), KEEP_ALIVE_MS)
    return () => clearTimeout(timer)
  }, [open, mounted])
  return mounted
}

export function ClaudePanel(): React.JSX.Element | null {
  const open = useClaudePanelStore((s) => s.open)
  const mounted = useKeepAlive(open)
  return mounted ? <ClaudePanelBody open={open} /> : null
}

function ClaudePanelBody({ open }: { open: boolean }): React.JSX.Element {
  const t = useT()
  const width = useClaudePanelStore((s) => s.width)
  const homeUrl = useClaudePanelStore((s) => s.homeUrl)
  const zoom = useClaudePanelStore((s) => s.zoom)
  const setOpen = useClaudePanelStore((s) => s.setOpen)
  const setHomeUrl = useClaudePanelStore((s) => s.setHomeUrl)
  const setZoom = useClaudePanelStore((s) => s.setZoom)

  const webviewRef = useRef<WebviewElement | null>(null)
  const [initialSrc] = useState(() => useClaudePanelStore.getState().homeUrl)
  // 창이 펼쳐진 뒤에 붙인다 — 게스트 프로세스 생성과 첫 로딩이 앱 화면을 버벅이게 하지 않게
  const [attached, setAttached] = useState(false)
  const [url, setUrl] = useState(initialSrc)
  const [title, setTitle] = useState('')
  const [canBack, setCanBack] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setAttached(true), 250)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onNavigate = (): void => {
      setUrl(wv.getURL())
      setCanBack(wv.canGoBack())
    }
    const onTitle = (e: Event): void => setTitle((e as Event & { title?: string }).title ?? '')
    const onStart = (): void => setLoading(true)
    const onStop = (): void => setLoading(false)
    const onDomReady = (): void => {
      wv.setZoomFactor(useClaudePanelStore.getState().zoom)
      onNavigate()
    }
    const events: [string, (e: Event) => void][] = [
      ['did-navigate', onNavigate],
      ['did-navigate-in-page', onNavigate],
      ['page-title-updated', onTitle],
      ['did-start-loading', onStart],
      ['did-stop-loading', onStop],
      ['dom-ready', onDomReady]
    ]
    for (const [name, fn] of events) wv.addEventListener(name, fn)
    return () => {
      for (const [name, fn] of events) wv.removeEventListener(name, fn)
    }
  }, [attached])

  // 닫으면 키 입력이 숨은 창으로 가지 않게 포커스를 뺀다
  useEffect(() => {
    if (!open) webviewRef.current?.blur()
  }, [open])

  const pinned = sameRoom(url, homeUrl)
  const goHome = (): void => {
    void webviewRef.current?.loadURL(useClaudePanelStore.getState().homeUrl)
  }
  const pin = (): void => {
    if (!isClaudeUrl(url)) {
      toast(t('ui.customClaudePinOnlyClaude'), 'error')
      return
    }
    setHomeUrl(url)
    toast(t('ui.customClaudePinnedDone'), 'success')
  }
  const openUrl = async (): Promise<void> => {
    const input = (await askText(t('ui.customClaudeOpenUrl'), '', 'https://claude.ai/…'))?.trim()
    if (!input) return
    if (!/^https:\/\//i.test(input)) {
      toast(t('ui.customClaudeHttpsOnly'), 'error')
      return
    }
    void webviewRef.current?.loadURL(input)
  }
  const changeZoom = (next: number): void => {
    setZoom(next)
    try {
      webviewRef.current?.setZoomFactor(useClaudePanelStore.getState().zoom)
    } catch {
      // 아직 준비 전 — dom-ready에서 맞춘다
    }
  }
  // 왼쪽 가장자리를 끌어 폭 조절, 두 번 누르면 기본 폭
  const startResize = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = useClaudePanelStore.getState().width
    setResizing(true)
    const onMove = (ev: PointerEvent): void =>
      useClaudePanelStore.getState().setWidth(startWidth - (ev.clientX - startX))
    const onUp = (): void => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const store = useClaudePanelStore.getState()
      store.setWidth(store.width, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      className={cn('relative flex shrink-0 flex-col pb-3 pr-3', !open && 'hidden')}
      style={{ width, maxWidth: '60vw' }}
      aria-label={t('ui.customClaudePanel')}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title={t('ui.customClaudeResize')}
        className="group absolute inset-y-0 -left-3 z-20 flex w-3 cursor-col-resize justify-center pb-3"
        onPointerDown={startResize}
        onDoubleClick={() =>
          useClaudePanelStore.getState().setWidth(CLAUDE_PANEL_DEFAULT_WIDTH, true)
        }
      >
        <span
          className={cn(
            'h-full w-0.5 rounded-full transition-colors group-hover:bg-accent/40',
            resizing && 'bg-accent/60'
          )}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
          <span
            className="min-w-0 flex-1 truncate px-1.5 text-[12px] font-medium text-muted"
            title={url}
          >
            {title || 'Claude'}
          </span>
          <PanelButton
            tip={t('ui.back')}
            disabled={!canBack}
            onClick={() => webviewRef.current?.goBack()}
          >
            <ArrowLeft size={14} />
          </PanelButton>
          <PanelButton tip={t('ui.customClaudeHome')} onClick={goHome}>
            <Home size={14} />
          </PanelButton>
          <PanelButton
            tip={pinned ? t('ui.customClaudePinned') : t('ui.customClaudePin')}
            active={pinned}
            onClick={pin}
          >
            <Pin size={14} />
          </PanelButton>
          <PanelButton tip={t('ui.customClaudeOpenUrl')} onClick={() => void openUrl()}>
            <Link2 size={14} />
          </PanelButton>
          <PanelButton tip={t('ui.reload')} onClick={() => webviewRef.current?.reload()}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
          </PanelButton>
          <PanelButton
            tip={t('ui.zoomOut')}
            disabled={zoom <= 0.5}
            onClick={() => changeZoom(zoom - 0.1)}
          >
            <Minus size={14} />
          </PanelButton>
          <PanelButton
            tip={t('ui.zoomIn')}
            disabled={zoom >= 2}
            onClick={() => changeZoom(zoom + 0.1)}
          >
            <Plus size={14} />
          </PanelButton>
          <PanelButton tip={t('ui.close')} onClick={() => setOpen(false)}>
            <X size={15} />
          </PanelButton>
        </div>
        <div className="relative min-h-0 flex-1 bg-white">
          {attached && (
            <webview
              ref={(el) => {
                webviewRef.current = el as WebviewElement | null
              }}
              src={initialSrc}
              // eslint-disable-next-line react/no-unknown-property -- Electron webview 전용 속성
              partition={PARTITION}
              // 새 창 링크를 받으려면 켜야 한다 — 실제로 창을 열지는 않고 기본 브라우저로 보낸다
              // eslint-disable-next-line react/no-unknown-property -- Electron webview 전용 속성
              allowpopups={'true' as unknown as boolean}
              className="absolute inset-0 h-full w-full"
            />
          )}
        </div>
      </div>
      {/* 끄는 동안 마우스가 웹 창으로 빨려 들어가지 않게 덮는다 */}
      {resizing && <div className="fixed inset-0 z-[70] cursor-col-resize" />}
    </aside>
  )
}

function PanelButton({
  tip,
  active,
  disabled,
  onClick,
  children
}: {
  tip: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={tip}
      aria-label={tip}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35',
        active ? 'text-accent-ink' : 'text-muted'
      )}
    >
      {children}
    </button>
  )
}

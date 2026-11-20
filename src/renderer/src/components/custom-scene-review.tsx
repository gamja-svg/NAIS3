import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  MessageCircle,
  PanelRight,
  Plus,
  RefreshCw,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Scene } from '@shared/types'
import { imageUrl } from '../lib/constants'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { bindCensorEvents, useCensorStore, withCensorRev } from '../stores/custom-censor-store'
import { useClaudePanelStore } from '../stores/custom-claude-panel-store'
import { useSceneFrame, useSceneGenerating } from '../stores/custom-parallel-store'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { useScenesStore } from '../stores/scenes-store'
import { toast } from '../stores/toast-store'
import { CensorStage, RailButton } from './custom-censor-stage'
import { ImageContextMenu } from './image-context-menu'

/** 이만큼 가로로 끌면 넘긴 것으로 본다 (원격 접속의 터치는 마우스 드래그로 들어온다) */
const SWIPE_PX = 60
/** 탭: 이 안에서 떼면 (원격 접속의 지연을 생각해 넉넉하게) */
const TAP_MOVE_PX = 12
const TAP_MS = 450
/** 더블탭: 앞 탭을 뗀 뒤 이 시간·거리 안에 다시 탭 */
const DOUBLE_TAP_MS = 450
const DOUBLE_TAP_PX = 40

/** 그림이 실제로 그려진 칸 안인지 — object-contain의 남는 여백은 그림 밖으로 친다 */
function insidePicture(img: HTMLImageElement, x: number, y: number): boolean {
  const box = img.getBoundingClientRect()
  if (!box.width || !box.height) return true // 크기를 잴 수 없으면(그리기 전) 그림으로 친다
  let { left, top, width, height } = box
  if (img.naturalWidth && img.naturalHeight) {
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight)
    width = img.naturalWidth * scale
    height = img.naturalHeight * scale
    left += (box.width - width) / 2
    top += (box.height - height) / 2
  }
  return x >= left && x <= left + width && y >= top && y <= top + height
}

/** 히스토리 패널 폭 (App의 RightPanel과 같은 값) */
const HISTORY_WIDTH = 240

/**
 * [custom] 검수 모드 — 프리셋의 씬 대표 이미지(카드에 보이는 그림)를 크게 한 장씩 넘겨 본다.
 * ←/→·휠·스와이프·화면 버튼으로 넘기고, G·그림 더블탭으로 그 씬을 바로 다시 뽑기(1장),
 * R로 다시 뽑기 예약(+1), Esc·그림 밖 누르기로 닫는다. 다시 뽑는 동안은 진행 화면을 보여 주고, 다 되면 새 그림이
 * 대표 이미지가 된다 (즐겨찾기가 있는 씬은 즐겨찾기가 대표라 그대로). 이미지가 없는 씬은 건너뛴다.
 * 넘겨 보는 씬 목록은 열 때 정해 둔다 — 미생성만 보기에서 다시 뽑아 미생성이 풀려도 빠지지 않게.
 * 닫으면 마지막으로 본 씬 카드로 목록을 데려간다.
 * `검열`을 켜면 그 동안은 그림에 흰칠을 하는 화면이 된다 (custom-censor-stage.tsx) — 휠·누르기·끌기가
 * 칠하기 조작으로 바뀌고, 넘기기는 ←/→와 화면 버튼으로 한다.
 */
export function SceneReview({ scenes }: { scenes: Scene[] }): React.JSX.Element | null {
  const t = useT()
  const reviewSceneId = useScenesStore((s) => s.reviewSceneId)
  const setReviewScene = useScenesStore((s) => s.setReviewScene)
  const adjustReserve = useScenesStore((s) => s.adjustReserve)
  const regenerateScene = useScenesStore((s) => s.regenerateScene)
  const presetName = useScenesStore(
    (s) => s.presets.find((p) => p.id === s.activePresetId)?.name ?? ''
  )
  // Claude 창이 열려 있으면 그 자리는 비워 둔다 (검수하면서 대화할 수 있게)
  const claudeOpen = useClaudePanelStore((s) => s.open)
  const claudeWidth = useClaudePanelStore((s) => (s.open ? s.width : 0))
  const toggleClaude = useClaudePanelStore((s) => s.toggle)
  // 히스토리 패널도 열려 있으면 그 자리를 비워 둔다 (검수하면서 방금 뽑힌 그림을 볼 수 있게)
  const historyOpen = useLayoutStore((s) => s.rightOpen)
  const toggleHistory = useLayoutStore((s) => s.toggleRight)
  // 검열(흰칠) — 켜 두면 씬·프리셋을 넘겨도 유지된다
  const censor = useCensorStore((s) => s.on)
  const toggleCensor = useCensorStore((s) => s.toggle)
  // 이전·다음 프리셋 (↑/↓) — 넘어간 프리셋의 첫 그림으로 검수를 이어 간다
  const stepPreset = useScenesStore((s) => s.stepPreset)
  const presetIndex = useScenesStore((s) => s.presets.findIndex((p) => p.id === s.activePresetId))
  const presetCount = useScenesStore((s) => s.presets.length)
  const censorRevs = useCensorStore((s) => s.revs)
  useEffect(() => bindCensorEvents(), [])

  // 열 때의 씬 순서를 고정하고, 내용(대표 이미지·미생성 등)은 최신 값으로 본다
  const [reviewIds] = useState(() => scenes.map((s) => s.id))
  const allScenes = useScenesStore((s) => s.scenes)
  const byId = new Map(allScenes.map((s) => [s.id, s]))
  const list = reviewIds
    .map((id) => byId.get(id))
    .filter((s): s is Scene => s != null && !!s.thumbnailPath)
  const index = list.findIndex((s) => s.id === reviewSceneId)
  const scene = index >= 0 ? list[index] : undefined

  // 이 씬을 지금 뽑는 중인지 · 대기 중인 장수 · 진행 화면 (동시 생성이면 이 씬을 뽑는 계정 것)
  const sceneId = scene?.id ?? -1
  const generating = useSceneGenerating(sceneId)
  const waiting = useGenerationStore(
    (s) =>
      s.queue?.items.filter((i) => i.state === 'pending' && i.request.sceneId === sceneId).length ??
      0
  )
  const frame = useSceneFrame(sceneId, generating)

  const go = (i: number): void => {
    const next = list[Math.min(list.length - 1, Math.max(0, i))]
    if (next && next.id !== reviewSceneId) setReviewScene(next.id)
  }
  const close = (): void => {
    useScenesStore.setState({ reviewSceneId: null, focusSceneId: scene?.id ?? null })
  }
  const queue = (): void => {
    if (!scene) return
    void adjustReserve(scene.id, 1)
    toast(t('ui.customReviewQueuedValue', scene.name), 'success')
  }
  const regenerate = (): void => {
    if (!scene) return
    regenerateScene(scene.id).catch((error: unknown) =>
      toast(error instanceof Error ? error.message : String(error), 'error')
    )
    toast(
      t(
        scene.hasFavorite ? 'ui.customReviewRegenFavoriteValue' : 'ui.customReviewRegenValue',
        scene.name
      ),
      'success'
    )
  }
  const save = (): void => {
    if (!scene) return
    void window.nais.invoke('images:saveAs', {
      filePath: scene.thumbnailPath,
      defaultName: scene.name
    })
  }

  // 보던 씬이 목록에서 빠지면(씬·이미지 삭제) 닫는다
  useEffect(() => {
    if (index < 0) setReviewScene(null)
  }, [index, setReviewScene])

  // 키보드 — 다른 단축키보다 먼저 받아서, 처리한 키만 막는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') go(index - 1)
      else if (e.key === 'ArrowRight') go(index + 1)
      else if (e.code === 'KeyR' && !e.repeat) queue()
      else if (e.code === 'KeyG' && !e.repeat) regenerate()
      // 물결표(~) 키 — 검열 켜기·끄기 (Shift 없이 눌러도 된다)
      else if (e.code === 'Backquote' && !e.repeat) toggleCensor()
      else if (e.key === 'ArrowUp' && !e.repeat) void stepPreset(-1)
      else if (e.key === 'ArrowDown' && !e.repeat) void stepPreset(1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // 휠로 이전/다음 — 트랙패드 관성으로 여러 장 튀지 않게 누적 임계값 + 쿨다운 (라이트박스와 같은 방식)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const wheel = useRef({ accum: 0, lockUntil: 0 })
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (censor) return // 검열 중의 휠은 확대·붓 크기 (작업 칸이 따로 받는다)
      const now = performance.now()
      const w = wheel.current
      if (now < w.lockUntil) return
      w.accum += e.deltaY
      if (Math.abs(w.accum) < 50) return
      const dir = w.accum > 0 ? 1 : -1
      w.accum = 0
      w.lockUntil = now + 160
      go(index + dir)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // 앞뒤 이미지를 미리 받아 둔다 (넘길 때 바로 보이게)
  const prevPath = list[index - 1]?.thumbnailPath
  const nextPath = list[index + 1]?.thumbnailPath
  useEffect(() => {
    for (const path of [prevPath, nextPath]) {
      if (!path) continue
      const img = new Image()
      img.src = imageUrl(path)
    }
  }, [prevPath, nextPath])

  // 스와이프 (가로로 충분히, 세로보다 확실히 많이 움직였을 때만) · 그림 더블탭 = 바로 다시 뽑기 ·
  // 그림 밖 탭 = 닫기
  const swipe = useRef<{
    x: number
    y: number
    id: number
    at: number
    picture: boolean
    outside: boolean
  } | null>(null)
  const lastTap = useRef<{ x: number; y: number; at: number; sceneId: number } | null>(null)
  // 그림 밖 탭은 이어지는 click에서 닫는다 — 떼는 순간 닫으면 그 click이 아래 씬 카드로 떨어져 상세가 열린다
  const closeOnClick = useRef(false)
  // 더블탭한 자리에 잠깐 띄우는 표시 (눌렸다는 걸 바로 알 수 있게)
  const [flash, setFlash] = useState<{ x: number; y: number; key: number; fading: boolean } | null>(
    null
  )
  const showFlash = (x: number, y: number): void => {
    const key = performance.now()
    setFlash({ x, y, key, fading: false })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFlash((f) => (f?.key === key ? { ...f, fading: true } : f)))
    )
    setTimeout(() => setFlash((f) => (f?.key === key ? null : f)), 800)
  }
  /** 그림(대표 이미지·진행 화면) 위를 눌렀는지 */
  const onPicture = (e: React.PointerEvent): boolean =>
    e.target instanceof HTMLImageElement &&
    !!e.target.closest('[data-review-stage]') &&
    insidePicture(e.target, e.clientX, e.clientY)
  /** 그림 밖 빈 곳을 눌렀는지 — 버튼, 열린 메뉴(우클릭 메뉴는 화면 밖 포털이라 여기 들지 않는다)는 빼고 */
  const onBackdrop = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    !!overlayRef.current?.contains(target) &&
    !target.closest('button, a, input, textarea, select') &&
    !document.querySelector('[role="menu"]')

  if (!scene) return null
  const hasPrev = index > 0
  const hasNext = index < list.length - 1
  const navButton =
    'absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-20'

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex select-none flex-col bg-black/90 text-white backdrop-blur-sm"
      style={{ right: claudeWidth + (historyOpen ? HISTORY_WIDTH : 0) }}
      onPointerDown={(e) => {
        closeOnClick.current = false
        // 검열 중에는 넘기기·다시 뽑기·그림 밖 닫기를 받지 않는다 (칠하다가 잘못 눌리지 않게)
        if (e.button !== 0 || censor) return
        const picture = onPicture(e)
        swipe.current = {
          x: e.clientX,
          y: e.clientY,
          id: e.pointerId,
          at: performance.now(),
          picture,
          outside: !picture && onBackdrop(e.target)
        }
      }}
      onPointerUp={(e) => {
        const start = swipe.current
        swipe.current = null
        if (!start || start.id !== e.pointerId) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
          lastTap.current = null
          go(index + (dx < 0 ? 1 : -1))
          return
        }
        const now = performance.now()
        const tapped = Math.hypot(dx, dy) <= TAP_MOVE_PX && now - start.at <= TAP_MS
        if (!tapped || !start.picture) {
          lastTap.current = null
          closeOnClick.current = tapped && start.outside
          return
        }
        const prev = lastTap.current
        if (
          prev &&
          prev.sceneId === scene.id &&
          now - prev.at <= DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_TAP_PX
        ) {
          lastTap.current = null
          showFlash(e.clientX, e.clientY)
          regenerate()
        } else {
          lastTap.current = { x: e.clientX, y: e.clientY, at: now, sceneId: scene.id }
        }
      }}
      onPointerCancel={() => {
        swipe.current = null
        closeOnClick.current = false
      }}
      onClick={() => {
        if (!closeOnClick.current) return
        closeOnClick.current = false
        close()
      }}
    >
      <header className="flex shrink-0 items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-[12px]">
            <span className="truncate opacity-70">{presetName}</span>
            {presetCount > 1 && (
              <>
                <button
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:pointer-events-none disabled:opacity-25"
                  disabled={presetIndex <= 0}
                  title={t('ui.customPresetPrevious')}
                  aria-label={t('ui.customPresetPrevious')}
                  onClick={() => void stepPreset(-1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:pointer-events-none disabled:opacity-25"
                  disabled={presetIndex >= presetCount - 1}
                  title={t('ui.customPresetNext')}
                  aria-label={t('ui.customPresetNext')}
                  onClick={() => void stepPreset(1)}
                >
                  <ChevronDown size={14} />
                </button>
                <span className="shrink-0 font-mono opacity-60">
                  {presetIndex + 1} / {presetCount}
                </span>
              </>
            )}
          </div>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[19px] font-semibold">{scene.name}</span>
            {scene.memo && (
              <span className="min-w-0 truncate text-[14px] opacity-80" title={scene.memo}>
                {scene.memo}
              </span>
            )}
            {scene.pending && (
              <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold leading-none text-on-accent">
                {t('ui.notGenerated')}
              </span>
            )}
            <span className="shrink-0 font-mono text-[12px] opacity-70">
              {index + 1} / {list.length}
            </span>
            {generating && (
              <span className="flex shrink-0 items-center gap-1 text-[12px] text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success" />
                {t('ui.customLaneGenerating')}
              </span>
            )}
            {waiting > 0 && (
              <span className="shrink-0 text-[12px] opacity-70">
                {t('ui.customReviewWaitingValue', waiting)}
              </span>
            )}
          </div>
        </div>
        <button
          className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13px] font-medium text-on-accent hover:opacity-90"
          title={t('ui.customReviewRegenHint')}
          onClick={regenerate}
        >
          <RefreshCw size={15} /> {t('ui.customReviewRegen')}
        </button>
        <button
          className="flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[13px] hover:bg-white/20"
          onClick={queue}
        >
          <Plus size={15} /> {t('ui.customReviewQueue')}
          {scene.reserveCount > 0 && (
            <span className="ml-0.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-[12px] font-medium text-on-danger">
              {scene.reserveCount}
            </span>
          )}
        </button>
        <button
          className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          title={t('ui.customSaveTopImage')}
          aria-label={t('ui.customSaveTopImage')}
          onClick={save}
        >
          <Download size={17} />
        </button>
        {/* 검수 화면이 타이틀 바를 덮으니, 옆 창 켜고 끄기를 여기에도 둔다 */}
        <button
          className={cn(
            'grid size-10 place-items-center rounded-full hover:bg-white/20',
            historyOpen ? 'bg-white text-black hover:bg-white/85' : 'bg-white/10'
          )}
          title={t('ui.history')}
          aria-label={t('ui.history')}
          aria-pressed={historyOpen}
          onClick={toggleHistory}
        >
          <PanelRight size={17} />
        </button>
        <button
          className={cn(
            'grid size-10 place-items-center rounded-full hover:bg-white/20',
            claudeOpen ? 'bg-white text-black hover:bg-white/85' : 'bg-white/10'
          )}
          title={t('ui.customClaudePanel')}
          aria-label={t('ui.customClaudePanel')}
          aria-pressed={claudeOpen}
          onClick={toggleClaude}
        >
          <MessageCircle size={17} />
        </button>
        <button
          className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>

      <main
        data-review-stage
        className="relative flex min-h-0 flex-1 items-center justify-center px-20 pb-2"
      >
        {/* 검열 켜기·끄기 — 그림 옆 빈 자리에 크게 (켜면 아래로 도구 버튼이 이어진다) */}
        <div className="absolute left-1 top-0 w-[72px]">
          <RailButton
            label={t('ui.customCensor')}
            hint={t('ui.customCensorHint')}
            active={censor}
            plain
            onClick={toggleCensor}
          >
            <Brush size={22} />
          </RailButton>
        </div>
        <button
          className={cn(navButton, 'left-4')}
          disabled={!hasPrev}
          aria-label={t('ui.customPrevious')}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft size={26} />
        </button>
        {generating && frame ? (
          // 다시 뽑는 중 — 진행 화면 (다 되면 새 그림이 대표 이미지로 들어온다)
          <img
            key={`live-${scene.id}`}
            src={`data:image/png;base64,${frame}`}
            className="h-full w-full rounded-lg object-contain"
            draggable={false}
            alt=""
          />
        ) : censor ? (
          <CensorStage key={scene.id} filePath={scene.thumbnailPath} />
        ) : (
          /* 우클릭 메뉴 (복사·메타데이터 등) — 라이트박스와 같다 */
          <ImageContextMenu filePath={scene.thumbnailPath}>
            <img
              key={scene.id}
              // 칠한 그림은 같은 파일을 다시 쓴다 — 저장한 뒤에는 새로 읽게 번호를 붙인다
              src={withCensorRev(imageUrl(scene.thumbnailPath), censorRevs[scene.thumbnailPath])}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onError={(e) => {
                // 원본 파일이 옮겨졌으면 저장된 썸네일이라도 보여 준다
                if (scene.thumbnailUrl && e.currentTarget.src !== scene.thumbnailUrl)
                  e.currentTarget.src = scene.thumbnailUrl
              }}
              draggable={false}
              alt=""
            />
          </ImageContextMenu>
        )}
        <button
          className={cn(navButton, 'right-4')}
          disabled={!hasNext}
          aria-label={t('ui.customNext')}
          onClick={() => go(index + 1)}
        >
          <ChevronRight size={26} />
        </button>
      </main>

      <footer className="shrink-0 pb-3 text-center text-[11.5px] opacity-60">
        {t(censor ? 'ui.customCensorFooter' : 'ui.customReviewHint')}
      </footer>

      {flash && (
        <div
          key={flash.key}
          aria-hidden
          className={cn(
            'pointer-events-none absolute grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent/85 text-on-accent shadow-lg transition-all duration-700 ease-out',
            flash.fading ? 'scale-150 opacity-0' : 'scale-100 opacity-100'
          )}
          style={{ left: flash.x, top: flash.y }}
        >
          <RefreshCw size={30} />
        </div>
      )}
    </div>,
    document.body
  )
}

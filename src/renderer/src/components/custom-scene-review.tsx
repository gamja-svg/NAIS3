import { ChevronLeft, ChevronRight, Download, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Scene } from '@shared/types'
import { imageUrl } from '../lib/constants'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { useSceneFrame, useSceneGenerating } from '../stores/custom-parallel-store'
import { useGenerationStore } from '../stores/generation-store'
import { useScenesStore } from '../stores/scenes-store'
import { toast } from '../stores/toast-store'
import { ImageContextMenu } from './image-context-menu'

/** 이만큼 가로로 끌면 넘긴 것으로 본다 (원격 접속의 터치는 마우스 드래그로 들어온다) */
const SWIPE_PX = 60

/**
 * [custom] 검수 모드 — 프리셋의 씬 대표 이미지(카드에 보이는 그림)를 크게 한 장씩 넘겨 본다.
 * ←/→·휠·스와이프·화면 버튼으로 넘기고, G로 그 씬을 바로 다시 뽑기(1장), R로 다시 뽑기 예약(+1),
 * Esc로 닫는다. 다시 뽑는 동안은 진행 화면을 보여 주고, 다 되면 새 그림이 대표 이미지가 된다
 * (즐겨찾기가 있는 씬은 즐겨찾기가 대표라 그대로). 이미지가 없는 씬은 건너뛴다.
 * 닫으면 마지막으로 본 씬 카드로 목록을 데려간다.
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

  const list = scenes.filter((s) => s.thumbnailPath)
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

  // 스와이프 (가로로 충분히, 세로보다 확실히 많이 움직였을 때만)
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)

  if (!scene) return null
  const hasPrev = index > 0
  const hasNext = index < list.length - 1
  const navButton =
    'absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-20'

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex select-none flex-col bg-black/90 text-white backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.button === 0) swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
      }}
      onPointerUp={(e) => {
        const start = swipe.current
        swipe.current = null
        if (!start || start.id !== e.pointerId) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
          go(index + (dx < 0 ? 1 : -1))
        }
      }}
      onPointerCancel={() => {
        swipe.current = null
      }}
    >
      <header className="flex shrink-0 items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] opacity-70">{presetName}</div>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[19px] font-semibold">{scene.name}</span>
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
        <button
          className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>

      <main className="relative flex min-h-0 flex-1 items-center justify-center px-20 pb-2">
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
        ) : (
          /* 우클릭 메뉴 (복사·메타데이터 등) — 라이트박스와 같다 */
          <ImageContextMenu filePath={scene.thumbnailPath}>
            <img
              key={scene.id}
              src={imageUrl(scene.thumbnailPath)}
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
        {t('ui.customReviewHint')}
      </footer>
    </div>,
    document.body
  )
}

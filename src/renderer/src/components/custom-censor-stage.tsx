import {
  Brush,
  Eraser,
  Hand,
  Loader2,
  Maximize,
  Minus,
  MousePointerClick,
  Plus,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CensorPickResult } from '@shared/types'
import { imageUrl } from '../lib/constants'
import {
  BRUSH_DEFAULT,
  BRUSH_MAX,
  BRUSH_MIN,
  fitView,
  stepBrush,
  toImage,
  toolFor,
  zoomAt,
  type CensorTool,
  type CensorView
} from '../lib/custom-censor'
import { useT } from '../lib/i18n'
import { intSetting, useStoredSetting } from '../lib/stored-setting'
import { cn } from '../lib/utils'
import { useCensorStore } from '../stores/custom-censor-store'
import { toast } from '../stores/toast-store'

const BRUSH_SETTING = intSetting(BRUSH_MIN, BRUSH_MAX)
/** 마지막으로 고친 뒤 이만큼 손을 떼면 저장한다 */
const SAVE_DELAY_MS = 1200
const UNDO_MAX = 12

interface Session {
  /** 저장할 때 넘기는 그림 — 열 때의 대표 이미지, 한 번 저장한 뒤로는 칠한 그림 */
  opened: string
  basePath: string
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

function canvasPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('canvas'))
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('canvas'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  )
}

/**
 * [custom] 검수 모드의 검열 — 대표 이미지에 흰칠을 한다.
 * 휠 = 확대·축소, Ctrl+휠 = 붓 크기, 긋기 = 흰칠, Shift = 지우기, Alt+누르기 = 콕 찍기(누른 자리의 모양대로 칠함),
 * Space·가운데 버튼으로 끌기 = 이동, Ctrl+Z = 되돌리기. 키 없이 쓰는 화면용으로 아래에 같은 도구 버튼이 있다.
 * 원본 그림 위에 칠 레이어(흰색 + 알파)를 겹쳐 보여 주고, 손을 떼면 잠시 뒤 알아서 저장한다 —
 * 원본은 그대로 두고 칠한 그림이 씬의 새 대표 이미지가 된다 (main/custom/censor.ts).
 */
export function CensorStage({
  filePath
}: {
  /** 씬의 지금 대표 이미지 */
  filePath: string
}): React.JSX.Element {
  const t = useT()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [view, setView] = useState<CensorView>({ scale: 1, x: 0, y: 0 })
  const viewRef = useRef(view)
  /** 사용자가 확대·이동을 하지 않았으면 칸 크기가 바뀔 때 다시 맞춘다 */
  const fitted = useRef(true)
  const [tool, setTool] = useState<CensorTool>('paint')
  const toolRef = useRef(tool)
  const [brush, setBrush] = useStoredSetting('custom_censor_brush', BRUSH_DEFAULT, BRUSH_SETTING)
  const brushRef = useRef(brush)
  // 누르기·휠 처리기가 늘 지금 값을 보게 맞춰 둔다
  useLayoutEffect(() => {
    viewRef.current = view
    toolRef.current = tool
    brushRef.current = brush
  })
  const [busy, setBusy] = useState(false)
  const [undoCount, setUndoCount] = useState(0)
  const undo = useRef<ImageData[]>([])
  const [lastPick, setLastPick] = useState<{
    result: CensorPickResult
    index: number
    before: ImageData
  } | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>(
    'idle'
  )
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const space = useRef(false)
  const modelPercent = useCensorStore((s) => s.modelPercent)

  const ctx = (): CanvasRenderingContext2D | null =>
    canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null

  const fit = useCallback((): void => {
    const box = boxRef.current
    const s = sessionRef.current
    if (!box || !s) return
    setView(fitView(box.clientWidth, box.clientHeight, s.width, s.height))
    fitted.current = true
  }, [])

  // ── 저장 ────────────────────────────────────────────────
  const save = useCallback((): Promise<void> => {
    clearTimeout(saveTimer.current)
    const canvas = canvasRef.current
    const s = sessionRef.current
    if (!dirty.current || !canvas || !s) return saving.current
    dirty.current = false
    setSaveState('saving')
    // 지금 칠한 모습을 바로 떠 둔다 — 저장이 밀려도 그 뒤에 고친 것과 섞이지 않게
    const snapshot = canvasPngBase64(canvas)
    saving.current = saving.current
      .then(async () => {
        const saved = await window.nais.invoke('custom:censorSave', {
          filePath: s.opened,
          maskBase64: await snapshot
        })
        s.opened = saved.filePath
        useCensorStore.getState().bump(saved.filePath)
        setSaveState((now) => (now === 'saving' ? 'saved' : now))
      })
      .catch((error: unknown) => {
        dirty.current = true
        setSaveState('error')
        toast(error instanceof Error ? error.message : String(error), 'error')
      })
    return saving.current
  }, [])

  const touch = (): void => {
    dirty.current = true
    setSaveState('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
  }

  // ── 그림 열기 ────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    void (async () => {
      // 우리 저장이 끝나기를 기다린 뒤 본다 — 저장 알림이 응답보다 먼저 와서 대표 이미지가 바뀐 것일 수 있다
      await saving.current
      if (!alive || sessionRef.current?.opened === filePath) return
      try {
        const opened = await window.nais.invoke('custom:censorOpen', { filePath })
        const mask = opened.maskBase64
          ? await loadImage(`data:image/png;base64,${opened.maskBase64}`)
          : null
        if (!alive) return
        const next: Session = {
          opened: filePath,
          basePath: opened.basePath,
          width: opened.width,
          height: opened.height
        }
        sessionRef.current = next
        setSession(next)
        undo.current = []
        setUndoCount(0)
        setLastPick(null)
        dirty.current = false
        setSaveState('idle')
        // 캔버스가 새 크기로 그려진 다음에 전에 칠해 둔 자리를 올린다
        requestAnimationFrame(() => {
          const c = ctx()
          const canvas = canvasRef.current
          if (!alive || !c || !canvas) return
          c.clearRect(0, 0, canvas.width, canvas.height)
          if (mask) {
            // 저장된 마스크는 밝기 = 칠한 정도 — 흰색 + 알파로 바꿔 올린다
            c.drawImage(mask, 0, 0, canvas.width, canvas.height)
            const data = c.getImageData(0, 0, canvas.width, canvas.height)
            for (let i = 0; i < data.data.length; i += 4) {
              data.data[i + 3] = data.data[i]
              data.data[i] = data.data[i + 1] = data.data[i + 2] = 255
            }
            c.putImageData(data, 0, 0)
          }
          fit()
        })
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error')
      }
    })()
    return () => {
      alive = false
    }
  }, [filePath, fit])

  // 나갈 때(다른 씬으로 넘기기·검열 끄기·닫기) 고친 것을 저장한다
  useEffect(() => () => void save(), [save])

  // 콕 찍기 모델을 미리 준비한다 (처음이면 여기서 받기 시작한다)
  useEffect(() => {
    window.nais.invoke('custom:censorWarm', undefined).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : String(error), 'error')
    })
  }, [])

  // 칸 크기가 바뀌면 (창 크기·Claude 창) 맞춤 상태일 때만 다시 맞춘다
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(() => {
      if (fitted.current) fit()
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [fit])

  // ── 되돌리기 ─────────────────────────────────────────────
  const snapshot = (): ImageData | null => {
    const canvas = canvasRef.current
    return canvas ? (ctx()?.getImageData(0, 0, canvas.width, canvas.height) ?? null) : null
  }
  const pushUndo = (data: ImageData | null): void => {
    if (!data) return
    undo.current.push(data)
    if (undo.current.length > UNDO_MAX) undo.current.shift()
    setUndoCount(undo.current.length)
  }
  const undoOnce = (): void => {
    const data = undo.current.pop()
    if (!data) return
    ctx()?.putImageData(data, 0, 0)
    setUndoCount(undo.current.length)
    setLastPick(null)
    touch()
  }

  // ── 콕 찍기 ──────────────────────────────────────────────
  const drawShape = async (shape: CensorPickResult['shapes'][number]): Promise<void> => {
    const img = await loadImage(`data:image/png;base64,${shape.png}`)
    const c = ctx()
    if (!c) return
    c.globalCompositeOperation = 'source-over'
    c.drawImage(img, shape.x, shape.y)
  }
  const pick = async (x: number, y: number): Promise<void> => {
    const s = sessionRef.current
    if (!s || busy || x < 0 || y < 0 || x >= s.width || y >= s.height) return
    setBusy(true)
    try {
      const result = await window.nais.invoke('custom:censorPick', {
        filePath: s.basePath,
        x,
        y
      })
      if (sessionRef.current !== s) return
      if (result.shapes.length === 0) {
        toast(t('ui.customCensorPickNone'), 'info')
        return
      }
      const before = snapshot()
      if (!before) return
      pushUndo(before)
      await drawShape(result.shapes[result.pick])
      setLastPick({ result, index: result.pick, before })
      touch()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }
  /** 방금 찍은 자리를 더 작은/큰 모양으로 바꾼다 */
  const resizePick = async (step: number): Promise<void> => {
    if (!lastPick) return
    const index = lastPick.index + step
    if (index < 0 || index >= lastPick.result.shapes.length) return
    ctx()?.putImageData(lastPick.before, 0, 0)
    await drawShape(lastPick.result.shapes[index])
    setLastPick({ ...lastPick, index })
    touch()
  }

  // ── 누르기·긋기 ──────────────────────────────────────────
  const drag = useRef<
    | { kind: 'stroke'; id: number; x: number; y: number }
    | { kind: 'pan'; id: number; px: number; py: number; view: CensorView }
    | null
  >(null)
  const local = (e: { clientX: number; clientY: number }): { px: number; py: number } => {
    const rect = boxRef.current!.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }
  const moveRing = (px: number, py: number, show: boolean): void => {
    const ring = ringRef.current
    if (!ring) return
    const size = Math.max(4, brushRef.current * viewRef.current.scale)
    ring.style.display = show ? 'block' : 'none'
    ring.style.width = ring.style.height = `${size}px`
    ring.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px)`
  }
  const strokeTo = (
    x: number,
    y: number,
    erase: boolean,
    from?: { x: number; y: number }
  ): void => {
    const c = ctx()
    if (!c) return
    c.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    c.strokeStyle = c.fillStyle = '#fff'
    c.lineWidth = brushRef.current
    c.lineCap = c.lineJoin = 'round'
    c.beginPath()
    if (from) {
      c.moveTo(from.x, from.y)
      c.lineTo(x, y)
      c.stroke()
    } else {
      c.arc(x, y, brushRef.current / 2, 0, Math.PI * 2)
      c.fill()
    }
  }
  const erasing = useRef(false)

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!sessionRef.current || (e.button !== 0 && e.button !== 1)) return
    const { px, py } = local(e)
    const using = toolFor(toolRef.current, {
      alt: e.altKey,
      shift: e.shiftKey,
      space: space.current,
      button: e.button
    })
    if (using === 'pick') {
      const at = toImage(viewRef.current, px, py)
      void pick(at.x, at.y)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (using === 'pan') {
      drag.current = { kind: 'pan', id: e.pointerId, px, py, view: viewRef.current }
      return
    }
    const at = toImage(viewRef.current, px, py)
    pushUndo(snapshot())
    setLastPick(null)
    erasing.current = using === 'erase'
    strokeTo(at.x, at.y, erasing.current)
    drag.current = { kind: 'stroke', id: e.pointerId, x: at.x, y: at.y }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const { px, py } = local(e)
    const d = drag.current
    const hover = toolFor(toolRef.current, {
      alt: e.altKey,
      shift: e.shiftKey,
      space: space.current,
      button: 0
    })
    moveRing(px, py, d?.kind === 'stroke' || (!d && (hover === 'paint' || hover === 'erase')))
    if (!d || d.id !== e.pointerId) return
    if (d.kind === 'pan') {
      fitted.current = false
      setView({ ...d.view, x: d.view.x + px - d.px, y: d.view.y + py - d.py })
      return
    }
    // 빠르게 그을 때 사이 점까지 받아 매끈하게 잇는다
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const p = local(ev)
      const at = toImage(viewRef.current, p.px, p.py)
      strokeTo(at.x, at.y, erasing.current, d)
      d.x = at.x
      d.y = at.y
    }
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (d.kind === 'stroke') touch()
  }

  // 휠 = 확대·축소 (커서 자리 기준), Ctrl+휠 = 붓 크기
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (!e.deltaY) return
      const { px, py } = local(e)
      if (e.ctrlKey || e.metaKey) {
        const next = stepBrush(brushRef.current, e.deltaY < 0)
        brushRef.current = next
        setBrush(next)
        moveRing(px, py, true)
        return
      }
      const s = sessionRef.current
      if (!s) return
      const fitScale = fitView(box.clientWidth, box.clientHeight, s.width, s.height).scale
      fitted.current = false
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), px, py, fitScale))
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setBrush는 렌더마다 새로 만들어지지만 하는 일은 같다
  }, [])

  // 키: Space = 누르는 동안 이동, Ctrl+Z = 되돌리기, [ ] = 붓 크기. Alt는 창 메뉴로 넘어가지 않게 막는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const down = e.type === 'keydown'
      if (e.key === 'Alt') {
        e.preventDefault()
        return
      }
      if (e.code === 'Space') {
        space.current = down
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!down) return
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') undoOnce()
      else if (e.key === '[' || e.key === ']') {
        const next = stepBrush(brushRef.current, e.key === ']')
        brushRef.current = next
        setBrush(next)
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  })

  const zoomButton = (factor: number): void => {
    const box = boxRef.current
    const s = sessionRef.current
    if (!box || !s) return
    const fitScale = fitView(box.clientWidth, box.clientHeight, s.width, s.height).scale
    fitted.current = false
    setView((v) => zoomAt(v, factor, box.clientWidth / 2, box.clientHeight / 2, fitScale))
  }

  const tools: { id: CensorTool; label: string; hint: string; icon: React.ReactNode }[] = [
    {
      id: 'paint',
      label: t('ui.customCensorPaint'),
      hint: t('ui.customCensorPaintHint'),
      icon: <Brush size={15} />
    },
    {
      id: 'erase',
      label: t('ui.customCensorErase'),
      hint: t('ui.customCensorEraseHint'),
      icon: <Eraser size={15} />
    },
    {
      id: 'pick',
      label: t('ui.customCensorPick'),
      hint: t('ui.customCensorPickHint'),
      icon: <MousePointerClick size={15} />
    },
    {
      id: 'pan',
      label: t('ui.customCensorPan'),
      hint: t('ui.customCensorPanHint'),
      icon: <Hand size={15} />
    }
  ]
  const iconButton =
    'grid size-8 shrink-0 place-items-center rounded-full text-white/85 transition hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30'
  const status =
    modelPercent !== null
      ? t('ui.customCensorModelValue', modelPercent)
      : saveState === 'saving' || saveState === 'dirty'
        ? t('ui.customCensorSaving')
        : saveState === 'saved'
          ? t('ui.customCensorSaved')
          : saveState === 'error'
            ? t('ui.customCensorSaveFailed')
            : ''

  return (
    <div className="relative h-full w-full">
      <div
        ref={boxRef}
        data-censor-stage
        className={cn(
          'absolute inset-0 touch-none overflow-hidden rounded-lg',
          tool === 'pan' ? 'cursor-grab' : tool === 'pick' ? 'cursor-crosshair' : 'cursor-none'
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => moveRing(0, 0, false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {session && (
          <div
            className="absolute left-0 top-0 origin-top-left shadow-2xl"
            style={{
              width: session.width,
              height: session.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
            }}
          >
            <img
              src={imageUrl(session.basePath)}
              className="pointer-events-none absolute inset-0 h-full w-full"
              draggable={false}
              alt=""
            />
            <canvas
              // 화면에서 떼어진 뒤에도(나갈 때 저장) 캔버스를 쓸 수 있게 한 번 잡은 것을 놓지 않는다
              ref={(el) => {
                if (el) canvasRef.current = el
              }}
              width={session.width}
              height={session.height}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          </div>
        )}
        {/* 붓 크기 고리 — 흰 그림·어두운 그림 어디서나 보이게 두 겹 */}
        <div
          ref={ringRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 hidden rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
        />
        {busy && (
          <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[12px]">
            <Loader2 size={14} className="animate-spin" /> {t('ui.customCensorPicking')}
          </div>
        )}
      </div>

      <div
        role="toolbar"
        aria-label={t('ui.customCensor')}
        className="absolute inset-x-0 bottom-2 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl bg-black/75 px-2 py-1.5 text-[12.5px] shadow-lg backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {tools.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tool === item.id}
            title={item.hint}
            onClick={() => setTool(item.id)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 transition',
              tool === item.id
                ? 'bg-accent font-medium text-on-accent'
                : 'text-white/85 hover:bg-white/15'
            )}
          >
            {item.icon} {item.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
        <button
          type="button"
          className={iconButton}
          aria-label={t('ui.customCensorBrushSmaller')}
          title={t('ui.customCensorBrushHint')}
          disabled={brush <= BRUSH_MIN}
          onClick={() => setBrush(stepBrush(brush, false))}
        >
          <Minus size={15} />
        </button>
        <span
          className="w-12 shrink-0 text-center font-mono text-[12px] opacity-85"
          title={t('ui.customCensorBrushHint')}
        >
          {t('ui.customCensorBrushValue', brush)}
        </span>
        <button
          type="button"
          className={iconButton}
          aria-label={t('ui.customCensorBrushBigger')}
          title={t('ui.customCensorBrushHint')}
          disabled={brush >= BRUSH_MAX}
          onClick={() => setBrush(stepBrush(brush, true))}
        >
          <Plus size={15} />
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
        <button
          type="button"
          className={iconButton}
          aria-label={t('ui.zoomOut')}
          title={t('ui.zoomOut')}
          onClick={() => zoomButton(1 / 1.4)}
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={t('ui.customCensorFit')}
          title={t('ui.customCensorFit')}
          onClick={fit}
        >
          <Maximize size={15} />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={t('ui.zoomIn')}
          title={t('ui.zoomIn')}
          onClick={() => zoomButton(1.4)}
        >
          <ZoomIn size={15} />
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
        <button
          type="button"
          className={iconButton}
          aria-label={t('ui.customCensorUndo')}
          title={t('ui.customCensorUndo')}
          disabled={undoCount === 0}
          onClick={undoOnce}
        >
          <Undo2 size={15} />
        </button>
        {lastPick && lastPick.result.shapes.length > 1 && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
            <button
              type="button"
              className="h-8 shrink-0 rounded-full px-2.5 text-white/85 hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30"
              disabled={lastPick.index === 0}
              onClick={() => void resizePick(-1)}
            >
              {t('ui.customCensorPickSmaller')}
            </button>
            <button
              type="button"
              className="h-8 shrink-0 rounded-full px-2.5 text-white/85 hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30"
              disabled={lastPick.index === lastPick.result.shapes.length - 1}
              onClick={() => void resizePick(1)}
            >
              {t('ui.customCensorPickBigger')}
            </button>
          </>
        )}
        {status && (
          <span className="ml-1 shrink-0 px-1 text-[11.5px] opacity-70" role="status">
            {status}
          </span>
        )}
      </div>
    </div>
  )
}

import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Slider({
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      // [custom] 터치·원격 모드의 끌어서 스크롤이 슬라이더 조작을 가로채지 않게
      data-no-drag-scroll=""
      className={cn(
        'relative flex w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-2">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="block size-3.5 rounded-full border border-accent bg-paper shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </SliderPrimitive.Root>
  )
}

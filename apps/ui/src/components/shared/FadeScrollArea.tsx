// This is a wrapper around Radix’s ScrollArea that shows subtle alpha-mask fade
// “hints” whenever there is more content to scroll to above or below the viewport.
// Using CSS mask-image fades the scrolled content directly into whatever card or
// page background sits behind it without any color seam.
// It also has a thin scrollbar.

import * as React from 'react'
import {Root as ScrollRoot, Viewport as ScrollViewport, Corner as ScrollCorner} from '@radix-ui/react-scroll-area'
import {cn} from '@/lib/utils'
import {SexyScrollBar} from '@/components/shared/SexyScrollBar'

type Props = React.ComponentProps<typeof ScrollRoot> & {
	// Optional ref to the inner viewport element so parents can control scrolling
	viewportRef?: React.Ref<HTMLDivElement>
}

export default function FadeScrollArea({className, children, viewportRef: externalViewportRef, ...props}: Props) {
	const viewportRef = React.useRef<HTMLDivElement | null>(null)
	const contentRef = React.useRef<HTMLDivElement | null>(null)
	const [showTop, setShowTop] = React.useState(false)
	const [showBottom, setShowBottom] = React.useState(false)

	const update = React.useCallback(() => {
		const vp = viewportRef.current
		if (!vp) return
		const EPS = 1
		setShowTop(vp.scrollTop > EPS)
		setShowBottom(vp.scrollHeight - vp.clientHeight - vp.scrollTop > EPS)
	}, [])

	React.useLayoutEffect(update, [update])
	React.useEffect(() => {
		const id = requestAnimationFrame(update)
		return () => cancelAnimationFrame(id)
	}, [update])
	React.useEffect(() => {
		const vp = viewportRef.current
		const ct = contentRef.current
		if (!vp || !ct) return
		vp.addEventListener('scroll', update, {passive: true})
		const ro = new ResizeObserver(update)
		ro.observe(vp)
		ro.observe(ct)
		return () => {
			vp.removeEventListener('scroll', update)
			ro.disconnect()
		}
	}, [update])

	const maskImage = React.useMemo(() => {
		if (!showTop && !showBottom) return undefined
		const topStop = showTop ? 'transparent 0px, black 56px' : 'black 0px'
		const bottomStop = showBottom ? 'black calc(100% - 56px), transparent 100%' : 'black 100%'
		return `linear-gradient(to bottom, ${topStop}, ${bottomStop})`
	}, [showTop, showBottom])

	return (
		<ScrollRoot data-slot='scroll-area' className={cn('relative', className)} {...props}>
			<ScrollViewport
				ref={(el) => {
					viewportRef.current = el
					if (typeof externalViewportRef === 'function') {
						externalViewportRef(el)
					} else if (externalViewportRef && 'current' in (externalViewportRef as any)) {
						;(externalViewportRef as React.MutableRefObject<HTMLDivElement | null>).current = el
					}
				}}
				data-slot='scroll-area-viewport'
				style={maskImage ? {maskImage, WebkitMaskImage: maskImage} : undefined}
				className='size-full rounded-[inherit] transition-[color,box-shadow]
                   outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50
                   focus-visible:outline-1'
			>
				<div ref={contentRef}>{children}</div>
			</ScrollViewport>

			<SexyScrollBar orientation='vertical' />
			<SexyScrollBar orientation='horizontal' />

			<ScrollCorner />
		</ScrollRoot>
	)
}

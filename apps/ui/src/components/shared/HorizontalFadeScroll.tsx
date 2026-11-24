// Horizontal scroll container with alpha-mask fade hints on left/right edges
// and hidden scrollbar for a cleaner look

import * as React from 'react'
import {cn} from '@/lib/utils'

type Props = {
	className?: string
	children: React.ReactNode
}

export default function HorizontalFadeScroll({className, children}: Props) {
	const scrollRef = React.useRef<HTMLDivElement | null>(null)
	const [showLeft, setShowLeft] = React.useState(false)
	const [showRight, setShowRight] = React.useState(false)

	const update = React.useCallback(() => {
		const el = scrollRef.current
		if (!el) return
		const EPS = 1
		setShowLeft(el.scrollLeft > EPS)
		setShowRight(el.scrollWidth - el.clientWidth - el.scrollLeft > EPS)
	}, [])

	React.useLayoutEffect(update, [update])

	React.useEffect(() => {
		const el = scrollRef.current
		if (!el) return
		el.addEventListener('scroll', update, {passive: true})
		const ro = new ResizeObserver(update)
		ro.observe(el)
		if (el.firstElementChild) ro.observe(el.firstElementChild)
		return () => {
			el.removeEventListener('scroll', update)
			ro.disconnect()
		}
	}, [update])

	const maskImage = React.useMemo(() => {
		if (!showLeft && !showRight) return undefined
		const leftStop = showLeft ? 'transparent 0px, black 36px' : 'black 0px'
		const rightStop = showRight ? 'black calc(100% - 36px), transparent 100%' : 'black 100%'
		return `linear-gradient(to right, ${leftStop}, ${rightStop})`
	}, [showLeft, showRight])

	return (
		<div className='relative'>
			<div
				ref={scrollRef}
				style={maskImage ? {maskImage, WebkitMaskImage: maskImage} : undefined}
				className={cn(
					'overflow-x-auto overflow-y-hidden',
					// Hide scrollbar
					'[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
					className,
				)}
			>
				{children}
			</div>
		</div>
	)
}

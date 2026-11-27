import {useEffect, useRef} from 'react'

// Ref-backed global mouse tracker so cursor movement never triggers React re-renders
export function useGlobalMouse() {
	const mouseRef = useRef({x: 0, y: 0})

	useEffect(() => {
		const handleMouseMove = (event: MouseEvent) => {
			if (
				event.clientX >= 0 &&
				event.clientX <= window.innerWidth &&
				event.clientY >= 0 &&
				event.clientY <= window.innerHeight
			) {
				mouseRef.current.x = (event.clientX / window.innerWidth) * 2 - 1
				mouseRef.current.y = -(event.clientY / window.innerHeight) * 2 + 1
			} else {
				mouseRef.current.x = 0
				mouseRef.current.y = 0
			}
		}

		const handleMouseLeave = () => {
			mouseRef.current.x = 0
			mouseRef.current.y = 0
		}

		document.addEventListener('mousemove', handleMouseMove, {passive: true})
		document.addEventListener('mouseleave', handleMouseLeave, {passive: true})

		return () => {
			document.removeEventListener('mousemove', handleMouseMove)
			document.removeEventListener('mouseleave', handleMouseLeave)
		}
	}, [])

	return mouseRef
}

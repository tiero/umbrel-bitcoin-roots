// Main Blocks component with 3D scene
import {useEffect, useState} from 'react'
import {Canvas} from '@react-three/fiber'
import {Scene} from './Scene.js'

const CAMERA_CONFIG = {position: [0, 0, 8] as [number, number, number], zoom: 50}
const GL_CONFIG = {powerPreference: 'default' as const}

export default function Blocks() {
	const [isHidden, setIsHidden] = useState(() => document.hidden)

	useEffect(() => {
		const onVisibilityChange = () => setIsHidden(document.hidden)
		document.addEventListener('visibilitychange', onVisibilityChange)
		return () => document.removeEventListener('visibilitychange', onVisibilityChange)
	}, [])

	return (
		<div className='w-[768px] h-[180px] overflow-hidden'>
			<Canvas
				orthographic
				dpr={[1, 1.5]}
				frameloop={isHidden ? 'never' : 'always'}
				camera={CAMERA_CONFIG}
				gl={GL_CONFIG}
			>
				<Scene />
			</Canvas>
		</div>
	)
}

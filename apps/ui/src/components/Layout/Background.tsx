export default function Background() {
	return (
		<div
			className='fixed inset-0 -z-10'
			style={{
				background:
					'radial-gradient(circle at top left, rgba(247, 147, 26, 0.20), transparent 30%), ' +
					'radial-gradient(circle at top right, rgba(225, 83, 100, 0.17), transparent 26%), ' +
					'linear-gradient(180deg, #171717 0%, #1A1616 100%)',
			}}
		/>
	)
}

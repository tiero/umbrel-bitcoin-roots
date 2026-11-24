import {clsx} from 'clsx'

export default function StatusDot({running}: {running: boolean}) {
	return (
		<span className='relative inline-flex items-center' role='status' aria-label={running ? 'running' : 'stopped'}>
			{/* halo */}
			<span
				className={clsx(
					'absolute inset-0 rounded-full blur-[2px] transition-colors duration-200',
					running ? 'bg-[#3DD68C]' : 'bg-[#E15364]',
				)}
			/>
			{/* solid core */}
			<span
				className={clsx(
					'relative inline-block h-2 w-2 rounded-full shadow transition-colors duration-200',
					running ? 'bg-[#3DD68C]' : 'bg-[#E15364]',
				)}
			/>
		</span>
	)
}

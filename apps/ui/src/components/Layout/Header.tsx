import clsx from 'clsx'
import {cn} from '@/lib/utils'

// We import SVGs as React components via `?react` (SVGR):
// This inlines the <svg>, so there's no extra HTTP request.
// It also gives us the same behaviors as normal DOM elements—easy to size, recolor, and animate.
import Logo from '@/assets/logo.svg?react'

import ConnectionDetails from '@/components/ConnectionDetails'
import {useBitcoindVersion} from '@/hooks/useBitcoind'

export default function Header({className}: {className?: string}) {
	const {data: version, isLoading, isError} = useBitcoindVersion()

	const fallbackName = 'Bitcoin Roots'
	const implementation =
		version?.implementation && version.implementation !== 'unknown' ? version.implementation : fallbackName
	const cleanedVersion =
		version?.version && version.version !== 'unknown' ? version.version.replace(/^v/i, '') : undefined
	const fullVersionString = cleanedVersion ? `${implementation} ${cleanedVersion}` : implementation

	return (
		<header className={cn('flex items-end md:items-center justify-between mb-6 md:mb-8 w-full', className)}>
			<div className='flex flex-row items-center gap-2.5 md:gap-3.5'>
				<Logo aria-label='Bitcoin Roots logo' className='w-[50px] md:w-[60px] h-[50px] md:h-[60px] shrink-0' />
				<div>
					<h1 className='font-outfit text-[22px] md:text-[28px] font-[500] bg-roots-heading-gradient bg-clip-text text-transparent leading-none pb-1'>
						Bitcoin Roots
					</h1>

					{/* We gracefully handle loading and error states for no layout shift */}
					<p className='text-[14px] md:text-[16px] leading-none font-[400] text-white/60'>
						<span
							className={clsx(
								'inline-block transition-opacity duration-500 ease-in-out',
								isLoading ? 'opacity-0 select-none' : 'opacity-100',
							)}
						>
							{isLoading || isError ? fallbackName : fullVersionString}
						</span>
					</p>
				</div>
			</div>
			<div>
				{/* Connect button + modal */}
				<ConnectionDetails />
			</div>
		</header>
	)
}

import type {Config} from 'tailwindcss'

export default {
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,mdx}'],
	theme: {
		extend: {
			fontFamily: {
				dmSans: ['DM Sans Variable', 'sans-serif'],
				outfit: ['Outfit Variable', 'sans-serif'],
			},
			backgroundImage: {
				'card-gradient': 'linear-gradient(180deg, rgba(38, 33, 33, 0.96), rgba(31, 27, 27, 0.98))',
				'text-gradient': 'linear-gradient(to bottom, hsla(0,0%,100%,1), hsla(0,0%,100%,0.72))',
				'roots-heading-gradient': 'linear-gradient(90deg, #F7931A 4%, #E15364 48%, #FF9F2D 100%)',
				'button-gradient': 'linear-gradient(180deg, #292424, #211D1D)',
				'dock-gradient': 'linear-gradient(180deg, rgba(41, 36, 36, 0.94), rgba(29, 25, 25, 0.96))',
			},
		},
	},
	plugins: [],
} satisfies Config

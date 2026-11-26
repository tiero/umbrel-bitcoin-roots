import {lazy} from 'react'
import {createBrowserRouter, createRoutesFromElements, Route} from 'react-router-dom'

import {Layout} from './components/Layout/Layout'

const HomePage = lazy(() => import('./pages/home'))
const InsightsPage = lazy(() => import('./pages/insights'))
const SettingsPage = lazy(() => import('./pages/settings'))
const NotFoundPage = lazy(() => import('./pages/not-found'))

// Each page is rendered inside the <Outlet /> of <Layout>
// Header and floating Dock are shared across all pages
export const router = createBrowserRouter(
	createRoutesFromElements(
		<Route element={<Layout />}>
			<Route index element={<HomePage />} />
			<Route path='insights' element={<InsightsPage />} />
			<Route path='settings' element={<SettingsPage />} />
			<Route path='*' element={<NotFoundPage />} />
		</Route>,
	),
)

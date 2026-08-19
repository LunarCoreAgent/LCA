import { useEffect, useState } from 'react'
import { Layout, type PageId } from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import Chat from '@/pages/Chat'
import Models from '@/pages/Models'
import RouterPage from '@/pages/RouterPage'
import Plugins from '@/pages/Plugins'
import Integrations from '@/pages/Integrations'
import Automation from '@/pages/Automation'
import CronPage from '@/pages/CronPage'
import MemoryPage from '@/pages/MemoryPage'
import Permissions from '@/pages/Permissions'
import Learning from '@/pages/Learning'
import StockData from '@/pages/StockData'
import Quant from '@/pages/Quant'
import Evolution from '@/pages/Evolution'
import DataCenter from '@/pages/DataCenter'
import DatabasePage from '@/pages/Database'
import Versions from '@/pages/Versions'
import Knowledge from '@/pages/Knowledge'
import Portfolio from '@/pages/Portfolio'
import Journal from '@/pages/Journal'
import DailyReview from '@/pages/DailyReview'
import Prediction from '@/pages/Prediction'
import Benchmark from '@/pages/Benchmark'
import PaperTrading from '@/pages/PaperTrading'
import RiskCenter from '@/pages/RiskCenter'
// 实盘网关已隐藏（v0.10.2），恢复时取消下行注释
// import LiveTrading from '@/pages/LiveTrading'
import EnsembleCenter from '@/pages/EnsembleCenter'
import ShadowAccount from '@/pages/ShadowAccount'
import SourceHealth from '@/pages/SourceHealth'
import AlphaZoo from '@/pages/AlphaZoo'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard')

  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  return (
    <>
      <Layout page={page} setPage={setPage}>
        {page === 'dashboard' && <Dashboard go={setPage} />}
        {page === 'chat' && <Chat />}
        {page === 'models' && <Models />}
        {page === 'router' && <RouterPage />}
        {page === 'plugins' && <Plugins />}
        {page === 'integrations' && <Integrations />}
        {page === 'automation' && <Automation />}
        {page === 'cron' && <CronPage />}
        {page === 'memory' && <MemoryPage />}
        {page === 'permissions' && <Permissions />}
        {page === 'learning' && <Learning />}
        {page === 'evolution' && <Evolution />}
        {page === 'stockdata' && <StockData />}
        {page === 'datacenter' && <DataCenter />}
        {page === 'quant' && <Quant />}
        {page === 'database' && <DatabasePage />}
        {page === 'knowledge' && <Knowledge />}
        {page === 'portfolio' && <Portfolio />}
        {page === 'journal' && <Journal />}
        {page === 'shadow' && <ShadowAccount />}
        {page === 'sources' && <SourceHealth />}
        {page === 'review' && <DailyReview />}
        {page === 'prediction' && <Prediction />}
        {page === 'benchmark' && <Benchmark />}
        {page === 'paper' && <PaperTrading />}
        {page === 'risk' && <RiskCenter />}
        {/* {page === 'live' && <LiveTrading />} 实盘网关已隐藏（v0.10.2） */}
        {page === 'ensemble' && <EnsembleCenter />}
        {page === 'alpha' && <AlphaZoo />}
        {page === 'versions' && <Versions />}
      </Layout>
      <Toaster richColors position="bottom-right" />
    </>
  )
}

import { ElectronAPI } from '@electron-toolkit/preload'
import type { LuxAPI } from './api-contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: LuxAPI
  }
}

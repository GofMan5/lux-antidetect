import { create } from 'zustand'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: number
  level: LogLevel
  message: string
  timestamp: number
  source?: string
}

interface LogStore {
  logs: LogEntry[]
  addLog: (message: string, level?: LogLevel, source?: string) => void
  clear: () => void
}

let lid = 0

export const useLogStore = create<LogStore>((set) => ({
  logs: [],

  addLog: (message, level = 'info', source) => {
    const entry: LogEntry = { id: ++lid, level, message, timestamp: Date.now(), source }
    set((s) => ({
      logs: [...s.logs, entry].slice(-500)
    }))
  },

  clear: () => set({ logs: [] })
}))

// Intercept console for the debug panel
const origConsole = { log: console.log, warn: console.warn, error: console.error }

function patchConsole(): void {
  console.log = (...args: unknown[]) => {
    origConsole.log(...args)
    useLogStore.getState().addLog(args.map(String).join(' '), 'info', 'console')
  }
  console.warn = (...args: unknown[]) => {
    origConsole.warn(...args)
    useLogStore.getState().addLog(args.map(String).join(' '), 'warn', 'console')
  }
  console.error = (...args: unknown[]) => {
    origConsole.error(...args)
    useLogStore.getState().addLog(args.map(String).join(' '), 'error', 'console')
  }
}

// Capture unhandled errors
function patchErrors(): void {
  window.addEventListener('error', (e) => {
    useLogStore.getState().addLog(`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`, 'error', 'window')
  })
  window.addEventListener('unhandledrejection', (e) => {
    useLogStore.getState().addLog(`Unhandled rejection: ${e.reason}`, 'error', 'promise')
  })
}

export function initDebugCapture(): void {
  patchConsole()
  patchErrors()
  useLogStore.getState().addLog('Debug capture initialized', 'debug', 'system')
}

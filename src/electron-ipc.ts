export interface ElectronBridge {
  invoke<T = any>(channel: string, ...args: any[]): Promise<T>
  on(channel: string, listener: (...args: any[]) => void): void
  removeListener(channel: string, listener: (...args: any[]) => void): void
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge
    require?: any
  }
}

export const ipcRenderer: ElectronBridge | undefined =
  window.electronAPI || window.require?.('electron')?.ipcRenderer

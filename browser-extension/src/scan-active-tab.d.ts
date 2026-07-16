export function scanTab(
  tabId: number,
  chromeApi?: {
    tabs: { sendMessage: (tabId: number, message: { type: string }) => Promise<unknown> }
    scripting?: {
      executeScript: (options: { target: { tabId: number }; files: string[] }) => Promise<unknown>
    }
  },
): Promise<{ images?: Array<unknown> }>

export function scanTabWithRetry(
  tabId: number,
  chromeApi?: {
    tabs: { sendMessage: (tabId: number, message: { type: string }) => Promise<unknown> }
    scripting?: {
      executeScript: (options: { target: { tabId: number }; files: string[] }) => Promise<unknown>
    }
  },
  options?: { retryDelay?: number; sleep?: (delay: number) => Promise<unknown> },
): Promise<{ images?: Array<unknown> }>

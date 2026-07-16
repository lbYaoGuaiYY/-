const SCAN_MESSAGE = { type: "QINGSHE_SCAN" }

export async function scanTab(tabId, chromeApi = chrome) {
  try {
    return await chromeApi.tabs.sendMessage(tabId, SCAN_MESSAGE)
  } catch (initialError) {
    if (typeof chromeApi.scripting?.executeScript !== "function") throw initialError

    try {
      await chromeApi.scripting.executeScript({
        target: { tabId },
        files: ["provider-adapters.js", "content-script.js"],
      })
    } catch {
      throw initialError
    }

    return chromeApi.tabs.sendMessage(tabId, SCAN_MESSAGE)
  }
}

export async function scanTabWithRetry(
  tabId,
  chromeApi = chrome,
  {
    retryDelay = 400,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {},
) {
  const firstResult = await scanTab(tabId, chromeApi)
  if (firstResult?.images?.length) return firstResult

  await sleep(retryDelay)
  return scanTab(tabId, chromeApi)
}

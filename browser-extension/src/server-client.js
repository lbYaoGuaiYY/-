;(function defineServerClient(scope) {
  function createServerClient({ baseUrl, token, fetchImpl = fetch }) {
    const root = String(baseUrl || "")
      .trim()
      .replace(/\/+$/, "")
    if (!root || !token) throw new Error("浏览器插件尚未连接轻设服务器")

    async function request(path, options = {}) {
      const headers = {
        Authorization: `Bearer ${token}`,
        ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      }
      const response = await fetchImpl(`${root}/${String(path).replace(/^\/+/, "")}`, {
        method: options.method || "GET",
        headers,
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        ...(options.body === undefined ? {} : { body: options.body }),
      })
      if (!response.ok) {
        let detail = `轻设服务请求失败（HTTP ${response.status}）`
        try {
          const payload = await response.json()
          if (typeof payload?.detail === "string") detail = payload.detail
        } catch {
          // Keep the status-based message when the response is not JSON.
        }
        const error = new Error(detail)
        error.status = response.status
        throw error
      }
      if (response.status === 204) return null
      return response.json()
    }

    return {
      heartbeat() {
        return request("extension-devices/heartbeat", { method: "POST", json: {} })
      },
      createRun(config) {
        return request("extension-runs", { method: "POST", json: config })
      },
      readRun(runId) {
        return request(`extension-runs/${encodeURIComponent(runId)}`)
      },
      cancelRun(runId) {
        return request(`extension-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" })
      },
      updateItem(runId, itemId, update) {
        return request(
          `extension-runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
          { method: "PATCH", json: update },
        )
      },
      uploadItem(runId, itemId, blob, filename = "generated-image.png") {
        const body = new FormData()
        body.set("original", new File([blob], filename, { type: blob.type || "image/png" }))
        return request(
          `extension-runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/upload`,
          { method: "POST", body },
        )
      },
    }
  }

  scope.QingsheServerClient = { createServerClient }
})(globalThis)

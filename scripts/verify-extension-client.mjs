import { readFile } from "node:fs/promises"
import { basename } from "node:path"

import "../browser-extension/src/server-client.js"

const apiUrl = process.env.QINGSHE_VERIFY_API_URL
const token = process.env.QINGSHE_VERIFY_EXTENSION_TOKEN
const sourcePath = process.env.QINGSHE_VERIFY_SOURCE_IMAGE

if (!apiUrl || !token || !sourcePath) {
  throw new Error("扩展客户端验收环境不完整")
}

const client = globalThis.QingsheServerClient.createServerClient({ baseUrl: apiUrl, token })
const run = await client.createRun({
  provider: "chatgpt",
  prompt: "真实插件闭环素材",
  count: 1,
  category: "花艺",
})
const item = run.items?.[0]
if (!run.id || !item?.id) throw new Error("扩展任务创建结果无效")

await client.updateItem(run.id, item.id, { status: "generating", error: null })
await client.updateItem(run.id, item.id, { status: "uploading", error: null })
const bytes = await readFile(sourcePath)
const uploaded = await client.uploadItem(
  run.id,
  item.id,
  new Blob([bytes], { type: "image/png" }),
  basename(sourcePath),
)

process.stdout.write(
  JSON.stringify({
    run_id: run.id,
    item_id: item.id,
    task_id: uploaded.task_id,
    created: uploaded.created,
  }),
)

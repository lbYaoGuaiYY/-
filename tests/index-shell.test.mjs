import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "..")

describe("原生启动壳", () => {
  it("在样式包加载前保持编辑器的深色底色", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8")

    expect(html).toContain("#111318")
    expect(html).toMatch(/<style>[\s\S]*html[\s\S]*background:\s*#111318/)
  })
})

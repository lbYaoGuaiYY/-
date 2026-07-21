import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

async function source(path) {
  return readFile(resolve(process.cwd(), path), "utf8")
}

describe("asset cloud proxy boundary", () => {
  it("pins the API and Caddy to a dedicated network", async () => {
    const compose = await source("deploy/asset-cloud/compose.yaml")
    const apiService = compose.match(/ {2}qingshe-assets:\n[\s\S]*?(?=\n {2}caddy:)/)?.[0] ?? ""

    expect(compose).toContain("ipv4_address: 172.30.232.2")
    expect(compose).toContain("ipv4_address: 172.30.232.3")
    expect(compose).toContain("subnet: 172.30.232.0/28")
    expect(apiService).not.toContain("ports:")
  })

  it("forwards only Caddy's parsed client IP and trusts its scheme headers", async () => {
    const [caddyfile, dockerfile] = await Promise.all([
      source("deploy/asset-cloud/Caddyfile"),
      source("deploy/asset-cloud/Dockerfile"),
    ])

    expect(caddyfile).toContain("header_up X-Qingshe-Client-IP {client_ip}")
    expect(caddyfile).toContain("lb_try_duration 5s")
    expect(caddyfile).toContain("lb_try_interval 250ms")
    expect(caddyfile).toContain("trusted_proxies_strict")
    expect(dockerfile).toContain('"--forwarded-allow-ips", "172.30.232.3"')
  })
})

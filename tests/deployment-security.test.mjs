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
    expect(compose).toContain("ipv4_address: 172.30.232.4")
    expect(compose).toContain("subnet: 172.30.232.0/28")
    expect(compose).toContain(`image: \${QINGSHE_APP_IMAGE:-qingshe-assets:latest}`)
    expect(compose).toContain("stop_grace_period: 30s")
    expect(apiService).not.toContain("ports:")
  })

  it("forwards only Caddy's parsed client IP and trusts its scheme headers", async () => {
    const [caddyfile, dockerfile] = await Promise.all([
      source("deploy/asset-cloud/Caddyfile"),
      source("deploy/asset-cloud/Dockerfile"),
    ])

    expect(caddyfile).toContain("header_up X-Qingshe-Client-IP {client_ip}")
    expect(caddyfile).toContain("qingshe-assets:7000 qingshe-assets-canary:7000")
    expect(caddyfile).toContain("lb_policy first")
    expect(caddyfile).toContain("health_uri /api/v1/health")
    expect(caddyfile).toContain("health_body")
    expect(caddyfile).toContain("ready|maintenance|degraded")
    expect(caddyfile).toContain("fail_duration 30s")
    expect(caddyfile).toContain("unhealthy_status 5xx")
    expect(caddyfile).toContain("lb_try_duration 5s")
    expect(caddyfile).toContain("lb_try_interval 250ms")
    expect(caddyfile).toContain("trusted_proxies_strict")
    expect(dockerfile).toContain('"--forwarded-allow-ips", "172.30.232.3"')
  })

  it("stages deployments without deleting or racing the serving project", async () => {
    const deployScript = await source("deploy/asset-cloud/deploy-remote.sh")

    expect(deployScript).toContain("flock -n 9")
    expect(deployScript).toContain("docker build --file")
    expect(deployScript).toContain(`qingshe-assets:\${revision}-\${build_id}`)
    expect(deployScript).toContain("docker image tag")
    expect(deployScript).toContain("{{.Image}}")
    expect(deployScript).toContain("docker compose up -d --no-deps qingshe-assets-canary")
    expect(deployScript).toContain("docker compose up -d --no-deps qingshe-assets")
    expect(deployScript).toContain("docker compose ps -q qingshe-assets")
    expect(deployScript).not.toContain("asset-cloud-qingshe-assets-1")
    expect(deployScript).toContain("QINGSHE_PUBLIC_URL")
    expect(deployScript).toContain("realpath --")
    expect(deployScript).not.toContain("--remove-orphans")
    expect(deployScript).not.toContain("docker compose down")
  })
})

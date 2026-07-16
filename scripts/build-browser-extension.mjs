import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, relative, resolve } from "node:path"
import { zipSync } from "fflate"

const root = resolve("browser-extension")
const source = resolve(root, "src")
const output = resolve(root, "dist")
const version = "0.2.0"
const sharedFiles = ["popup.js", "popup.html", "popup.css"]

async function copyShared(target) {
  await cp(source, target, { recursive: true })
  for (const file of sharedFiles) await cp(resolve(root, file), resolve(target, file))
  await cp(resolve("node_modules/fflate/esm/browser.js"), resolve(target, "fflate.js"))
}

async function archiveDirectory(directory, destination) {
  const files = {}
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else
        files[relative(directory, path).replaceAll("\\", "/")] = new Uint8Array(
          await readFile(path),
        )
    }
  }
  await visit(directory)
  await writeFile(destination, zipSync(files, { level: 9 }))
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const baseManifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"))

const chromeOutput = resolve(output, "chrome")
await mkdir(chromeOutput, { recursive: true })
await copyShared(chromeOutput)
const chromeManifest = structuredClone(baseManifest)
chromeManifest.background = { service_worker: "service-worker.js" }
delete chromeManifest.browser_specific_settings
await writeFile(
  resolve(chromeOutput, "manifest.json"),
  `${JSON.stringify(chromeManifest, null, 2)}\n`,
)

const firefoxOutput = resolve(output, "firefox")
await mkdir(firefoxOutput, { recursive: true })
await copyShared(firefoxOutput)
const firefoxManifest = structuredClone(baseManifest)
firefoxManifest.background = {
  scripts: ["automation-state.js", "server-client.js", "service-worker.js"],
}
await writeFile(
  resolve(firefoxOutput, "manifest.json"),
  `${JSON.stringify(firefoxManifest, null, 2)}\n`,
)

const chromeArchive = resolve(root, `qingshe-image-archive-${version}-chrome.zip`)
const firefoxArchive = resolve(root, `qingshe-image-archive-${version}-firefox.xpi`)
await archiveDirectory(chromeOutput, chromeArchive)
await archiveDirectory(firefoxOutput, firefoxArchive)

console.log(`Built Chrome extension: ${chromeOutput}`)
console.log(`Built Firefox extension: ${firefoxOutput}`)
console.log(`Built install packages: ${basename(chromeArchive)}, ${basename(firefoxArchive)}`)

import { copyFile } from "node:fs/promises"
import { resolve } from "node:path"

const outputDirectory = resolve("dist-asset-admin")

await copyFile(resolve(outputDirectory, "asset-admin.html"), resolve(outputDirectory, "index.html"))

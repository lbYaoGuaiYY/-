#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

const archivePath = process.argv[2]
if (!archivePath) {
  console.error("usage: dedupe-ios-staticlib.mjs <static-lib.a>")
  process.exit(2)
}

const archive = readFileSync(archivePath)
if (archive.subarray(0, 8).toString("ascii") !== "!<arch>\n") {
  throw new Error(`not a static archive: ${archivePath}`)
}

const members = []
let offset = 8
while (offset + 60 <= archive.length) {
  const header = archive.subarray(offset, offset + 60)
  const rawName = header.subarray(0, 16).toString("ascii")
  const sizeText = header.subarray(48, 58).toString("ascii").trim()
  const size = Number.parseInt(sizeText, 10)
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`invalid archive member size near offset ${offset}`)
  }

  let name = rawName.trim()
  let dataOffset = offset + 60
  let dataSize = size
  if (name.startsWith("#1/")) {
    const nameLength = Number.parseInt(name.slice(3), 10)
    name = archive
      .subarray(dataOffset, dataOffset + nameLength)
      .toString("utf8")
      .replace(/\0+$/g, "")
    dataOffset += nameLength
    dataSize -= nameLength
  } else {
    name = name.replace(/\/$/, "")
  }

  const data = archive.subarray(dataOffset, dataOffset + dataSize)
  members.push({ name, data })

  offset = dataOffset + dataSize
  if (offset % 2 === 1) offset += 1
}

const kept = []
const seen = new Set()
let removed = 0
for (const member of members) {
  if (member.name === "" || member.name.startsWith("__.SYMDEF")) continue
  if (seen.has(member.name)) {
    removed += 1
    continue
  }
  seen.add(member.name)
  kept.push(member)
}

if (removed === 0) {
  process.stdout.write(`no duplicate members in ${basename(archivePath)}\n`)
  process.exit(0)
}

const tempDirectory = mkdtempSync(join(tmpdir(), "qingshe-dedupe-staticlib-"))
try {
  const objectPaths = []
  for (const [index, member] of kept.entries()) {
    // Preserve original member names so nm/diagnostics stay readable, but avoid
    // collisions on disk by prefixing a stable index when necessary.
    const safeName = member.name.includes("/")
      ? `${String(index).padStart(4, "0")}-${basename(member.name)}`
      : member.name
    const objectPath = join(tempDirectory, safeName)
    writeFileSync(objectPath, member.data)
    objectPaths.push(objectPath)
  }

  const rebuilt = join(tempDirectory, "rebuilt.a")
  execFileSync("libtool", ["-static", "-o", rebuilt, ...objectPaths], {
    stdio: "ignore",
  })
  writeFileSync(archivePath, readFileSync(rebuilt))
  process.stdout.write(
    `deduped ${basename(archivePath)}: removed ${removed} duplicate member(s), kept ${kept.length}\n`,
  )
} finally {
  rmSync(tempDirectory, { recursive: true, force: true })
}

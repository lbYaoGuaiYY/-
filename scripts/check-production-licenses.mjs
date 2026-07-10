import { readFile } from "node:fs/promises"

const APPROVED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MIT-0",
  "(BSD-2-Clause OR MIT OR Apache-2.0)",
  "(MIT OR WTFPL)",
])

class InvalidLicenseReportError extends Error {
  name = "InvalidLicenseReportError"
}

class BlockedLicenseError extends Error {
  name = "BlockedLicenseError"

  constructor(licenses) {
    super(`Blocked production licenses: ${licenses.join(", ")}`)
  }
}

async function readStandardInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

function parseLicenseNames(rawReport) {
  let report
  try {
    report = JSON.parse(rawReport)
  } catch (error) {
    throw new InvalidLicenseReportError("License report is not valid JSON", { cause: error })
  }

  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    throw new InvalidLicenseReportError("License report must be an object")
  }

  const entries = Object.entries(report)
  if (entries.length === 0) throw new InvalidLicenseReportError("License report is empty")
  for (const [license, packages] of entries) {
    if (!Array.isArray(packages)) {
      throw new InvalidLicenseReportError(`License entry ${license} must contain a package list`)
    }
  }
  return entries.map(([license]) => license)
}

async function main() {
  const reportPath = process.argv[2]
  const rawReport =
    reportPath === undefined ? await readStandardInput() : await readFile(reportPath, "utf8")
  const licenses = parseLicenseNames(rawReport)
  const blocked = licenses.filter((license) => !APPROVED_LICENSES.has(license))
  if (blocked.length > 0) throw new BlockedLicenseError(blocked)
  process.stdout.write(`Approved production licenses: ${licenses.sort().join(", ")}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown license gate failure"
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})

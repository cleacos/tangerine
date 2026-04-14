// When installed from npm (not in workspace/dev mode), @tangerine/shared
// isn't resolvable because workspace:* protocol doesn't survive publishing.
// This script creates a symlink so bun can resolve the import.

const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")
const sharedPkg = path.join(root, "packages", "shared")

// Only relevant when installed as an npm package (packages/shared exists in tarball)
if (!fs.existsSync(sharedPkg)) process.exit(0)

// If already resolvable (e.g. workspace dev mode), skip
try {
  require.resolve("@tangerine/shared", { paths: [path.join(root, "packages", "server", "src")] })
  process.exit(0)
} catch {
  // Not resolvable — create the symlink
}

const nmDir = path.join(root, "node_modules", "@tangerine")
fs.mkdirSync(nmDir, { recursive: true })

const target = path.join(nmDir, "shared")
if (!fs.existsSync(target)) {
  // Use "junction" on Windows (no admin/dev-mode needed), "dir" elsewhere
  const type = process.platform === "win32" ? "junction" : "dir"
  fs.symlinkSync(sharedPkg, target, type)
}

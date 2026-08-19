// 把 src/lib/quantlib.ts 编译为本目录下的 quantlib.mjs（ESM）。
// 用法：在仓库根目录执行 `npm run mcp:build`。
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

await build({
  entryPoints: [path.join(root, 'src', 'lib', 'quantlib.ts')],
  outfile: path.join(here, 'quantlib.mjs'),
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'info',
})
console.log('quantlib.mjs 已生成 → scripts/mcp-server/quantlib.mjs')

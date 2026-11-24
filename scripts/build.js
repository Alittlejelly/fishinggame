/**
 * 构建包装脚本：node scripts/build.js [build|release] [额外参数...]
 *
 * 解决两个 Windows 问题：
 * 1. aiot-toolkit 收尾清理 Junction 时 EPERM 崩溃，导致构建成功也返回退出码 1；
 * 2. 残留的 .temp_<项目名>\node_modules Junction 会让下一次构建直接失败。
 *
 * 做法：构建前清理残留 Junction → 运行 toolkit（忽略其退出码）→ 再次清理 →
 * 以 dist 下 rpk 是否在本次运行中更新来判定成败，返回正确的退出码。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const junction = path.join(
  path.dirname(projectRoot),
  '.temp_' + path.basename(projectRoot),
  'node_modules'
)

function cleanJunction() {
  try {
    fs.lstatSync(junction)
    fs.rmdirSync(junction) // 只移除 Junction 链接本身
  } catch (e) {
    /* 不存在或被占用都无需处理 */
  }
}

function latestRpk() {
  try {
    return fs
      .readdirSync(distDir)
      .filter((f) => f.endsWith('.rpk'))
      .map((f) => ({ f, t: fs.statSync(path.join(distDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0] || null
  } catch (e) {
    return null
  }
}

const task = process.argv[2] === 'release' ? 'release' : 'build'
const extraArgs = process.argv.slice(3)
const before = latestRpk()
const startTime = Date.now()

cleanJunction()

const aiotCli = path.join(
  projectRoot,
  'node_modules',
  'aiot-toolkit',
  'lib',
  'bin.js'
)
spawnSync(process.execPath, [aiotCli, task, ...extraArgs], {
  stdio: 'inherit',
  cwd: projectRoot
})
// 忽略 toolkit 退出码：Windows 上 EPERM 收尾崩溃不代表构建失败

cleanJunction()

const after = latestRpk()
if (after && after.t >= startTime - 1000 && after.t !== (before && before.t)) {
  console.log('\n✅ 构建成功: dist/' + after.f)
  process.exit(0)
} else {
  console.log('\n❌ 构建失败: dist 中未生成新的 rpk，请查看上方日志')
  process.exit(1)
}

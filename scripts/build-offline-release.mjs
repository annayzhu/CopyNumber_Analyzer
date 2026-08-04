#!/usr/bin/env node

import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
let version;
let releaseDate;
let force = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--version") version = args[++index];
  else if (arg === "--date") releaseDate = args[++index];
  else if (arg === "--force") force = true;
  else throw new Error(`Unknown argument: ${arg}`);
}

if (!version || !/^v\d+\.\d+(?:\.\d+)?$/.test(version)) {
  throw new Error("Use --version vMAJOR.MINOR, for example: --version v1.3");
}

if (!releaseDate) {
  const now = new Date();
  releaseDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
}

if (!/^\d{8}$/.test(releaseDate)) {
  throw new Error("Use --date YYYYMMDD, for example: --date 20260804");
}

const numericVersion = version.slice(1);
const offlineHtml = await readFile(path.join(projectRoot, "cnvtool.html"), "utf8");
if (!offlineHtml.includes(`CNV分析工具 v ${numericVersion}`)) {
  throw new Error(`cnvtool.html does not declare version ${version}`);
}

const packageName = `CNVtool_${version}_offline_${releaseDate}`;
const releaseDir = path.join(projectRoot, "offline-release");
const outputPath = path.join(releaseDir, `${packageName}.zip`);

try {
  await access(outputPath);
  if (!force) throw new Error(`${outputPath} already exists; pass --force to replace it`);
  await rm(outputPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await mkdir(releaseDir, { recursive: true });
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "cnvtool-release-"));
const packageDir = path.join(temporaryRoot, packageName);

try {
  await mkdir(path.join(packageDir, "vendor"), { recursive: true });

  for (const relativePath of [
    "cnvtool.html",
    "styles.css",
    "app.js",
    "core.js",
    "vendor/xlsx.full.min.js",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await copyFile(path.join(projectRoot, relativePath), path.join(packageDir, relativePath));
  }

  const macLauncher = [
    "#!/bin/zsh",
    "set -e",
    "",
    'APP_DIR="${0:A:h}"',
    'open "$APP_DIR/cnvtool.html"',
    "",
  ].join("\n");
  await writeFile(path.join(packageDir, "Open_CNVtool_macOS.command"), macLauncher, { mode: 0o755 });

  const windowsLauncher = '@echo off\r\nstart "" "%~dp0cnvtool.html"\r\n';
  await writeFile(path.join(packageDir, "Open_CNVtool_Windows.bat"), windowsLauncher);

  const offlineReadme = `CNV分析工具 ${version}（离线版）

一、打开方法

1. 必须先完整解压压缩包，不要直接在压缩包预览窗口中运行。
2. Windows：双击 Open_CNVtool_Windows.bat，或直接双击 cnvtool.html。
3. macOS：直接双击 cnvtool.html；也可使用 Open_CNVtool_macOS.command。
4. 建议使用最新版 Chrome、Edge 或 Safari。

二、使用方法

1. 打开工具后，将 QuantStudio / Applied Biosystems 导出的 XLS、XLSX、CSV 或 TXT 文件拖入页面。
2. 按页面顺序完成 QC、NTC、分析参数、校准和实验登记。
3. 导出完整实验记录 XLSX、CSV 或分析 JSON。

三、重要说明

- 所有计算均在当前浏览器本地完成，实验数据不会上传服务器。
- “保存本次登记”保存在当前电脑的当前浏览器中；换电脑、换浏览器或清除浏览器数据后不会自动同步。
- 请保持 cnvtool.html、app.js、core.js、styles.css 和 vendor 文件夹的相对位置不变。
- 本工具仅供科研使用（RUO），不用于诊断、治疗选择或个体临床决策。
- 压缩包不包含任何样本数据或实验结果。

更完整的方法、质控规则和导出字段说明请参阅 README.md。
`;
  await writeFile(path.join(packageDir, "OFFLINE_README_zh-CN.txt"), offlineReadme);

  const zipResult = spawnSync("zip", ["-q", "-r", outputPath, packageName], {
    cwd: temporaryRoot,
    encoding: "utf8",
  });
  if (zipResult.error) throw zipResult.error;
  if (zipResult.status !== 0) {
    throw new Error(`zip failed: ${zipResult.stderr || `exit ${zipResult.status}`}`);
  }

  const outputStat = await stat(outputPath);
  console.log(`BUILT: ${outputPath} (${outputStat.size} bytes)`);
} catch (error) {
  await rm(outputPath, { force: true });
  throw error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const checkOnly = process.argv.includes("--check");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--check");

if (unknownArgs.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
}

const offlineComment =
  "<!-- 本地离线入口：请与 styles.css、app.js、core.js 和 vendor 文件夹一起使用。 -->\n";
const descriptionMeta =
  '  <meta name="description" content="基于 CopyCaller 公开原理的 qPCR CNV 分析工具">\n';
const siteMetadata = [
  '  <meta property="og:title" content="CNV分析工具 / CNV Analysis Tool">',
  '  <meta property="og:description" content="从孔级 Ct 到样本级拷贝数，支持 qPCR CNV 计算、质控、校准与实验记录导出。">',
  '  <meta property="og:type" content="website">',
  '  <meta property="og:image" content="/og.png">',
  '  <meta name="twitter:card" content="summary_large_image">',
  '  <meta name="twitter:image" content="/og.png">',
].join("\n") + "\n";

function renderSiteHtml(offlineHtml) {
  if (!offlineHtml.includes(offlineComment)) {
    throw new Error("cnvtool.html is missing the expected offline-entry comment");
  }
  if (!offlineHtml.includes(descriptionMeta)) {
    throw new Error("cnvtool.html is missing the expected description metadata");
  }

  return offlineHtml
    .replace(offlineComment, "")
    .replace(descriptionMeta, descriptionMeta + siteMetadata);
}

async function expectedOutputs() {
  const sharedAssets = [
    ["styles.css", "sites-app/public/styles.css"],
    ["app.js", "sites-app/public/app.js"],
    ["core.js", "sites-app/public/core.js"],
    ["vendor/xlsx.full.min.js", "sites-app/public/vendor/xlsx.full.min.js"],
  ];
  const outputs = [];

  for (const [source, target] of sharedAssets) {
    outputs.push({ target, content: await readFile(path.join(projectRoot, source)) });
  }

  const offlineHtml = await readFile(path.join(projectRoot, "cnvtool.html"), "utf8");
  outputs.push({
    target: "sites-app/public/index.html",
    content: Buffer.from(renderSiteHtml(offlineHtml)),
  });

  return outputs;
}

let mismatchCount = 0;

for (const { target, content } of await expectedOutputs()) {
  const targetPath = path.join(projectRoot, target);

  if (checkOnly) {
    let current;
    try {
      current = await readFile(targetPath);
    } catch {
      current = null;
    }

    if (current === null || !current.equals(content)) {
      console.error(`OUT OF SYNC: ${target}`);
      mismatchCount += 1;
    }
  } else {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    console.log(`SYNCED: ${target}`);
  }
}

if (checkOnly) {
  if (mismatchCount > 0) {
    console.error(`Release synchronization check failed: ${mismatchCount} file(s) differ.`);
    process.exitCode = 1;
  } else {
    console.log("Release synchronization check passed.");
  }
}

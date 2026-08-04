# CNV分析工具 · Sites 发布工程

这个目录用于将本地 CNV 分析器发布到 OpenAI Sites。实际分析界面位于 `public/`，包含的文件与发布时通过测试的本地版本一致。

`public/index.html`、`public/styles.css`、`public/app.js`、`public/core.js` 和 `public/vendor/xlsx.full.min.js` 是由项目根目录主源码生成的发布副本，不应在这里单独修改。更新根目录源码后，请在项目根目录运行：

```bash
node scripts/sync-release-assets.mjs
```

## 隐私与运行边界

- Excel/CSV 数据在用户浏览器内解析，分析器不上传实验文件。
- 所有计算、质控、NTC 补标和导出均由前端 JavaScript 完成。
- 工具仅供科研使用（RUO），不用于临床诊断或治疗决策。

## 验证

```bash
npm run build
node --test tests/rendered-html.test.mjs
```

核心计算的测试仍保留在上级目录的 `tests/` 中。

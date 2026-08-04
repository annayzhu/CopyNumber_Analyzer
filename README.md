# CNV分析工具 v 1.3

这是一个基于 CopyCaller 公开计算原理的浏览器端 qPCR CNV 分析器。它直接读取 QuantStudio / Applied Biosystems 导出的 `.xls`、`.xlsx`、`.csv` 或 `.txt`，在本地浏览器中完成孔级质控、ΔCt/ΔΔCt、连续拷贝数、离散判定、质量指标、图形和审计导出。

> 仅供科研使用（RUO），不用于诊断、治疗选择或个体临床决策。

## 最快使用方法

1. macOS 双击 `打开CNV分析器.command`，或用 Chrome / Edge / Safari 打开 `cnvtool.html`。
2. 拖入原始仪器导出文件。不要在 Excel 中重排、删列或修改 Ct 后再导入。
3. 先看“运行与数据质控”。`HOLD`表示可查看数据，但不应放行研究结果。
4. 检查 NTC：若实验中真实设置了 NTC、但 plate setup 漏标，可按样本名或物理孔补标；必须填写依据并确认。
5. 确认内参 assay、内参 Ct 阈值、0-copy ΔCt 阈值、最少复孔数及 duplex/triplex 是否分开。
6. 按 target / panel 独立配置校准。仪器文件中的 `Reference Sample` 不会自动继承。
7. 在“实验登记信息”中补录 Plate ID、操作人、反应体积和试剂批号；仪器信息、分析结论和校准状态会自动填写。
8. 确认质控和校准后，导出一个同时包含实验登记、Sample CN、QC、原始 Ct 和审计信息的 XLSX 工作簿。

所有数据仅在当前浏览器页面中处理，不会上传到服务器。整个应用可以直接部署到任何静态站点。

## 核心防错逻辑

- **Reference assay ≠ Reference sample**：RNase P 等内参 assay 用于孔内归一化；已知 CN 的 calibrator 用于板内相对定量。
- **不继承仪器中的 Reference Sample**：只显示原运行设置，每个 target / panel 重新审查。
- **校准品资格硬限制**：内参必须有效，target 必须稳定非零扩增，有效复孔数必须足够，ΔCt SD 不能超过校准品限值。
- **已知 CN 需人工签认**：未勾选“已由独立依据确认”时，程序不计算连续 CN。
- **内参失败优先**：内参无效的样本是 `Invalid`，不会因 target 也是 Undetermined 而被误判为 0 copy。
- **0-copy 独立路径**：全部可分析复孔内参有效、target 均为 Undetermined/仅背景、复孔数达标且同 assay/panel 阳性校准有效时，输出正式 `CN=0`；缺少阳性校准或证据复孔不足时保留 `0-copy 候选`，部分复孔扩增、部分不扩增时输出 `No call`。
- **不静默删数据**：源 flags、自动离群、手工 Omit 与排除理由都保留到孔级审计表。
- **反应组合防混合**：同一 target 在 duplex 与 triplex 中默认分开；只有桥接验证通过后才建议合并。
- **物理孔与 assay 行分层**：不把 multiplex 导出行数当作孔数。同一孔的多个 target 在内部共享孔位和样本，但保留独立测量。
- **人工 NTC 双重确认**：补标 NTC 时必须选择现有样本或物理孔、填写实验依据并确认“实际未加入模板”；原样本名不会被覆盖。
- **NTC 不参与 CN 计算**：已确认 NTC 从样本数、样本结果、校准候选和群体模型中排除，但完整保留在孔级审计中。
- **NTC 扩增硬拦截**：NTC 的 target 或内参任一通道出现数值 Ct 都会产生 blocker，提示污染、非特异扩增或误标风险。
- **NTC 覆盖检查**：未识别 NTC，或某个 duplex/triplex 反应组合没有对应 NTC 时，记为 warning，不再单独触发 `HOLD`；但必须人工记录无法排除污染的局限。
- **不能补造实验对照**：如果实验中没有实际设置 NTC，软件不能事后把普通孔解释成 NTC。

## 批量板的校准品失败策略

- `Reference assay`（例如 RNase P）是每个样本孔内归一化的内参；若它在某样本失败，该样本为 `Invalid`，不能通过更换校准品挽救。
- `Reference Sample / calibrator` 是已知 CN 的板内校准样本。批量板应为每个 target / panel 预设主校准品和至少 1 个已独立确认 CN 的备用校准品，并尽量在各板使用同一批次桥接 DNA。
- 主校准品本板不合格时，改选本板通过资格检查的备用校准品，或使用至少 2 个同 CN 已知样本构成校准组，并记录替换原因。
- 所有已知校准品都失败时，不会从普通样本中自动挑选替代品。只有在非零样本数足够且“预期众数 CN”有先验依据时，才可人工切换到群体模式；否则该 assay / 板保持 `HOLD / No call`。

## 一体化实验工作簿

XLSX 只生成一个文件，共 11 张工作表；首页用于直接登记 Sample CN，其余表用于实验记录、质控与追溯：

- `样本CN汇总`：首页一行一个 Sample，各 target / panel 的离散 CN、连续 CN 和结果状态横向排列，便于直接作为实验结果登记；正式零拷贝写为 `CN=0`，但连续 CN、confidence 和 z-score 留空；条件不足时仍显示 `0-copy 候选`。
- `运行登记`：整合 Run/Plate/Analysis ID、日期、人员、仪器、反应体积、Assay/Master Mix 批次、校准、NTC、自动结论和人工复核。
- `批次质控`：整批结论、NTC、各 assay 校准状态以及板级 blocker/warning/info。
- `CN计算明细`：保留一行一个 Sample-target-panel 的离散 CN、连续 CN、区间、校准和质量指标，供追溯首页汇总。
- `复孔质控`：Target/Reference Ct 列表、mean、SD、CV、最大 Ct 差、ΔCt 和 SD(ΔCt)。Ct CV 仅作离散度描述。
- `原始Ct`：逐条保留仪器导入记录，包括内参行、源 Ct/ΔCt/ΔΔCt/RQ、threshold、baseline、Cq confidence、flags 和 Omit。
- `NTC审计`：NTC 来源、人工指定依据、各通道 Ct 与扩增结论；无 NTC 时仍固定保留表头。
- `校准记录`：每个 target/panel 的模式、所选样本/组、已知 CN、确认依据、替换原因、K、错误和警告。
- `分析参数`、`仪器元数据`、`方法说明`：保留复算所需的阈值、来源和方法边界。

每个主要明细表都带有稳定的 `Run ID`、`Plate ID` 和 `Analysis ID`，便于未来汇总 96/384 孔及多板实验。“保存本次登记”会优先按原始文件内容的 SHA-256 摘要，将本次登记、NTC、分析参数及校准设置保存在当前浏览器；重新导入同一内容时自动恢复，不上传服务器。浏览器不支持内容摘要时才退回文件名、大小和修改时间。常用操作人、反应体积、品牌、货号和 Assay ID 可作为本机预设，但批号与有效期不跨板复用。自动质控为 `HOLD`、登记/校准依据不完整，或缺少复核人和复核日期时，软件不会允许选择“同意放行”；放行后若再改变参数、NTC、校准或登记信息，原签认会自动撤销并要求重新复核。

## 96 / 384 孔扩展

解析器不限定导入行数；它按 `Well Position + Sample Name + Target Name` 构建孔级测量。

- 96-well：A–H、1–12，`well = (row-1)×12 + column`
- 384-well：A–P、1–24，`well = (row-1)×24 + column`

程序会审查 `Well` 数字与 `Well Position` 是否一致，并在孔板图中显示任意部分使用的板。

## 运行与依赖

运行时无需安装 Python、R 或服务器。工程内置 SheetJS Community Edition 0.20.3，用于浏览器中读写 XLS/XLSX/CSV/TXT。

单元和模板集成测试：

```bash
node --test tests/*.test.js
```

测试覆盖：ΔΔCt 主公式、0-copy 校准品拦截、内参失败不误判、duplex/triplex 分层、自动/人工 NTC、未确认 NTC 拦截、NTC 扩增、校准冲突、一体化工作簿字段顺序与原始 Ct 完整性、样本数不足时不伪造 Confidence/|Z|、QuantStudio 重名 Cq Conf 列解析、384 孔边界，以及用户提供的真实 `.xls` 回放。

## 单一源码与发布

根目录中的 `cnvtool.html`、`styles.css`、`app.js`、`core.js` 和 `vendor/xlsx.full.min.js` 是唯一可信源码。不要直接修改 `sites-app/public` 中的同名发布副本。

修改主源码后，同步网页版发布文件：

```bash
node scripts/sync-release-assets.mjs
```

只检查是否同步，不修改文件：

```bash
node scripts/sync-release-assets.mjs --check
```

生成独立离线发行包：

```bash
node scripts/build-offline-release.mjs --version v1.3
```

离线 ZIP 输出到 `offline-release/`；其中包含运行所需的全部 HTML、JavaScript、CSS、SheetJS、本地说明以及 Windows/macOS 启动文件，不依赖 `sites-app`。ZIP 是生成产物，不提交进 Git，正式对外版本建议作为 GitHub Release 附件发布。

推荐发布顺序：修改根目录主源码 → 运行根目录测试 → 同步网页版 → 运行 `sites-app` 测试 → 生成离线 ZIP → 检查 ZIP 内容 → 发布。

## 方法文档

- [CopyCaller 计算原理与实现边界](docs/CopyCaller_计算原理与实现边界.md)
- [当前 32 孔模板回放与防错报告](docs/当前模板回放与防错报告.md)

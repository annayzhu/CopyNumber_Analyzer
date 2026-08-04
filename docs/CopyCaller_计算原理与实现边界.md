# CopyCaller 计算原理与实现边界

## 1. 证据层级

本文区分三类内容：

1. **文档明示**：用户提供的 `4-Copy Number Variation and Copy Caller.pdf`、`copycaller快速使用指南.pdf`，以及 CopyCaller Software v2.0 User Guide, PN 4400042 Rev. C。
2. **可直接数学推导**：由已公开公式得到的类别中心与相邻类别间距。
3. **本工具的透明近似**：官方手册描述了模型，但未给出足以保证软件逐位复刻的所有 bootstrap、初始值和数值优化细节；因此程序明确标注为 CopyCaller-like，不宣称与原软件逐值完全一致。

## 2. 孔级归一化

对每个有效反应孔：

\[
\Delta Ct_{well}=Ct_{target}-Ct_{reference}
\]

同一样本、同一 target/reference 组合的有效复孔取算术平均：

\[
\mu(\Delta Ct)_{sample}=\frac{1}{n}\sum_{j=1}^{n}\Delta Ct_j
\]

这一层利用内参对起始 DNA 量与移液误差进行孔内归一化。公式见用户提供的 50 页讲义 PDF p.29（幻灯片页脚 33）；官方 v2.0 User Guide pp.61–62 进一步给出孔级与样本级公式。

## 3. 已知校准样本模式

对每个 target 独立选择目标拷贝数已知的 calibrator：

\[
\Delta\Delta Ct_{sample}=\mu(\Delta Ct)_{sample}-\mu(\Delta Ct)_{calibrator}
\]

\[
RQ=2^{-\Delta\Delta Ct}
\]

\[
CN_{calculated}=CN_{calibrator}\times 2^{-\Delta\Delta Ct}
\]

只有在 calibrator 已知为 2 copies 时，才可以写为 `2 × 2^(-ΔΔCt)`。CopyCaller v2.0 User Guide p.62 说明已知校准样本模式将连续值四舍五入到最近整数作为离散调用。

## 4. 0-copy 必须单独处理

对数模型的定义域是 `copy number >= 1`，因此 0-copy 不能靠对 Ct 人工填 40 来计算。官方 v2.0 User Guide p.61 给出默认规则：

- 内参 VIC Ct <= 32，且同一样本全部 target/FAM Ct 为 Undetermined：按 0 copy 处理。
- 内参有效，但 target 相对内参极弱，ΔCt > 4.0：按 0 copy 处理，弱 target 信号被视为非特异背景。
- 内参 Ct 超阈值或 Undetermined：该孔失败；如所有复孔都失败，样本为 Invalid，不是 0 copy。
- 一半复孔是 0-copy 证据、一半为非零扩增：标记 UNDET / No call。

32 和 4.0 是可调的经验阈值，正式方法应使用已知 0/1/2-copy 对照验证。本工具在有效零证据复孔数达到最低要求、且同 assay/panel 的阳性校准有效时输出正式 `CN=0`；证据不足时保留 `0-copy 候选`。零拷贝不通过 ΔΔCt 连续模型计算，因此连续 CN、confidence 和 z-score 保持为空。

## 5. 无已知 calibrator 的群体模型

官方统计模型是：

\[
\Delta Ct=K-\log_{1+E}(cn),\qquad cn\ge 1
\]

其中 `K` 是 copy number 1 的理论中心，`E` 是 PCR efficiency。每个整数 CN 对应一个正态子分布，不同 CN 共用方差，但在样本群体中可具有不同先验概率。

无 calibrator 时：

- CopyCaller 假设 E=100%。
- 用最大似然估计 K。
- 用户输入“大多数样本预期拥有的 CN”，用于锁定群体分布与整数 CN 的映射。
- 通过样本对各 CN 子分布的近似概率迭代更新 CN 先验与共同标准差。

本工具使用显式 K 网格搜索、高斯混合似然、共同标准差和小伪计数先验，并强制预期众数 CN 与拟合众数一致。这是可审计的透明近似，而非对官方数值优化器的逐位复刻。

## 6. 理论类别中心与高 CN 限制

当 E=1 时：

\[
\mu_{cn}=K-\log_2(cn)
\]

相邻拷贝数的中心间距为：

\[
|\mu_{k+1}-\mu_k|=\log_2\left(\frac{k+1}{k}\right)
\]

所以 1 vs 2 相差 1 Ct，2 vs 3 相差约 0.585 Ct，3 vs 4 约 0.415 Ct，4 vs 5 约 0.322 Ct。高 CN 时整数类别必然更难分离；不应在置信度低时强制报告精确高 CN。

## 7. 离群孔

官方 v2.0 User Guide pp.61–62 描述：

1. 估计板级 ΔCt 标准差。
2. 排除距离本复孔组均值超过 4 个板级标准差的孔。
3. 估计板级标准差时，先排除距离复孔中位数大于 1-copy 与 2-copy 理论分布距离的点，效率保守取 E=0.8。

本工具的保守实现对复孔中位数使用 `max(4×plate SD, 0.30 Ct)` 的自动阈值，避免在极小样本下因 SD 过小而过度删孔。被排除孔仍保留在孔级审计表。

## 8. Confidence 和 |Z-score|

CopyCaller 将 confidence 定义为“在所有具有非零概率的候选 CN 中，已分配 CN 为真的概率”。模型使用样本ΔCt、CN 先验、K、E 与共同标准差。官方软件还用 bootstrap 计算 confidence 的 5% 下限，因此同一数据的报告值可有轻微波动。

\[
|z|=\left|\frac{\mu(\Delta Ct)_{sample}-\mu_{assigned\ CN}}{\sigma}\right|
\]

快速指南的判读顺序：

- Confidence < 0.95：复核。
- Confidence >= 0.95 后再看 |Z|。
- |Z| < 1.75：Pass。
- 1.75 <= |Z| < 2.65：Pass with caution。
- |Z| >= 2.65：Fail。

质量指标至少需要 7 个相同拷贝数的样本。本工具在未满足时输出 NA，不用人工方差或伪随机数补值。在满足数据量时，输出的是不含官方 bootstrap 下限的 `Confidence-like`，而不伪装成 CopyCaller 原值。

## 9. 仪器与实验前提

- 文档推荐每样本 4 个技术复孔。
- CopyCaller 文档示例中的手动 Ct threshold = 0.2 不是本工具的强制要求。经实验室技术确认，本工具接受仪器自动 Ct threshold，不因自动状态或阈值偏离 0.2 产生 QC 提示；仅在同一 assay 的实际阈值互相不一致时提醒复核。
- 应包含 NTC 与目标 CN 已知的阳性对照 / calibrator。
- 人样本官方 duplex 流程推荐 RNase P 为内参，TERT 为备选。
- 同一分析中的 gDNA 尽可能来自同类样本、用同一方法提取，并使用一致 DNA 量。
- 官方 CopyCaller 流程是一个 FAM target + 一个 VIC reference 的 duplex。三色 triplex 应先完成与标准 duplex 的桥接验证，否则不应把不同 panel 的重复孔默认合并。

## 10. 参考文档

- Applied Biosystems, *CopyCaller Software v2.0 User Guide*, PN 4400042 Rev. C, November 2011.
- Applied Biosystems, *TaqMan Copy Number Assays User Guide*, Pub. No. 4397425 Rev. F.
- `4-Copy Number Variation and Copy Caller.pdf`，用户提供，50 页。
- `copycaller快速使用指南.pdf`，用户提供，7 页。

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CopyNumberCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "1.3";

  var DEFAULTS = Object.freeze({
    referenceCtMax: 32,
    zeroCopyDeltaCt: 4,
    minReplicates: 2,
    recommendedReplicates: 4,
    replicateSdWarn: 0.15,
    calibratorMaxSd: 0.15,
    maxCopyNumber: 8,
    splitPanels: true,
    autoOutlier: true,
    confidenceThreshold: 0.95,
    zPass: 1.75,
    zFail: 2.65,
    minimumConfidenceGroupSize: 7,
    minimumPopulationSamples: 5,
    ntcAssignment: Object.freeze({
      mode: "auto",
      sampleNames: Object.freeze([]),
      wellPositions: Object.freeze([]),
      confirmed: false,
      note: "",
      appliedAt: ""
    })
  });

  var HEADER_ALIASES = {
    wellNumber: ["well", "wellnumber", "wellno", "wellid"],
    wellPosition: ["wellposition", "wellpos", "position", "wellcoordinate"],
    omit: ["omit", "excluded", "exclude"],
    sampleName: ["samplename", "sample", "sampleid"],
    targetName: ["targetname", "target", "assayname", "detector"],
    task: ["task", "sampletype"],
    reporter: ["reporter", "dye"],
    quencher: ["quencher"],
    quantity: ["quantity"],
    quantityMean: ["quantitymean"],
    quantitySd: ["quantitysd"],
    rq: ["rq"],
    rqMin: ["rqmin"],
    rqMax: ["rqmax"],
    ct: ["ct", "cq", "ctvalue", "cqvalue"],
    ctMean: ["ctmean", "cqmean"],
    ctSd: ["ctsd", "cqsd"],
    deltaCt: ["deltact", "δct", "dct"],
    deltaCtMean: ["deltactmean", "δctmean", "dctmean"],
    deltaCtSd: ["deltactsd", "δctsd", "dctsd"],
    deltaCtSe: ["deltactse", "δctse", "dctse"],
    deltaDeltaCt: ["deltadeltact", "δδct", "ddct"],
    automaticCtThreshold: ["automaticctthreshold", "autoctthreshold"],
    ctThreshold: ["ctthreshold", "threshold"],
    automaticBaseline: ["automaticbaseline", "autobaseline"],
    baselineStart: ["baselinestart"],
    baselineEnd: ["baselineend"],
    ampStatus: ["ampstatus", "amplificationstatus"],
    comments: ["comments", "comment"],
    cqConfidence: ["cqconf", "cqconfidence", "ctconfidence"],
    tholdFail: ["tholdfail"],
    cqConfFlag: ["cqconfflag", "cqconf"],
    noAmp: ["noamp"],
    expFail: ["expfail"]
  };

  var ALIAS_TO_FIELD = (function () {
    var out = {};
    Object.keys(HEADER_ALIASES).forEach(function (field) {
      HEADER_ALIASES[field].forEach(function (alias) { out[alias] = field; });
    });
    return out;
  })();

  function mergeSettings(settings) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (key) { out[key] = DEFAULTS[key]; });
    Object.keys(settings || {}).forEach(function (key) {
      if (settings[key] !== undefined) out[key] = settings[key];
    });
    out.calibrations = settings && settings.calibrations ? settings.calibrations : {};
    var ntc = settings && settings.ntcAssignment ? settings.ntcAssignment : DEFAULTS.ntcAssignment;
    out.ntcAssignment = {
      mode: ntc.mode || "auto",
      sampleNames: Array.isArray(ntc.sampleNames) ? ntc.sampleNames.slice() : [],
      wellPositions: Array.isArray(ntc.wellPositions) ? ntc.wellPositions.slice() : (Array.isArray(ntc.wells) ? ntc.wells.slice() : []),
      confirmed: ntc.confirmed === true,
      note: normalizeText(ntc.note),
      appliedAt: normalizeText(ntc.appliedAt)
    };
    return out;
  }

  function normalizeText(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function normalizeKey(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[δΔ]/g, "delta")
      .replace(/[мт]/g, function (x) { return x === "т" ? "t" : "c"; })
      .replace(/[^a-z0-9]+/g, "");
  }

  function normalizeName(value) {
    return normalizeText(value).replace(/\s+/g, " ");
  }

  function toNumber(value) {
    if (typeof value === "number" && isFinite(value)) return value;
    var text = normalizeText(value);
    if (!text || /^(undetermined|undet|na|n\/a|null|none|-)$/i.test(text)) return null;
    var n = Number(text.replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  function toBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    var text = normalizeText(value).toLowerCase().replace(/^=/, "").replace(/\(\)$/, "");
    return ["true", "yes", "y", "1", "是"].indexOf(text) >= 0;
  }

  function mean(values) {
    var valid = values.filter(function (v) { return typeof v === "number" && isFinite(v); });
    if (!valid.length) return null;
    return valid.reduce(function (a, b) { return a + b; }, 0) / valid.length;
  }

  function median(values) {
    var valid = values.filter(function (v) { return typeof v === "number" && isFinite(v); }).slice().sort(function (a, b) { return a - b; });
    if (!valid.length) return null;
    var mid = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  }

  function sampleSd(values) {
    var valid = values.filter(function (v) { return typeof v === "number" && isFinite(v); });
    if (valid.length < 2) return null;
    var m = mean(valid);
    var ss = valid.reduce(function (sum, v) { return sum + Math.pow(v - m, 2); }, 0);
    return Math.sqrt(ss / (valid.length - 1));
  }

  function round(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return null;
    var p = Math.pow(10, digits === undefined ? 4 : digits);
    return Math.round(value * p) / p;
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      var key = String(value);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function headerField(value) {
    var raw = normalizeText(value);
    // QuantStudio exports both "Cq Conf" (numeric metric) and "CQCONF"
    // (Y/N flag). They collapse to the same normalized token, so preserve
    // the visible spelling before applying the generic alias table.
    if (raw === "Cq Conf" || raw === "Cq Confidence") return "cqConfidence";
    if (raw === "CQCONF") return "cqConfFlag";
    return ALIAS_TO_FIELD[normalizeKey(raw)];
  }

  function detectHeaderRow(aoa) {
    var best = null;
    (aoa || []).forEach(function (row, rowIndex) {
      var mapped = {};
      (row || []).forEach(function (cell, columnIndex) {
        var field = headerField(cell);
        if (field && mapped[field] === undefined) mapped[field] = columnIndex;
      });
      var required = ["sampleName", "targetName", "ct"].filter(function (key) { return mapped[key] !== undefined; }).length;
      var wellFound = mapped.wellPosition !== undefined || mapped.wellNumber !== undefined;
      var score = Object.keys(mapped).length + (required === 3 && wellFound ? 20 : 0);
      if (!best || score > best.score) best = { rowIndex: rowIndex, columns: mapped, score: score };
    });
    if (!best || best.score < 24) {
      throw new Error("无法识别结果表头：至少需要 Well/Well Position、Sample Name、Target Name 和 CT 列。");
    }
    return best;
  }

  function extractMetadata(aoa, headerRowIndex, dataRowIndexes) {
    var used = {};
    (dataRowIndexes || []).forEach(function (i) { used[i] = true; });
    used[headerRowIndex] = true;
    var metadata = {};
    (aoa || []).forEach(function (row, rowIndex) {
      if (used[rowIndex] || !row) return;
      var key = normalizeText(row[0]);
      var value = row.length > 1 ? row[1] : null;
      if (key && value !== null && value !== undefined && normalizeText(value) !== "") metadata[key] = value;
    });
    return metadata;
  }

  function valueAt(row, columns, field) {
    return columns[field] === undefined ? null : row[columns[field]];
  }

  function normalizeRecord(row, columns, sourceRow) {
    var ctRaw = valueAt(row, columns, "ct");
    var record = {
      sourceRow: sourceRow,
      wellNumber: toNumber(valueAt(row, columns, "wellNumber")),
      wellPosition: normalizeName(valueAt(row, columns, "wellPosition")).toUpperCase(),
      omit: toBoolean(valueAt(row, columns, "omit")),
      sampleName: normalizeName(valueAt(row, columns, "sampleName")),
      targetName: normalizeName(valueAt(row, columns, "targetName")),
      task: normalizeName(valueAt(row, columns, "task")),
      reporter: normalizeName(valueAt(row, columns, "reporter")).toUpperCase(),
      quencher: normalizeName(valueAt(row, columns, "quencher")),
      quantity: toNumber(valueAt(row, columns, "quantity")),
      quantityMean: toNumber(valueAt(row, columns, "quantityMean")),
      quantitySd: toNumber(valueAt(row, columns, "quantitySd")),
      rqSource: toNumber(valueAt(row, columns, "rq")),
      rqMinSource: toNumber(valueAt(row, columns, "rqMin")),
      rqMaxSource: toNumber(valueAt(row, columns, "rqMax")),
      ctRaw: ctRaw,
      ct: toNumber(ctRaw),
      ctMeanSource: toNumber(valueAt(row, columns, "ctMean")),
      ctSdSource: toNumber(valueAt(row, columns, "ctSd")),
      deltaCtSource: toNumber(valueAt(row, columns, "deltaCt")),
      deltaCtMeanSource: toNumber(valueAt(row, columns, "deltaCtMean")),
      deltaCtSdSource: toNumber(valueAt(row, columns, "deltaCtSd")),
      deltaCtSeSource: toNumber(valueAt(row, columns, "deltaCtSe")),
      deltaDeltaCtSource: toNumber(valueAt(row, columns, "deltaDeltaCt")),
      automaticCtThreshold: toBoolean(valueAt(row, columns, "automaticCtThreshold")),
      ctThreshold: toNumber(valueAt(row, columns, "ctThreshold")),
      automaticBaseline: toBoolean(valueAt(row, columns, "automaticBaseline")),
      baselineStart: toNumber(valueAt(row, columns, "baselineStart")),
      baselineEnd: toNumber(valueAt(row, columns, "baselineEnd")),
      ampStatus: normalizeName(valueAt(row, columns, "ampStatus")),
      comments: normalizeName(valueAt(row, columns, "comments")),
      cqConfidence: toNumber(valueAt(row, columns, "cqConfidence")),
      flags: {
        THOLDFAIL: toBoolean(valueAt(row, columns, "tholdFail")),
        CQCONF: toBoolean(valueAt(row, columns, "cqConfFlag")),
        NOAMP: toBoolean(valueAt(row, columns, "noAmp")),
        EXPFAIL: toBoolean(valueAt(row, columns, "expFail"))
      }
    };
    if (!record.wellPosition && record.wellNumber !== null) record.wellPosition = String(record.wellNumber);
    return record;
  }

  function parseAoA(aoa) {
    var header = detectHeaderRow(aoa);
    var records = [];
    var dataRows = [];
    for (var i = header.rowIndex + 1; i < aoa.length; i += 1) {
      var row = aoa[i] || [];
      var sample = normalizeText(valueAt(row, header.columns, "sampleName"));
      var target = normalizeText(valueAt(row, header.columns, "targetName"));
      var well = valueAt(row, header.columns, "wellPosition");
      if (well === null || well === undefined || normalizeText(well) === "") well = valueAt(row, header.columns, "wellNumber");
      if (!sample && !target && (well === null || well === undefined || normalizeText(well) === "")) continue;
      if (!sample || !target) continue;
      records.push(normalizeRecord(row, header.columns, i + 1));
      dataRows.push(i);
    }
    if (!records.length) throw new Error("识别到了表头，但没有找到可分析的测量行。");
    return {
      metadata: extractMetadata(aoa, header.rowIndex, dataRows),
      records: records,
      headerRow: header.rowIndex + 1,
      sourceColumns: header.columns
    };
  }

  function getMetadata(metadata, wantedKey) {
    var wanted = normalizeKey(wantedKey);
    var keys = Object.keys(metadata || {});
    for (var i = 0; i < keys.length; i += 1) {
      if (normalizeKey(keys[i]) === wanted) return metadata[keys[i]];
    }
    return null;
  }

  function parseWellPosition(position) {
    var match = /^([A-Z]+)(\d+)$/i.exec(normalizeText(position));
    if (!match) return null;
    var letters = match[1].toUpperCase();
    var row = 0;
    for (var i = 0; i < letters.length; i += 1) row = row * 26 + letters.charCodeAt(i) - 64;
    return { row: row, column: Number(match[2]), label: letters + Number(match[2]) };
  }

  function inferPlateFormat(records, metadata) {
    var block = normalizeText(getMetadata(metadata, "Block Type"));
    if (/384/.test(block)) return 384;
    if (/96/.test(block)) return 96;
    var maxRow = 0;
    var maxColumn = 0;
    (records || []).forEach(function (record) {
      var pos = parseWellPosition(record.wellPosition);
      if (pos) {
        maxRow = Math.max(maxRow, pos.row);
        maxColumn = Math.max(maxColumn, pos.column);
      }
    });
    return maxRow > 8 || maxColumn > 12 ? 384 : 96;
  }

  function automaticNtcSources(record) {
    var sources = [];
    if (/(^|[\s_-])ntc($|[\s_-])|no[\s_-]*template/i.test(normalizeText(record.sampleName))) sources.push("AUTO_SAMPLE_NAME");
    if (/(^|[\s_-])ntc($|[\s_-])|no[\s_-]*template/i.test(normalizeText(record.task))) sources.push("AUTO_TASK");
    return sources;
  }

  function isNtc(record) {
    return record.sampleRole === "NTC" || automaticNtcSources(record).length > 0;
  }

  function resolveNtcRoles(records, settings) {
    var assignment = settings.ntcAssignment || DEFAULTS.ntcAssignment;
    var mode = assignment.mode || "auto";
    var useSamples = mode === "manual_sample" || mode === "manual_both";
    var useWells = mode === "manual_wells" || mode === "manual_both";
    var requestedSamples = useSamples ? unique((assignment.sampleNames || []).map(normalizeName).filter(Boolean)) : [];
    var requestedWells = useWells ? unique((assignment.wellPositions || []).map(function (well) { return normalizeText(well).toUpperCase(); }).filter(Boolean)) : [];
    var requested = requestedSamples.length + requestedWells.length > 0;
    var confirmed = assignment.confirmed === true;
    var issues = [];
    var presentSamples = {};
    var presentWells = {};

    records.forEach(function (record) {
      presentSamples[normalizeName(record.sampleName)] = record.sampleName;
      presentWells[normalizeText(record.wellPosition || record.wellNumber).toUpperCase()] = true;
    });

    if (requested && !confirmed) {
      issues.push({ severity: "blocker", code: "NTC_ASSIGNMENT_UNCONFIRMED", message: "已选择人工 NTC，但尚未确认这些孔在实验中确实未加入模板；本次选择未生效。" });
    }
    if (requested && confirmed && !normalizeText(assignment.note)) {
      issues.push({ severity: "blocker", code: "NTC_ASSIGNMENT_NOTE_MISSING", message: "人工 NTC 缺少可追溯说明；请填写加样记录或实验依据。" });
    }

    var missingSamples = requestedSamples.filter(function (name) { return !presentSamples[name]; });
    var missingWells = requestedWells.filter(function (well) { return !presentWells[well]; });
    if (confirmed && (missingSamples.length || missingWells.length)) {
      issues.push({
        severity: "blocker",
        code: "NTC_SELECTOR_NOT_FOUND",
        message: "人工 NTC 中存在导入文件未找到的选择：" + [missingSamples.length ? "样本 " + missingSamples.join("/") : "", missingWells.length ? "孔位 " + missingWells.join("/") : ""].filter(Boolean).join("；") + "。"
      });
    }

    var sampleSelector = {};
    requestedSamples.forEach(function (name) { sampleSelector[name] = true; });
    var wellSelector = {};
    requestedWells.forEach(function (well) { wellSelector[well] = true; });
    var roleSourcesByWell = {};
    records.forEach(function (record) {
      var well = normalizeText(record.wellPosition || record.wellNumber).toUpperCase();
      if (!roleSourcesByWell[well]) roleSourcesByWell[well] = [];
      roleSourcesByWell[well] = roleSourcesByWell[well].concat(automaticNtcSources(record));
      if (confirmed && sampleSelector[normalizeName(record.sampleName)]) roleSourcesByWell[well].push("MANUAL_SAMPLE");
      if (confirmed && wellSelector[well]) roleSourcesByWell[well].push("MANUAL_WELL");
    });
    records.forEach(function (record) {
      var well = normalizeText(record.wellPosition || record.wellNumber).toUpperCase();
      var sources = unique(roleSourcesByWell[well] || []);
      record.sampleRole = sources.length ? "NTC" : "SAMPLE";
      record.roleSource = sources.join("+");
      record.ntcAssignmentMode = sources.some(function (source) { return /^MANUAL_/.test(source); }) ? mode : (sources.length ? "source_file" : "");
      record.ntcAssignmentNote = sources.some(function (source) { return /^MANUAL_/.test(source); }) ? normalizeText(assignment.note) : "";
    });

    var manualRows = records.filter(function (record) { return /MANUAL_/.test(record.roleSource); });
    if (manualRows.length) {
      var manualWells = unique(manualRows.map(function (record) { return record.wellPosition || String(record.wellNumber); }));
      issues.push({
        severity: "info",
        code: "MANUAL_NTC_ASSIGNMENT",
        message: "已人工确认 " + manualWells.length + " 个物理孔为 NTC（" + manualWells.join("、") + "）；原样本名保留，这些孔不参与 CN 计算或校准。"
      });
    }

    if (confirmed && useWells && requestedWells.length) {
      var manuallySelectedSamples = {};
      records.forEach(function (record) {
        var well = normalizeText(record.wellPosition || record.wellNumber).toUpperCase();
        if (wellSelector[well]) manuallySelectedSamples[record.sampleName] = true;
      });
      Object.keys(manuallySelectedSamples).forEach(function (sampleName) {
        var all = unique(records.filter(function (record) { return record.sampleName === sampleName; }).map(function (record) { return normalizeText(record.wellPosition || record.wellNumber).toUpperCase(); }));
        var selected = all.filter(function (well) { return wellSelector[well]; });
        if (selected.length && selected.length < all.length) {
          issues.push({ severity: "warning", code: "PARTIAL_SAMPLE_AS_NTC", message: "样本名“" + sampleName + "”仅有 " + selected.length + "/" + all.length + " 个物理孔被指定为 NTC；同名其他孔仍作为分析样本。" });
        }
      });
    }

    var byWell = {};
    records.forEach(function (record) {
      var well = record.wellPosition || String(record.wellNumber);
      if (!byWell[well]) byWell[well] = [];
      byWell[well].push(record);
    });
    Object.keys(byWell).forEach(function (well) {
      var names = unique(byWell[well].map(function (record) { return record.sampleName; }));
      var hasManual = byWell[well].some(function (record) { return /MANUAL_/.test(record.roleSource); });
      if (hasManual && names.length > 1) issues.push({ severity: "blocker", code: "NTC_WELL_SAMPLE_CONFLICT", message: well + " 孔存在多个样本名，人工 NTC 不能用于掩盖孔位冲突。" });
    });

    var ntcSampleLookup = {};
    records.filter(isNtc).forEach(function (record) { ntcSampleLookup[normalizeName(record.sampleName)] = true; });
    var calibrationNames = [];
    Object.keys(settings.calibrations || {}).forEach(function (key) {
      var config = settings.calibrations[key] || {};
      if (config.sampleName) calibrationNames.push(config.sampleName);
      if (Array.isArray(config.sampleNames)) calibrationNames = calibrationNames.concat(config.sampleNames);
    });
    var calibrationConflict = unique(calibrationNames).filter(function (name) { return ntcSampleLookup[normalizeName(name)]; });
    if (calibrationConflict.length) issues.push({ severity: "blocker", code: "NTC_CALIBRATOR_CONFLICT", message: "NTC 与已配置校准样本重叠：" + calibrationConflict.join("、") + "。请重新确认 NTC 后再锁定校准。" });

    var ntcRecords = records.filter(isNtc);
    var analyticalSamples = unique(records.filter(function (record) { return !isNtc(record); }).map(function (record) { return record.sampleName; }).filter(Boolean));
    if (records.length && !analyticalSamples.length) issues.push({ severity: "blocker", code: "NO_ANALYTICAL_SAMPLES", message: "所有记录都被标记为 NTC，没有可进行 CN 分析的样本。" });
    return {
      issues: issues,
      summary: {
        detected: ntcRecords.length > 0,
        physicalWellCount: unique(ntcRecords.map(function (record) { return record.wellPosition || String(record.wellNumber); })).length,
        assayRowCount: ntcRecords.length,
        sampleNames: unique(ntcRecords.map(function (record) { return record.sampleName; }).filter(Boolean)),
        wellPositions: unique(ntcRecords.map(function (record) { return record.wellPosition || String(record.wellNumber); })),
        sources: unique(ntcRecords.map(function (record) { return record.roleSource; }).filter(Boolean)),
        assignment: {
          mode: mode,
          confirmed: confirmed,
          note: normalizeText(assignment.note),
          appliedAt: normalizeText(assignment.appliedAt),
          sampleNames: requestedSamples,
          wellPositions: requestedWells
        }
      }
    };
  }

  function inferReferenceName(records, metadata, explicit) {
    if (explicit) return explicit;
    var fromMeta = normalizeName(getMetadata(metadata, "Endogenous Control"));
    var targets = unique(records.map(function (r) { return r.targetName; })).filter(Boolean);
    if (fromMeta && targets.some(function (t) { return normalizeKey(t) === normalizeKey(fromMeta); })) {
      return targets.filter(function (t) { return normalizeKey(t) === normalizeKey(fromMeta); })[0];
    }
    var vic = {};
    records.forEach(function (record) {
      if (/VIC/i.test(record.reporter)) vic[record.targetName] = (vic[record.targetName] || 0) + 1;
    });
    var vicNames = Object.keys(vic).sort(function (a, b) { return vic[b] - vic[a]; });
    if (vicNames.length) return vicNames[0];
    var rnase = targets.filter(function (t) { return /rnase\s*p|rpph1/i.test(t); });
    return rnase[0] || targets[targets.length - 1] || "";
  }

  function addPanelSignatures(records) {
    var byWell = {};
    records.forEach(function (record) {
      var key = record.wellPosition || String(record.wellNumber);
      if (!byWell[key]) byWell[key] = [];
      byWell[key].push(record);
    });
    var issues = [];
    Object.keys(byWell).forEach(function (well) {
      var rows = byWell[well];
      var samples = unique(rows.map(function (r) { return r.sampleName; }));
      if (samples.length > 1) issues.push({ severity: "blocker", code: "WELL_SAMPLE_CONFLICT", message: well + " 同一物理孔出现多个样本名：" + samples.join("、") });
      var targetCounts = {};
      rows.forEach(function (record) { targetCounts[normalizeKey(record.targetName)] = (targetCounts[normalizeKey(record.targetName)] || 0) + 1; });
      Object.keys(targetCounts).forEach(function (targetKey) {
        if (targetCounts[targetKey] > 1) issues.push({ severity: "blocker", code: "DUPLICATE_WELL_TARGET", message: well + " 的同一 target 出现 " + targetCounts[targetKey] + " 条记录，无法确定唯一测量。" });
      });
      var signature = unique(rows.map(function (r) { return r.targetName; }).filter(Boolean)).sort().join(" + ");
      rows.forEach(function (record) { record.panelSignature = signature; });
    });
    return issues;
  }

  function makeAssayKey(record, splitPanels) {
    return splitPanels ? record.targetName + " || " + record.panelSignature : record.targetName;
  }

  function displayAssayName(assay) {
    return assay.panelSignature ? assay.targetName + " [" + assay.panelSignature + "]" : assay.targetName;
  }

  function validateRunMetadata(records, metadata, referenceName, plateFormat) {
    var issues = [];
    var reporters = unique(records.map(function (r) { return r.reporter; }).filter(Boolean));
    reporters.forEach(function (reporter) {
      var value = getMetadata(metadata, "Calibration Pure Dye " + reporter + " is expired");
      if (/^(yes|y|true|1|是)$/i.test(normalizeText(value))) {
        issues.push({ severity: "blocker", code: "EXPIRED_DYE_CALIBRATION", message: reporter + " 纯染料校准已过期，该批数据只能查看，不建议放行。" });
      }
    });
    ["Background", "ROI", "Uniformity"].forEach(function (name) {
      var value = getMetadata(metadata, "Calibration " + name + " is expired");
      if (/^(yes|y|true|1|是)$/i.test(normalizeText(value))) {
        issues.push({ severity: "blocker", code: "EXPIRED_INSTRUMENT_CALIBRATION", message: name + " 校准已过期。" });
      }
    });
    var thresholdByTarget = {};
    records.forEach(function (r) {
      if (r.ctThreshold !== null) {
        if (!thresholdByTarget[r.targetName]) thresholdByTarget[r.targetName] = [];
        thresholdByTarget[r.targetName].push(round(r.ctThreshold, 4));
      }
    });
    Object.keys(thresholdByTarget).forEach(function (target) {
      var values = unique(thresholdByTarget[target]);
      if (values.length > 1) {
        issues.push({ severity: "warning", code: "CT_THRESHOLD_INCONSISTENT", message: target + " 在本次运行中使用了多个 Ct threshold：" + values.join("/") + "。请确认同一 assay 的阈值设置是否一致且可追溯。" });
      }
    });
    var baselineOff = records.filter(function (r) { return !r.automaticBaseline; }).length;
    if (baselineOff) issues.push({ severity: "warning", code: "AUTO_BASELINE_OFF", message: baselineOff + " 条记录没有启用自动基线。" });
    var ntcRecords = records.filter(isNtc);
    if (!ntcRecords.length) {
      issues.push({ severity: "warning", code: "NO_NTC", message: "未识别或确认 NTC；本次可继续人工复核，但无法据此排除污染或非特异扩增。若实验中确有 NTC 但 plate setup 漏标，可在下方补标；如本次未设置 NTC，软件不能补造。" });
    } else {
      var ntcPhysicalWells = unique(ntcRecords.map(function (record) { return record.wellPosition || String(record.wellNumber); }));
      issues.push({ severity: "info", code: "NTC_RECOGNIZED", message: "已识别 " + ntcPhysicalWells.length + " 个 NTC 物理孔：" + ntcPhysicalWells.join("、") + "。" });
      var analyticalPanels = unique(records.filter(function (record) { return !isNtc(record) && normalizeKey(record.targetName) !== normalizeKey(referenceName); }).map(function (record) { return record.panelSignature; }).filter(Boolean));
      var ntcPanels = {};
      ntcRecords.forEach(function (record) { ntcPanels[record.panelSignature] = true; });
      var missingNtcPanels = analyticalPanels.filter(function (panel) { return !ntcPanels[panel]; });
      if (missingNtcPanels.length) issues.push({ severity: "warning", code: "NTC_PANEL_MISSING", message: "以下反应组合没有对应 NTC：" + missingNtcPanels.join("；") + "。本次可继续人工复核，但不能据此排除这些 panel 的污染或非特异扩增。" });
    }
    var capacities = plateFormat === 384 ? { rows: 16, columns: 24 } : { rows: 8, columns: 12 };
    records.forEach(function (record) {
      var pos = parseWellPosition(record.wellPosition);
      if (pos && (pos.row > capacities.rows || pos.column > capacities.columns)) {
        issues.push({ severity: "blocker", code: "WELL_OUTSIDE_PLATE", message: record.wellPosition + " 超出 " + plateFormat + " 孔板范围。" });
      }
      if (pos && record.wellNumber !== null) {
        var expectedWellNumber = (pos.row - 1) * capacities.columns + pos.column;
        if (expectedWellNumber !== record.wellNumber) issues.push({ severity: "blocker", code: "WELL_NUMBER_MISMATCH", message: record.wellPosition + " 应对应 Well=" + expectedWellNumber + "，但文件记录为 " + record.wellNumber + "。" });
      }
    });
    var reporterByTarget = {};
    records.forEach(function (record) {
      if (!reporterByTarget[record.targetName]) reporterByTarget[record.targetName] = {};
      if (record.reporter) reporterByTarget[record.targetName][record.reporter] = true;
    });
    Object.keys(reporterByTarget).forEach(function (target) {
      var targetReporters = Object.keys(reporterByTarget[target]);
      if (targetReporters.length > 1) issues.push({ severity: "blocker", code: "REPORTER_MAPPING_CONFLICT", message: target + " 在同一文件中对应多个 reporter：" + targetReporters.join("/") + "。" });
    });
    var ntcDetected = records.filter(function (record) { return isNtc(record) && record.ct !== null; });
    if (ntcDetected.length) {
      var ntcDetails = ntcDetected.slice(0, 8).map(function (record) { return (record.wellPosition || record.wellNumber) + "/" + record.targetName + " Ct=" + round(record.ct, 3); });
      issues.push({ severity: "blocker", code: "NTC_AMPLIFICATION", message: "NTC 的 target 或内参通道出现数值 Ct：" + ntcDetails.join("；") + (ntcDetected.length > 8 ? "；另有 " + (ntcDetected.length - 8) + " 条" : "") + "。需排查污染、非特异扩增或 NTC 误标。" });
    }
    var sourceFlagCounts = { THOLDFAIL: 0, CQCONF: 0, NOAMP: 0, EXPFAIL: 0 };
    records.forEach(function (record) {
      Object.keys(sourceFlagCounts).forEach(function (flag) { if (record.flags && record.flags[flag]) sourceFlagCounts[flag] += 1; });
    });
    var presentFlags = Object.keys(sourceFlagCounts).filter(function (flag) { return sourceFlagCounts[flag] > 0; });
    if (presentFlags.length) issues.push({ severity: "warning", code: "SOURCE_FLAGS_PRESENT", message: "仪器原始 flags：" + presentFlags.map(function (flag) { return flag + "=" + sourceFlagCounts[flag]; }).join("；") + "。本工具保留全部 flags，不会仅凭单一 flag 静默删孔。" });
    if (!referenceName) issues.push({ severity: "blocker", code: "NO_REFERENCE_ASSAY", message: "无法确定内参 assay。" });
    return issues;
  }

  function normalPdf(x, mu, sigma) {
    var s = Math.max(1e-6, sigma);
    var z = (x - mu) / s;
    return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
  }

  function logSumExp(values) {
    var m = Math.max.apply(null, values);
    if (!isFinite(m)) return -Infinity;
    return m + Math.log(values.reduce(function (sum, v) { return sum + Math.exp(v - m); }, 0));
  }

  function estimatePlateSd(sampleGroups) {
    var oneTwoDistance = Math.log(2) / Math.log(1.8);
    var residuals = [];
    var groups = 0;
    sampleGroups.forEach(function (wells) {
      var deltas = wells.map(function (w) { return w.deltaCt; }).filter(function (v) { return v !== null; });
      if (deltas.length < 2) return;
      var med = median(deltas);
      var kept = deltas.filter(function (v) { return Math.abs(v - med) <= oneTwoDistance; });
      if (kept.length < 2) return;
      groups += 1;
      var m = mean(kept);
      kept.forEach(function (v) { residuals.push(v - m); });
    });
    var df = residuals.length - groups;
    if (df <= 0) return null;
    return Math.sqrt(residuals.reduce(function (sum, v) { return sum + v * v; }, 0) / df);
  }

  function applyOutlierRule(wellsBySample, enabled) {
    var groups = Object.keys(wellsBySample).map(function (sample) { return wellsBySample[sample]; });
    var plateSd = estimatePlateSd(groups);
    if (!enabled || plateSd === null) return { plateSd: plateSd, excluded: 0 };
    var excluded = 0;
    Object.keys(wellsBySample).forEach(function (sample) {
      var wells = wellsBySample[sample].filter(function (w) { return w.analysisState === "VALID"; });
      if (wells.length < 3) return;
      var center = median(wells.map(function (w) { return w.deltaCt; }));
      var cutoff = Math.max(4 * plateSd, 0.30);
      wells.forEach(function (well) {
        if (Math.abs(well.deltaCt - center) > cutoff) {
          well.analysisState = "OUTLIER";
          well.qcCodes.push("OCONF");
          well.omitReason = "自动离群：距离重复组中位数 > max(4×板级SD, 0.30 Ct)";
          excluded += 1;
        }
      });
    });
    return { plateSd: plateSd, excluded: excluded };
  }

  function fitPopulationCalibration(values, expectedModeCopy, maxCopyNumber) {
    var xs = values.slice().filter(function (v) { return isFinite(v); });
    if (!xs.length) return { ok: false, reason: "没有可用的非零拷贝样本。" };
    var modeCopy = Math.max(1, Math.round(expectedModeCopy || 2));
    var k0 = median(xs) + Math.log(modeCopy) / Math.log(2);
    var best = null;
    var steps = 1600;
    for (var step = 0; step <= steps; step += 1) {
      var K = k0 - 2 + 4 * step / steps;
      var assignments = xs.map(function (x) {
        return Math.max(1, Math.min(maxCopyNumber, Math.round(Math.pow(2, K - x))));
      });
      var counts = {};
      assignments.forEach(function (cn) { counts[cn] = (counts[cn] || 0) + 1; });
      var observedMode = Number(Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a] || Math.abs(Number(a) - modeCopy) - Math.abs(Number(b) - modeCopy);
      })[0]);
      if (observedMode !== modeCopy) continue;
      var residuals = xs.map(function (x, i) { return x - (K - Math.log(assignments[i]) / Math.log(2)); });
      var sigma = Math.max(0.05, Math.sqrt(mean(residuals.map(function (r) { return r * r; }))));
      var alpha = 0.1;
      var denom = xs.length + alpha * maxCopyNumber;
      var priors = {};
      for (var cn = 1; cn <= maxCopyNumber; cn += 1) priors[cn] = ((counts[cn] || 0) + alpha) / denom;
      var logLikelihood = xs.reduce(function (sum, x) {
        var terms = [];
        for (var copy = 1; copy <= maxCopyNumber; copy += 1) {
          terms.push(Math.log(priors[copy]) + Math.log(normalPdf(x, K - Math.log(copy) / Math.log(2), sigma) + 1e-300));
        }
        return sum + logSumExp(terms);
      }, 0);
      if (!best || logLikelihood > best.logLikelihood) best = { ok: true, K: K, sigma: sigma, priors: priors, logLikelihood: logLikelihood, observedMode: observedMode };
    }
    return best || { ok: false, reason: "无法在给定的众数拷贝数下拟合群体模型。" };
  }

  function fitQualityModel(results, settings, calibration) {
    var eligible = results.filter(function (r) { return r.predictedCopyNumber !== null && r.meanDeltaCt !== null && r.classification === "NONZERO"; });
    var counts = {};
    eligible.forEach(function (r) { counts[r.predictedCopyNumber] = (counts[r.predictedCopyNumber] || 0) + 1; });
    var largest = Object.keys(counts).reduce(function (m, key) { return Math.max(m, counts[key]); }, 0);
    if (largest < settings.minimumConfidenceGroupSize) {
      return { ok: false, reason: "至少需要 " + settings.minimumConfidenceGroupSize + " 个相同拷贝数的样本；当前最大类别仅 " + largest + " 个。", counts: counts };
    }
    var groups = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a]; });
    var E = 1;
    var K = calibration.K;
    if (groups.length >= 2) {
      var c1 = groups[0];
      var c2 = groups[1];
      var mu1 = mean(eligible.filter(function (r) { return r.predictedCopyNumber === c1; }).map(function (r) { return r.meanDeltaCt; }));
      var mu2 = mean(eligible.filter(function (r) { return r.predictedCopyNumber === c2; }).map(function (r) { return r.meanDeltaCt; }));
      var denominator = mu1 - mu2;
      if (Math.abs(denominator) > 1e-6) {
        var candidateE = Math.exp((Math.log(c2) - Math.log(c1)) / denominator) - 1;
        if (candidateE >= 0.5 && candidateE <= 1.2) {
          E = candidateE;
          K = mu1 + Math.log(c1) / Math.log(1 + E);
        }
      }
    }
    if (!isFinite(K)) K = mean(eligible.map(function (r) { return r.meanDeltaCt + Math.log(r.predictedCopyNumber) / Math.log(1 + E); }));
    var residuals = eligible.map(function (r) { return r.meanDeltaCt - (K - Math.log(r.predictedCopyNumber) / Math.log(1 + E)); });
    var df = Math.max(1, residuals.length - (groups.length >= 2 ? 2 : 1));
    var sigma = Math.max(0.03, Math.sqrt(residuals.reduce(function (s, x) { return s + x * x; }, 0) / df));
    var alpha = 0.1;
    var denom = eligible.length + alpha * settings.maxCopyNumber;
    var priors = {};
    for (var cn = 1; cn <= settings.maxCopyNumber; cn += 1) priors[cn] = ((counts[cn] || 0) + alpha) / denom;
    return { ok: true, K: K, E: E, sigma: sigma, priors: priors, counts: counts, note: "透明高斯后验估计，未实施 CopyCaller 的 bootstrap 5% 下限。" };
  }

  function posteriorForCopy(x, assigned, model, maxCopyNumber) {
    var weights = {};
    var total = 0;
    for (var cn = 1; cn <= maxCopyNumber; cn += 1) {
      var mu = model.K - Math.log(cn) / Math.log(1 + model.E);
      var weight = (model.priors[cn] || 0) * normalPdf(x, mu, model.sigma);
      weights[cn] = weight;
      total += weight;
    }
    return total > 0 ? weights[assigned] / total : null;
  }

  function buildAssays(records, referenceName, settings) {
    var byWell = {};
    records.forEach(function (record) {
      var wellKey = record.wellPosition || String(record.wellNumber);
      if (!byWell[wellKey]) byWell[wellKey] = [];
      byWell[wellKey].push(record);
    });
    var assayMap = {};
    records.forEach(function (record) {
      if (normalizeKey(record.targetName) === normalizeKey(referenceName)) return;
      var assayKey = makeAssayKey(record, settings.splitPanels);
      if (!assayMap[assayKey]) assayMap[assayKey] = { key: assayKey, targetName: record.targetName, panelSignature: settings.splitPanels ? record.panelSignature : "", reporters: {}, wells: [] };
      assayMap[assayKey].reporters[record.reporter] = true;
      var wellKey = record.wellPosition || String(record.wellNumber);
      var ref = (byWell[wellKey] || []).filter(function (candidate) { return normalizeKey(candidate.targetName) === normalizeKey(referenceName); })[0] || null;
      var qcCodes = [];
      var analysisState = "VALID";
      var deltaCt = null;
      var sampleRole = isNtc(record) ? "NTC" : "SAMPLE";
      if (sampleRole === "NTC") {
        qcCodes.push("NTC");
        if (record.ct !== null || (ref && ref.ct !== null)) { analysisState = "NTC_AMPLIFICATION"; qcCodes.push("NTC_AMP"); }
        else analysisState = "NTC_CLEAR";
        if (record.omit) qcCodes.push("SOURCE_OMIT");
      }
      else if (record.omit) { analysisState = "OMIT"; qcCodes.push("OMIT"); }
      else if (!ref) { analysisState = "INVALID_REFERENCE"; qcCodes.push("NO_REFERENCE_ROW"); }
      else if (ref.ct === null) { analysisState = "INVALID_REFERENCE"; qcCodes.push("NOVIC"); }
      else if (ref.ct > settings.referenceCtMax) { analysisState = "INVALID_REFERENCE"; qcCodes.push("VICET"); }
      else if (record.ct === null) { analysisState = "ZERO_EVIDENCE"; qcCodes.push("NO_TARGET"); }
      else {
        deltaCt = record.ct - ref.ct;
        if (deltaCt > settings.zeroCopyDeltaCt) { analysisState = "ZERO_EVIDENCE"; qcCodes.push("DCTET"); }
      }
      assayMap[assayKey].wells.push({
        assayKey: assayKey,
        targetName: record.targetName,
        panelSignature: record.panelSignature,
        wellPosition: record.wellPosition,
        wellNumber: record.wellNumber,
        sampleName: record.sampleName,
        sampleRole: sampleRole,
        roleSource: record.roleSource || "",
        ntcAssignmentMode: record.ntcAssignmentMode || "",
        ntcAssignmentNote: record.ntcAssignmentNote || "",
        targetCt: record.ct,
        referenceCt: ref ? ref.ct : null,
        deltaCt: deltaCt,
        analysisState: analysisState,
        qcCodes: qcCodes,
        omitReason: record.omit ? "源文件 Omit=true" : "",
        sourceRecord: record,
        referenceRecord: ref
      });
    });
    return Object.keys(assayMap).sort().map(function (key) {
      var assay = assayMap[key];
      assay.reporters = Object.keys(assay.reporters);
      return assay;
    });
  }

  function summarizeAssay(assay, settings) {
    var wellsBySample = {};
    assay.wells.forEach(function (well) {
      if (well.sampleRole === "NTC") return;
      if (!wellsBySample[well.sampleName]) wellsBySample[well.sampleName] = [];
      wellsBySample[well.sampleName].push(well);
    });
    var outlierInfo = applyOutlierRule(wellsBySample, settings.autoOutlier);
    var results = Object.keys(wellsBySample).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).map(function (sampleName) {
      var wells = wellsBySample[sampleName];
      var validReference = wells.filter(function (w) { return ["VALID", "ZERO_EVIDENCE", "OUTLIER"].indexOf(w.analysisState) >= 0; });
      var valid = wells.filter(function (w) { return w.analysisState === "VALID"; });
      var zero = wells.filter(function (w) { return w.analysisState === "ZERO_EVIDENCE"; });
      var invalid = wells.filter(function (w) { return ["INVALID_REFERENCE", "OMIT"].indexOf(w.analysisState) >= 0; });
      var classification = "INVALID";
      if (valid.length && zero.length) classification = "MIXED";
      else if (!valid.length && zero.length && zero.length === validReference.length) classification = "ZERO";
      else if (valid.length) classification = "NONZERO";
      var deltas = valid.map(function (w) { return w.deltaCt; });
      var flags = [];
      if (classification === "MIXED") flags.push("MIXED_ZERO_NONZERO");
      if (classification === "INVALID") flags.push("INVALID_REFERENCE");
      if (valid.length < settings.minReplicates && classification === "NONZERO") flags.push("TOO_FEW_REPLICATES");
      if (valid.length < settings.recommendedReplicates && classification === "NONZERO") flags.push("BELOW_RECOMMENDED_REPLICATES");
      if (zero.length < settings.minReplicates && classification === "ZERO") flags.push("TOO_FEW_REPLICATES");
      if (zero.length < settings.recommendedReplicates && classification === "ZERO") flags.push("BELOW_RECOMMENDED_REPLICATES");
      var sd = sampleSd(deltas);
      if (sd !== null && sd > settings.replicateSdWarn) flags.push("HIGH_REPLICATE_SD");
      var zeroCopyBasis = "";
      if (classification === "ZERO") {
        flags.push("ZERO_COPY_CANDIDATE");
        zeroCopyBasis = zero.every(function (well) { return well.targetCt === null; })
          ? "全部可分析复孔 Target Ct 未检出，且对应内参 Ct 有效"
          : "全部可分析复孔为未检出或 ΔCt 超过 zero-copy 阈值，且对应内参 Ct 有效";
      }
      return {
        assayKey: assay.key,
        assayDisplay: displayAssayName(assay),
        targetName: assay.targetName,
        panelSignature: assay.panelSignature,
        sampleName: sampleName,
        classification: classification,
        totalWells: wells.length,
        validReferenceCount: validReference.length,
        validCount: valid.length,
        zeroEvidenceCount: zero.length,
        invalidCount: invalid.length,
        meanTargetCt: mean(valid.map(function (w) { return w.targetCt; })),
        meanReferenceCt: mean(validReference.map(function (w) { return w.referenceCt; })),
        meanDeltaCt: mean(deltas),
        deltaCtSd: sd,
        flags: flags,
        zeroCopyBasis: zeroCopyBasis,
        zeroCallConfirmed: false,
        calibrationEligible: classification === "NONZERO" && valid.length >= settings.minReplicates && sd !== null && sd <= settings.calibratorMaxSd,
        wells: wells,
        deltaDeltaCt: null,
        rq: null,
        calculatedCopyNumber: null,
        predictedCopyNumber: null,
        minCopyNumber: null,
        maxCopyNumberObserved: null,
        confidenceLike: null,
        absoluteZScore: null,
        qualityStatus: classification === "ZERO" ? "ZERO_COPY_CANDIDATE" : (classification === "INVALID" ? "INVALID_REFERENCE" : (classification === "MIXED" ? "NO_CALL_MIXED" : "NOT_ANALYZED"))
      };
    });
    assay.results = results;
    assay.plateDeltaCtSd = outlierInfo.plateSd;
    assay.outlierCount = outlierInfo.excluded;
    return assay;
  }

  function calibrationForAssay(assay, settings, recordedReference) {
    var config = settings.calibrations[assay.key] || settings.calibrations[assay.targetName] || { mode: "none" };
    var guard = { mode: config.mode || "none", ok: false, K: null, errors: [], warnings: [], recordedReference: recordedReference || "", config: config };
    var lookup = {};
    assay.results.forEach(function (result) { lookup[result.sampleName] = result; });
    if (recordedReference) {
      var recorded = lookup[recordedReference];
      if (!recorded) guard.warnings.push("导出文件记录的 Reference Sample“" + recordedReference + "”不在该 assay 中。请改选本板通过资格检查且已独立确认 CN 的备用校准品或校准组。");
      else if (!recorded.calibrationEligible) guard.warnings.push("原运行设置中的 Reference Sample“" + recordedReference + "”不符合 " + assay.targetName + " 校准资格，已禁止自动继承。请改选本板通过检查且已独立确认 CN 的备用校准品或校准组；不会从普通样本中自动替换。");
      else guard.warnings.push("原运行 Reference Sample“" + recordedReference + "”仅作历史记录；未经独立拷贝数确认前不会自动启用。");
    }
    if (guard.mode === "none") {
      guard.errors.push("未配置校准方式。");
      return guard;
    }
    if (guard.mode === "sample") {
      var result = lookup[config.sampleName];
      var cn = toNumber(config.copyNumber);
      if (!result) guard.errors.push("所选校准样本不存在。");
      else if (!result.calibrationEligible) guard.errors.push("所选校准样本未通过资格检查（目标未扩增、内参无效、复孔不足或 SD 超限）。");
      if (!(cn > 0)) guard.errors.push("校准样本拷贝数必须 >0。");
      if (!config.independentlyConfirmed) guard.errors.push("必须确认该校准样本的拷贝数已由独立依据确认。");
      if (!guard.errors.length) {
        guard.ok = true;
        guard.calibratorDeltaCt = result.meanDeltaCt;
        guard.calibratorCopyNumber = cn;
        guard.K = result.meanDeltaCt + Math.log(cn) / Math.log(2);
        guard.label = config.sampleName + " (CN=" + cn + ")";
      }
      return guard;
    }
    if (guard.mode === "group") {
      var names = Array.isArray(config.sampleNames) ? config.sampleNames : [];
      var group = names.map(function (name) { return lookup[name]; }).filter(Boolean);
      var groupCn = toNumber(config.copyNumber);
      if (group.length < 2) guard.errors.push("已知校准组至少需要 2 个样本。");
      if (group.some(function (r) { return !r.calibrationEligible; })) guard.errors.push("校准组中存在未通过资格检查的样本。");
      if (!(groupCn > 0)) guard.errors.push("校准组拷贝数必须 >0。");
      if (!config.independentlyConfirmed) guard.errors.push("必须确认该组样本的拷贝数已由独立依据确认。");
      if (!guard.errors.length) {
        var groupDelta = mean(group.map(function (r) { return r.meanDeltaCt; }));
        guard.ok = true;
        guard.calibratorDeltaCt = groupDelta;
        guard.calibratorCopyNumber = groupCn;
        guard.K = groupDelta + Math.log(groupCn) / Math.log(2);
        guard.label = names.join("、") + " (group CN=" + groupCn + ")";
      }
      return guard;
    }
    if (guard.mode === "population") {
      var population = assay.results.filter(function (r) { return r.classification === "NONZERO" && r.validCount >= settings.minReplicates && r.meanDeltaCt !== null; });
      if (population.length < settings.minimumPopulationSamples) guard.errors.push("群体校准至少需要 " + settings.minimumPopulationSamples + " 个非零拷贝可用样本；当前仅 " + population.length + " 个。");
      var expected = Math.round(toNumber(config.expectedMostFrequentCopyNumber) || 0);
      if (expected < 1) guard.errors.push("预期众数拷贝数必须为正整数；0-copy 不参与对数模型拟合。");
      if (!guard.errors.length) {
        var fit = fitPopulationCalibration(population.map(function (r) { return r.meanDeltaCt; }), expected, settings.maxCopyNumber);
        if (!fit.ok) guard.errors.push(fit.reason);
        else {
          guard.ok = true;
          guard.K = fit.K;
          guard.populationFit = fit;
          guard.label = "群体最大似然近似（众数 CN=" + expected + "）";
          guard.warnings.push("该结果为公开原理的透明近似，不保证与 CopyCaller 官方软件逐值一致。");
        }
      }
      return guard;
    }
    guard.errors.push("不支持的校准方式：" + guard.mode);
    return guard;
  }

  function applyCalibration(assay, calibration, settings) {
    if (!calibration.ok) return assay;
    assay.results.forEach(function (result) {
      if (result.classification !== "NONZERO" || result.meanDeltaCt === null || result.validCount < settings.minReplicates) return;
      var calculated = Math.pow(2, calibration.K - result.meanDeltaCt);
      var predicted;
      if (calibration.mode === "population" && calibration.populationFit) {
        var weights = [];
        for (var cn = 1; cn <= settings.maxCopyNumber; cn += 1) {
          weights.push({ cn: cn, value: (calibration.populationFit.priors[cn] || 0) * normalPdf(result.meanDeltaCt, calibration.K - Math.log(cn) / Math.log(2), calibration.populationFit.sigma) });
        }
        predicted = weights.sort(function (a, b) { return b.value - a.value; })[0].cn;
      } else predicted = Math.max(1, Math.min(settings.maxCopyNumber, Math.round(calculated)));
      result.deltaDeltaCt = result.meanDeltaCt - calibration.calibratorDeltaCt;
      if (calibration.mode === "population") result.deltaDeltaCt = null;
      result.rq = calibration.calibratorCopyNumber ? calculated / calibration.calibratorCopyNumber : null;
      result.calculatedCopyNumber = calculated;
      result.predictedCopyNumber = predicted;
      var wellCns = result.wells.filter(function (w) { return w.analysisState === "VALID"; }).map(function (w) { return Math.pow(2, calibration.K - w.deltaCt); });
      result.minCopyNumber = wellCns.length ? Math.min.apply(null, wellCns) : null;
      result.maxCopyNumberObserved = wellCns.length ? Math.max.apply(null, wellCns) : null;
      result.qualityStatus = "METRICS_PENDING";
    });
    var model = fitQualityModel(assay.results, settings, calibration);
    assay.qualityModel = model;
    assay.results.forEach(function (result) {
      if (result.classification === "ZERO") {
        var enoughZeroEvidence = result.zeroEvidenceCount >= settings.minReplicates && result.validReferenceCount >= settings.minReplicates;
        if (enoughZeroEvidence) {
          result.predictedCopyNumber = 0;
          result.zeroCallConfirmed = true;
          result.qualityStatus = "ZERO_COPY_CONFIRMED";
          result.flags = result.flags.filter(function (flag) { return flag !== "ZERO_COPY_CANDIDATE"; });
          result.flags.push("ZERO_COPY_CONFIRMED");
        } else {
          result.qualityStatus = "ZERO_COPY_CANDIDATE";
        }
        return;
      }
      if (result.predictedCopyNumber === null) {
        if (result.classification === "MIXED") result.qualityStatus = "NO_CALL_MIXED";
        else if (result.classification === "INVALID") result.qualityStatus = "INVALID_REFERENCE";
        else result.qualityStatus = "NO_CALL";
        return;
      }
      if (!model.ok) {
        result.qualityStatus = result.flags.indexOf("HIGH_REPLICATE_SD") >= 0 ? "REVIEW_REPLICATE_SD" : "METRICS_UNAVAILABLE";
        return;
      }
      result.confidenceLike = posteriorForCopy(result.meanDeltaCt, result.predictedCopyNumber, model, settings.maxCopyNumber);
      var mu = model.K - Math.log(result.predictedCopyNumber) / Math.log(1 + model.E);
      result.absoluteZScore = Math.abs(result.meanDeltaCt - mu) / model.sigma;
      if (result.confidenceLike < settings.confidenceThreshold) result.qualityStatus = "LOW_CONFIDENCE";
      else if (result.absoluteZScore >= settings.zFail) result.qualityStatus = "FAIL_Z";
      else if (result.absoluteZScore >= settings.zPass) result.qualityStatus = "CAUTION_Z";
      else result.qualityStatus = "PASS";
    });
    return assay;
  }

  function analyze(recordsInput, metadataInput, settingsInput) {
    var settings = mergeSettings(settingsInput || {});
    var records = (recordsInput || []).map(function (record) {
      var clone = {};
      Object.keys(record).forEach(function (key) {
        clone[key] = key === "flags" ? Object.assign({}, record.flags) : record[key];
      });
      return clone;
    });
    var metadata = Object.assign({}, metadataInput || {});
    var structuralIssues = addPanelSignatures(records);
    var ntcResolution = resolveNtcRoles(records, settings);
    var referenceName = inferReferenceName(records, metadata, settings.referenceName);
    var plateFormat = settings.plateFormat || inferPlateFormat(records, metadata);
    var runIssues = structuralIssues.concat(ntcResolution.issues, validateRunMetadata(records, metadata, referenceName, plateFormat));
    var assays = buildAssays(records, referenceName, settings).map(function (assay) { return summarizeAssay(assay, settings); });
    var recordedReference = normalizeName(getMetadata(metadata, "Reference Sample"));
    assays.forEach(function (assay) {
      assay.calibrationCandidates = assay.results.map(function (result) {
        return {
          sampleName: result.sampleName,
          eligible: result.calibrationEligible,
          classification: result.classification,
          validCount: result.validCount,
          deltaCtSd: result.deltaCtSd,
          reason: result.calibrationEligible ? "可选，仍需独立确认已知拷贝数" : (result.classification !== "NONZERO" ? "目标非稳定非零扩增" : (result.validCount < settings.minReplicates ? "有效复孔不足" : "复孔 SD 超过校准品限值"))
        };
      });
      assay.calibration = calibrationForAssay(assay, settings, recordedReference);
      applyCalibration(assay, assay.calibration, settings);
    });
    var wellsUsed = unique(records.map(function (r) { return r.wellPosition || String(r.wellNumber); })).length;
    var sampleNames = unique(records.filter(function (r) { return r.sampleRole !== "NTC"; }).map(function (r) { return r.sampleName; })).filter(Boolean);
    var panelSignatures = unique(records.map(function (r) { return r.panelSignature; })).filter(Boolean);
    var targetPanelMap = {};
    records.forEach(function (r) {
      if (normalizeKey(r.targetName) === normalizeKey(referenceName)) return;
      if (!targetPanelMap[r.targetName]) targetPanelMap[r.targetName] = {};
      targetPanelMap[r.targetName][r.panelSignature] = true;
    });
    Object.keys(targetPanelMap).forEach(function (target) {
      var panels = Object.keys(targetPanelMap[target]);
      if (panels.length > 1) runIssues.push({ severity: settings.splitPanels ? "info" : "warning", code: "TARGET_IN_MULTIPLE_PANELS", message: target + " 出现在 " + panels.length + " 种反应组合中：" + panels.join("；") + (settings.splitPanels ? "。已按反应组合分开分析。" : "。当前已合并，需确认桥接验证。") });
    });
    var calibrationBlocked = assays.some(function (assay) { return !assay.calibration.ok; });
    var releaseBlocked = calibrationBlocked || runIssues.some(function (issue) { return issue.severity === "blocker"; });
    return {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      settings: settings,
      metadata: metadata,
      records: records,
      referenceName: referenceName,
      recordedReferenceSample: recordedReference,
      plateFormat: plateFormat,
      wellsUsed: wellsUsed,
      plateCapacity: plateFormat,
      sampleCount: sampleNames.length,
      sampleNames: sampleNames,
      ntcSummary: ntcResolution.summary,
      panelSignatures: panelSignatures,
      runIssues: runIssues,
      assays: assays,
      releaseStatus: releaseBlocked ? "HOLD" : "READY_FOR_REVIEW",
      methodBoundary: "已知校准样本的 ΔΔCt/CN 公式按公开文档实现；群体校准、Confidence-like 和自动离群为透明近似，不宣称与 CopyCaller 专有实现逐值一致。"
    };
  }

  function flattenResults(analysis) {
    var rows = [];
    (analysis.assays || []).forEach(function (assay) {
      assay.results.forEach(function (r) {
        rows.push({
          assay: r.assayDisplay,
          target: r.targetName,
          panel: r.panelSignature,
          sample: r.sampleName,
          classification: r.classification,
          valid_replicates: r.classification === "ZERO" ? r.zeroEvidenceCount : r.validCount,
          total_replicates: r.totalWells,
          target_ct_mean: round(r.meanTargetCt, 4),
          reference_ct_mean: round(r.meanReferenceCt, 4),
          delta_ct_mean: round(r.meanDeltaCt, 4),
          delta_ct_sd: round(r.deltaCtSd, 4),
          delta_delta_ct: round(r.deltaDeltaCt, 4),
          rq: round(r.rq, 4),
          copy_number_calculated: round(r.calculatedCopyNumber, 4),
          copy_number_predicted: r.predictedCopyNumber,
          min_copy_number: round(r.minCopyNumber, 4),
          max_copy_number: round(r.maxCopyNumberObserved, 4),
          confidence_like: round(r.confidenceLike, 4),
          absolute_z_score: round(r.absoluteZScore, 4),
          quality_status: r.qualityStatus,
          zero_copy_basis: r.classification === "ZERO" ? r.zeroCopyBasis + (r.zeroCallConfirmed ? "；同 assay / panel 存在有效阳性校准且复孔数达标" : "；尚未满足有效阳性校准与最低复孔数的全部条件") : "",
          flags: r.flags.join(";"),
          calibration: assay.calibration.label || "",
          calibration_valid: assay.calibration.ok
        });
      });
    });
    return rows;
  }

  function flattenWells(analysis) {
    var rows = [];
    (analysis.assays || []).forEach(function (assay) {
      assay.wells.forEach(function (w) {
        rows.push({
          assay: displayAssayName(assay),
          target: w.targetName,
          panel: w.panelSignature,
          sample: w.sampleName,
          original_sample: w.sampleName,
          sample_role: w.sampleRole,
          role_source: w.roleSource,
          ntc_assignment_mode: w.ntcAssignmentMode,
          ntc_assignment_note: w.ntcAssignmentNote,
          well: w.wellPosition,
          target_ct: round(w.targetCt, 4),
          reference_ct: round(w.referenceCt, 4),
          delta_ct: round(w.deltaCt, 4),
          analysis_state: w.analysisState,
          qc_codes: w.qcCodes.join(";"),
          omitted_reason: w.omitReason,
          source_row: w.sourceRecord.sourceRow,
          source_flags: Object.keys(w.sourceRecord.flags || {}).filter(function (key) { return w.sourceRecord.flags[key]; }).join(";")
        });
      });
    });
    return rows;
  }

  var EXPORT_QUALITY_LABELS = {
    PASS: "通过",
    CAUTION_Z: "Z-score 谨慎",
    FAIL_Z: "Z-score 失败",
    LOW_CONFIDENCE: "低置信度",
    ZERO_COPY_CONFIRMED: "0 copy",
    ZERO_COPY_CANDIDATE: "0-copy 候选",
    NO_CALL_MIXED: "部分扩增 · No call",
    INVALID_REFERENCE: "内参无效",
    METRICS_UNAVAILABLE: "Confidence/Z-score 暂不可计算（同 CN 样本少于 7 个；不影响 CN 判定）",
    REVIEW_REPLICATE_SD: "复孔 SD 需复核",
    NOT_ANALYZED: "未校准",
    NO_CALL: "No call",
    METRICS_PENDING: "待指标计算"
  };

  function exportValue(value, fallback) {
    if (value === null || value === undefined || String(value).trim() === "") return fallback === undefined ? "" : fallback;
    return value;
  }

  function joinExportParts(parts, separator) {
    return parts.filter(function (value) { return value !== null && value !== undefined && String(value).trim() !== ""; }).join(separator || " / ");
  }

  function auditIdentity(analysis, context) {
    var registration = context.registration || {};
    return {
      runId: exportValue(registration.runId, exportValue(getMetadata(analysis.metadata, "Experiment Name"), context.fileName || "未记录")),
      plateId: exportValue(registration.plateId, "待填写"),
      analysisId: exportValue(registration.analysisId, "未生成"),
      generatedAt: analysis.generatedAt,
      softwareVersion: VERSION
    };
  }

  function sampleCnRows(analysis, audit) {
    var rows = flattenResults(analysis).map(function (row) {
      var zeroCandidate = row.quality_status === "ZERO_COPY_CANDIDATE";
      return {
        "Sample ID": row.sample,
        "Target": row.target,
        "反应组合": row.panel,
        "CN 判定": zeroCandidate ? "0-copy 候选" : (row.copy_number_predicted === null ? "No call" : row.copy_number_predicted),
        "连续 CN": zeroCandidate ? null : row.copy_number_calculated,
        "结果状态": EXPORT_QUALITY_LABELS[row.quality_status] || row.quality_status,
        "0-copy 依据": row.zero_copy_basis,
        "批次状态": analysis.releaseStatus === "HOLD" ? "HOLD · 不可放行" : "READY_FOR_REVIEW · 待人工复核",
        "有效复孔": row.valid_replicates + "/" + row.total_replicates,
        "Target Ct mean": row.target_ct_mean,
        "Reference Ct mean": row.reference_ct_mean,
        "Mean ΔCt": row.delta_ct_mean,
        "SD(ΔCt)": row.delta_ct_sd,
        "ΔΔCt": row.delta_delta_ct,
        "RQ": row.rq,
        "CN 区间": zeroCandidate || row.min_copy_number === null || row.max_copy_number === null ? "" : row.min_copy_number + "–" + row.max_copy_number,
        "Confidence-like": row.confidence_like,
        "|Z|": row.absolute_z_score,
        "校准": row.calibration,
        "Flags": row.flags,
        "Run ID": audit.runId,
        "Plate ID": audit.plateId,
        "Analysis ID": audit.analysisId
      };
    });
    rows.sort(function (a, b) {
      return String(a["Sample ID"]).localeCompare(String(b["Sample ID"]), undefined, { numeric: true }) || String(a.Target).localeCompare(String(b.Target)) || String(a["反应组合"]).localeCompare(String(b["反应组合"]));
    });
    return rows;
  }

  function sampleCnSummary(analysis, audit) {
    var detailRows = sampleCnRows(analysis, audit);
    var targetCounts = {};
    (analysis.assays || []).forEach(function (assay) {
      targetCounts[assay.targetName] = (targetCounts[assay.targetName] || 0) + 1;
    });
    var units = (analysis.assays || []).map(function (assay) {
      var label = targetCounts[assay.targetName] > 1 && assay.panelSignature
        ? assay.targetName + " [" + assay.panelSignature + "]"
        : assay.targetName;
      return { key: assay.targetName + "\u0000" + assay.panelSignature, target: assay.targetName, panel: assay.panelSignature, label: label };
    });
    var bySample = {};
    detailRows.forEach(function (detail) {
      var sample = detail["Sample ID"];
      if (!bySample[sample]) bySample[sample] = [];
      bySample[sample].push(detail);
    });
    var headers = ["Sample ID", "Sample CN 概要", "样本自动结论", "批次状态"];
    units.forEach(function (unit) {
      headers.push(unit.label + " · CN判定", unit.label + " · 连续CN", unit.label + " · 结果状态");
    });
    headers = headers.concat(["Run ID", "Plate ID", "Analysis ID"]);
    var rows = Object.keys(bySample).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).map(function (sample) {
      var details = bySample[sample];
      var row = {
        "Sample ID": sample,
        "Sample CN 概要": "",
        "样本自动结论": "CN 已判定",
        "批次状态": analysis.releaseStatus === "HOLD" ? "HOLD · 不可放行" : "READY_FOR_REVIEW · 待人工复核"
      };
      var summaryParts = [];
      units.forEach(function (unit) {
        var detail = details.filter(function (item) { return item.Target === unit.target && item["反应组合"] === unit.panel; })[0];
        var call = detail ? detail["CN 判定"] : "No call";
        row[unit.label + " · CN判定"] = call;
        row[unit.label + " · 连续CN"] = detail ? detail["连续 CN"] : null;
        row[unit.label + " · 结果状态"] = detail ? detail["结果状态"] : "未找到结果";
        summaryParts.push(unit.label + "=" + call);
      });
      if (details.some(function (item) { return item["结果状态"] === "内参无效"; })) row["样本自动结论"] = "内参无效 · No call";
      else if (details.some(function (item) { return ["未校准", "No call", "部分扩增 · No call"].indexOf(item["结果状态"]) >= 0; })) row["样本自动结论"] = "含 No call / 未校准";
      else if (details.some(function (item) { return item["结果状态"] === "0-copy 候选"; })) row["样本自动结论"] = "含 0-copy 候选";
      else if (details.some(function (item) { return ["通过", "0 copy"].indexOf(item["结果状态"]) < 0; })) row["样本自动结论"] = "已有 CN · 需复核质量提示";
      row["Sample CN 概要"] = summaryParts.join("；");
      row["Run ID"] = audit.runId;
      row["Plate ID"] = audit.plateId;
      row["Analysis ID"] = audit.analysisId;
      return row;
    });
    return { rows: rows, headers: headers };
  }

  function replicateQcRows(analysis, audit) {
    var rows = [];
    (analysis.assays || []).forEach(function (assay) {
      assay.results.forEach(function (result) {
        var targetValues = result.wells.map(function (well) { return well.targetCt; }).filter(function (value) { return value !== null; });
        var referenceValues = result.wells.map(function (well) { return well.referenceCt; }).filter(function (value) { return value !== null; });
        var deltaValues = result.wells.map(function (well) { return well.deltaCt; }).filter(function (value) { return value !== null; });
        var targetMean = mean(targetValues);
        var targetSd = sampleSd(targetValues);
        var referenceMean = mean(referenceValues);
        var referenceSd = sampleSd(referenceValues);
        rows.push({
          "Sample ID": result.sampleName,
          "Target": result.targetName,
          "反应组合": result.panelSignature,
          "孔位": result.wells.map(function (well) { return well.wellPosition; }).join(" / "),
          "Target Ct 列表": targetValues.map(function (value) { return round(value, 4); }).join(" / "),
          "Target Ct mean": round(targetMean, 4),
          "Target Ct SD": round(targetSd, 4),
          "Target Ct CV": targetMean && targetSd !== null ? round(targetSd / targetMean, 4) : null,
          "Target 最大 Ct 差": targetValues.length > 1 ? round(Math.max.apply(null, targetValues) - Math.min.apply(null, targetValues), 4) : null,
          "Reference Ct 列表": referenceValues.map(function (value) { return round(value, 4); }).join(" / "),
          "Reference Ct mean": round(referenceMean, 4),
          "Reference Ct SD": round(referenceSd, 4),
          "Reference Ct CV": referenceMean && referenceSd !== null ? round(referenceSd / referenceMean, 4) : null,
          "ΔCt 列表": deltaValues.map(function (value) { return round(value, 4); }).join(" / "),
          "Mean ΔCt": round(result.meanDeltaCt, 4),
          "SD(ΔCt)": round(result.deltaCtSd, 4),
          "SD(ΔCt)预警阈值": analysis.settings.replicateSdWarn,
          "有效复孔": (result.classification === "ZERO" ? result.zeroEvidenceCount : result.validCount) + "/" + result.totalWells,
          "自动结论": EXPORT_QUALITY_LABELS[result.qualityStatus] || result.qualityStatus,
          "0-copy 依据": result.classification === "ZERO" ? result.zeroCopyBasis + (result.zeroCallConfirmed ? "；同 assay / panel 存在有效阳性校准且复孔数达标" : "；尚未满足有效阳性校准与最低复孔数的全部条件") : "",
          "Flags": result.flags.join(";"),
          "Run ID": audit.runId,
          "Plate ID": audit.plateId,
          "Analysis ID": audit.analysisId
        });
      });
    });
    rows.sort(function (a, b) { return String(a["Sample ID"]).localeCompare(String(b["Sample ID"]), undefined, { numeric: true }) || String(a.Target).localeCompare(String(b.Target)); });
    return rows;
  }

  function rawCtRows(analysis, audit) {
    return (analysis.records || []).slice().sort(function (a, b) { return (a.wellNumber || 0) - (b.wellNumber || 0) || String(a.targetName).localeCompare(String(b.targetName)); }).map(function (record) {
      return {
        "Well": record.wellPosition,
        "Well number": record.wellNumber,
        "Sample ID": record.sampleName,
        "样本角色": record.sampleRole || "SAMPLE",
        "角色来源": record.roleSource || "",
        "Task": record.task,
        "Target": record.targetName,
        "Reporter": record.reporter,
        "Quencher": record.quencher,
        "Ct": record.ct,
        "Ct raw": record.ctRaw,
        "Ct mean(source)": record.ctMeanSource,
        "Ct SD(source)": record.ctSdSource,
        "ΔCt(source)": record.deltaCtSource,
        "Mean ΔCt(source)": record.deltaCtMeanSource,
        "SD(ΔCt)(source)": record.deltaCtSdSource,
        "ΔΔCt(source)": record.deltaDeltaCtSource,
        "RQ(source)": record.rqSource,
        "RQ min(source)": record.rqMinSource,
        "RQ max(source)": record.rqMaxSource,
        "Amp Status": record.ampStatus,
        "Cq Confidence": record.cqConfidence,
        "THOLDFAIL": record.flags && record.flags.THOLDFAIL ? "Y" : "N",
        "CQCONF": record.flags && record.flags.CQCONF ? "Y" : "N",
        "NOAMP": record.flags && record.flags.NOAMP ? "Y" : "N",
        "EXPFAIL": record.flags && record.flags.EXPFAIL ? "Y" : "N",
        "Omit": record.omit ? "Y" : "N",
        "Automatic Ct Threshold": record.automaticCtThreshold ? "Y" : "N",
        "Ct Threshold": record.ctThreshold,
        "Automatic Baseline": record.automaticBaseline ? "Y" : "N",
        "Baseline Start": record.baselineStart,
        "Baseline End": record.baselineEnd,
        "Comments": record.comments,
        "反应组合": record.panelSignature,
        "源文件行": record.sourceRow,
        "Run ID": audit.runId,
        "Plate ID": audit.plateId,
        "Analysis ID": audit.analysisId
      };
    });
  }

  function ntcAuditRows(analysis, audit) {
    var assignment = analysis.ntcSummary.assignment || {};
    return (analysis.records || []).filter(function (record) { return record.sampleRole === "NTC"; }).map(function (record) {
      return {
        "Well": record.wellPosition,
        "Well number": record.wellNumber,
        "原样本名": record.sampleName,
        "角色来源": record.roleSource,
        "NTC 指定方式": record.ntcAssignmentMode || "source_file",
        "人工确认": /MANUAL_/.test(record.roleSource || "") ? (assignment.confirmed === true ? "Y" : "N") : "N/A",
        "指定依据": record.ntcAssignmentNote || "",
        "反应组合": record.panelSignature,
        "Target": record.targetName,
        "Reporter": record.reporter,
        "Ct": record.ct,
        "Amp Status": record.ampStatus,
        "NTC QC": record.ct !== null ? "BLOCKER_AMPLIFICATION" : "CLEAR_NO_NUMERIC_CT",
        "源文件行": record.sourceRow,
        "Run ID": audit.runId,
        "Plate ID": audit.plateId,
        "Analysis ID": audit.analysisId
      };
    });
  }

  function calibrationRows(analysis, audit) {
    return (analysis.assays || []).map(function (assay) {
      var config = assay.calibration.config || {};
      var selected = config.mode === "sample" ? config.sampleName : (config.mode === "group" ? (config.sampleNames || []).join(";") : "");
      return {
        "Target": assay.targetName,
        "反应组合": assay.panelSignature,
        "校准方式": assay.calibration.mode,
        "校准有效": assay.calibration.ok ? "Y" : "N",
        "所选校准样本/组": selected,
        "已知 CN": config.copyNumber,
        "独立确认": config.independentlyConfirmed === true ? "Y" : (config.mode === "population" ? "N/A" : "N"),
        "确认依据/记录编号": config.confirmationEvidence || "",
        "选择备注/替换原因": config.selectionNote || "",
        "预期众数 CN": config.expectedMostFrequentCopyNumber,
        "校准标签": assay.calibration.label || "",
        "K": assay.calibration.K,
        "仪器记录 Reference Sample": assay.calibration.recordedReference,
        "错误": assay.calibration.errors.join("; "),
        "警告": assay.calibration.warnings.join("; "),
        "板内 ΔCt SD": assay.plateDeltaCtSd,
        "质量模型": assay.qualityModel && assay.qualityModel.ok ? "available" : (assay.qualityModel ? assay.qualityModel.reason : "not fitted"),
        "Run ID": audit.runId,
        "Plate ID": audit.plateId,
        "Analysis ID": audit.analysisId
      };
    });
  }

  function batchQcRows(analysis, audit) {
    var rows = [{
      "QC 项目": "整批结论",
      "检查对象": "全部必要质控与校准",
      "观察结果": analysis.releaseStatus,
      "状态": analysis.releaseStatus === "HOLD" ? "FAIL" : "REVIEW",
      "说明/建议": analysis.releaseStatus === "HOLD" ? "存在 blocker 或未通过校准；不可正式放行。" : "未发现 blocker 且校准有效；仍需人工复核。",
      "Run ID": audit.runId,
      "Plate ID": audit.plateId,
      "Analysis ID": audit.analysisId
    }];
    var ntcRecords = (analysis.records || []).filter(function (record) { return record.sampleRole === "NTC"; });
    var ntcAmp = ntcRecords.filter(function (record) { return record.ct !== null; });
    rows.push({
      "QC 项目": "NTC",
      "检查对象": "无模板对照",
      "观察结果": ntcRecords.length ? (analysis.ntcSummary.physicalWellCount + " 个物理孔；" + (ntcAmp.length ? ntcAmp.length + " 条记录出现数值 Ct" : "未见数值 Ct")) : "未识别到 NTC",
      "状态": ntcAmp.length ? "FAIL" : (ntcRecords.length ? "PASS" : "WARNING"),
      "说明/建议": ntcRecords.length ? "结合各反应组合覆盖情况复核。" : "不单独触发 HOLD，但无法据此排除污染或非特异扩增。",
      "Run ID": audit.runId,
      "Plate ID": audit.plateId,
      "Analysis ID": audit.analysisId
    });
    (analysis.assays || []).forEach(function (assay) {
      rows.push({
        "QC 项目": "校准：" + assay.targetName,
        "检查对象": assay.panelSignature,
        "观察结果": assay.calibration.label || assay.calibration.errors.join("; "),
        "状态": assay.calibration.ok ? "PASS" : "FAIL",
        "说明/建议": assay.calibration.warnings.join("; "),
        "Run ID": audit.runId,
        "Plate ID": audit.plateId,
        "Analysis ID": audit.analysisId
      });
    });
    (analysis.runIssues || []).forEach(function (issue) {
      rows.push({
        "QC 项目": issue.code,
        "检查对象": "板级结构/仪器元数据",
        "观察结果": issue.message,
        "状态": issue.severity === "blocker" ? "FAIL" : (issue.severity === "warning" ? "WARNING" : "INFO"),
        "说明/建议": "按实验室 SOP 与原始扩增曲线复核。",
        "Run ID": audit.runId,
        "Plate ID": audit.plateId,
        "Analysis ID": audit.analysisId
      });
    });
    return rows;
  }

  function approvalBlockers(analysis, registration, requireReviewedStatus) {
    var blockers = [];
    if (analysis.releaseStatus === "HOLD") blockers.push("自动质控为 HOLD");
    if (registration.approvalInvalidated === true) blockers.push("分析或登记变更后尚未重新复核");
    [
      ["experimentDate", "实验日期"], ["operator", "操作人"], ["plateId", "Plate ID"],
      ["reactionVolume", "反应体积"], ["protocolVersion", "Protocol/SOP 版本"],
      ["masterMixBrand", "Master Mix 品牌"], ["masterMixCatalog", "Master Mix Cat."],
      ["masterMixLot", "Master Mix 批号"], ["masterMixExpiry", "Master Mix 有效期"],
      ["reviewer", "复核人"], ["reviewDate", "复核日期"]
    ].forEach(function (item) {
      if (!String(registration[item[0]] || "").trim()) blockers.push(item[1] + "未填写");
    });
    (registration.assays || []).forEach(function (assay) {
      [["brand", "品牌"], ["assayId", "Assay ID"], ["lot", "批号"], ["concentration", "浓度"]].forEach(function (item) {
        if (!String(assay[item[0]] || "").trim()) blockers.push(assay.target + " " + item[1] + "未填写");
      });
    });
    (analysis.assays || []).forEach(function (assay) {
      var config = assay.calibration.config || {};
      if (["sample", "group", "population"].indexOf(config.mode) >= 0 && !String(config.confirmationEvidence || "").trim()) {
        blockers.push(assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "") + " 校准依据未填写");
      }
    });
    if (requireReviewedStatus && registration.recordStatus !== "已复核") blockers.push("记录状态不是已复核");
    return unique(blockers);
  }

  function registrationRows(analysis, context, audit) {
    var registration = context.registration || {};
    var metadata = analysis.metadata || {};
    var thresholdMap = {};
    (analysis.records || []).forEach(function (record) {
      if (record.reporter && record.ctThreshold !== null) thresholdMap[record.reporter] = round(record.ctThreshold, 5);
    });
    var thresholds = Object.keys(thresholdMap).sort().map(function (reporter) { return reporter + "=" + thresholdMap[reporter]; }).join("；");
    var omitted = (analysis.records || []).filter(function (record) { return record.omit; });
    var instrument = joinExportParts([getMetadata(metadata, "Instrument Type"), getMetadata(metadata, "Instrument Serial Number")], " / ");
    var experimentMode = joinExportParts([getMetadata(metadata, "Experiment Type"), getMetadata(metadata, "Analysis Type")], " / ");
    var reagentRows = (registration.assays || []).map(function (assay) {
      return {
        "字段": assay.target + " assay / 试剂",
        "本次记录": joinExportParts([
          exportValue(assay.brand, "品牌待填写"),
          exportValue(assay.assayId, "Assay ID待填写"),
          exportValue(assay.lot, "批号待填写"),
          exportValue(assay.concentration, "浓度待填写"),
          exportValue(assay.reporter, "Reporter未记录"),
          exportValue(assay.quencher, "Quencher未记录")
        ]),
        "来源": "Target/Reporter来自仪器；其余为人工登记"
      };
    });
    var releaseBlockers = approvalBlockers(analysis, registration, false);
    var recordedDecision = exportValue(registration.finalDecision, "待复核");
    if (recordedDecision === "同意放行") {
      var finalBlockers = approvalBlockers(analysis, registration, true);
      if (finalBlockers.length) recordedDecision = "待复核（放行条件未满足：" + finalBlockers.join("；") + "）";
    }
    var rows = [
      { "字段": "记录版本 / 状态", "本次记录": exportValue(registration.protocolVersion, "待填写") + " / " + exportValue(registration.recordStatus, "草稿"), "来源": "人工登记" },
      { "字段": "Run ID / Plate ID / Analysis ID", "本次记录": audit.runId + " / " + audit.plateId + " / " + audit.analysisId, "来源": "自动 + 人工" },
      { "字段": "实验日期 / 操作人", "本次记录": exportValue(registration.experimentDate, "待填写") + " / " + exportValue(registration.operator, "待填写"), "来源": "自动建议 + 人工确认" },
      { "字段": "仪器型号 / 编号 / Block", "本次记录": joinExportParts([exportValue(instrument, "未记录"), getMetadata(metadata, "Block Type")]), "来源": "仪器文件" },
      { "字段": "板型 / 反应体积 / Experiment type", "本次记录": analysis.plateFormat + "-well / " + exportValue(registration.reactionVolume, "反应体积待填写") + " / " + exportValue(experimentMode, "未记录"), "来源": "自动 + 人工" },
      { "字段": "Master Mix：品牌 / Cat. / 批号 / 有效期", "本次记录": joinExportParts([exportValue(registration.masterMixBrand, "品牌待填写"), exportValue(registration.masterMixCatalog, "Cat.待填写"), exportValue(registration.masterMixLot, "批号待填写"), exportValue(registration.masterMixExpiry, "有效期待填写")]), "来源": "人工登记" }
    ].concat(reagentRows);
    (analysis.assays || []).forEach(function (assay) {
      var config = assay.calibration.config || {};
      rows.push({
        "字段": assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "") + " 校准",
        "本次记录": joinExportParts([assay.calibration.ok ? "通过" : "未通过", assay.calibration.label || assay.calibration.mode, config.confirmationEvidence || "确认依据待填写", config.selectionNote || ""]),
        "来源": "自动分析 + 人工确认"
      });
    });
    rows = rows.concat([
      { "字段": "NTC 孔位与结果", "本次记录": analysis.ntcSummary.physicalWellCount ? (analysis.ntcSummary.physicalWellCount + " 个物理孔；详见 NTC审计") : "未识别到 NTC；按当前规则记为 warning，不单独触发 HOLD", "来源": "自动分析" },
      { "字段": "Baseline / Threshold", "本次记录": (thresholds || "阈值未记录") + "；Automatic Baseline=" + ((analysis.records || []).every(function (record) { return record.automaticBaseline; }) ? "On" : "存在 Off/未记录"), "来源": "仪器文件" },
      { "字段": "孔排除规则 / 实际排除孔", "本次记录": omitted.length ? (omitted.length + " 条记录；" + unique(omitted.map(function (record) { return record.wellPosition; })).join("、")) : "源文件未标记 Omit", "来源": "仪器文件 + 自动统计" },
      { "字段": "原始文件 / 工作表", "本次记录": exportValue(context.fileName, "未记录") + " / " + exportValue(context.sheetName, "未记录"), "来源": "自动记录" },
      { "字段": "整板自动质控结论", "本次记录": analysis.releaseStatus === "HOLD" ? "HOLD · 不可放行" : "READY_FOR_REVIEW · 待人工复核", "来源": "自动分析" },
      { "字段": "放行条件检查", "本次记录": releaseBlockers.length ? "未通过：" + releaseBlockers.join("；") : "通过；可由复核人决定是否放行", "来源": "自动防错" },
      { "字段": "人工复核结论", "本次记录": recordedDecision + (registration.reviewNote ? "；" + registration.reviewNote : ""), "来源": "人工登记 + 自动防错" },
      { "字段": "实验/分析备注", "本次记录": exportValue(registration.notes, "无"), "来源": "人工登记" },
      { "字段": "复核人 / 复核日期", "本次记录": exportValue(registration.reviewer, "待复核") + " / " + exportValue(registration.reviewDate, "待填写"), "来源": "人工登记" }
    ]);
    return rows;
  }

  function parameterRows(analysis, audit) {
    var rows = Object.keys(analysis.settings || {}).filter(function (key) { return key !== "calibrations" && key !== "ntcAssignment"; }).map(function (key) {
      var value = analysis.settings[key];
      return { "参数": key, "值": Array.isArray(value) ? value.join(";") : value, "Run ID": audit.runId, "Plate ID": audit.plateId, "Analysis ID": audit.analysisId };
    });
    var assignment = analysis.ntcSummary.assignment || {};
    rows.push({ "参数": "ntc_assignment", "值": JSON.stringify(assignment), "Run ID": audit.runId, "Plate ID": audit.plateId, "Analysis ID": audit.analysisId });
    return rows;
  }

  function metadataRows(analysis, audit) {
    return Object.keys(analysis.metadata || {}).map(function (key) {
      return { "字段": key, "值": analysis.metadata[key], "Run ID": audit.runId, "Plate ID": audit.plateId, "Analysis ID": audit.analysisId };
    });
  }

  function methodRows(analysis, context, audit) {
    return [
      { "项目": "Software", "内容": "CNV分析工具 v " + VERSION },
      { "项目": "Generated at", "内容": audit.generatedAt },
      { "项目": "Source file", "内容": context.fileName || "" },
      { "项目": "Source sheet", "内容": context.sheetName || "" },
      { "项目": "Release status", "内容": analysis.releaseStatus },
      { "项目": "Formula", "内容": "ΔCt=Ct_target-Ct_reference；ΔΔCt=meanΔCt_sample-meanΔCt_calibrator；CN=CN_calibrator×2^(-ΔΔCt)" },
      { "项目": "Ct CV", "内容": "Ct CV=样本SD/Mean Ct，仅描述 Ct 尺度离散度；放行仍结合 SD(ΔCt)、扩增曲线、内参、NTC 和校准品。" },
      { "项目": "Method boundary", "内容": analysis.methodBoundary },
      { "项目": "Sample CN fields", "内容": "首页一行对应一个 Sample；CN 判定为离散拷贝数，连续 CN 保留未取整值。全部可分析复孔 target 未检出/仅背景、内参有效、复孔数达标且同 assay/panel 阳性校准有效时可判定 0 copy；条件不足时保留 0-copy 候选。No call/内参无效/未校准不得解释为正式 CN。" },
      { "项目": "RUO", "内容": "For Research Use Only. Not for diagnostic procedures." },
      { "项目": "Run / Plate / Analysis", "内容": audit.runId + " / " + audit.plateId + " / " + audit.analysisId }
    ];
  }

  function buildIntegratedExport(analysis, contextInput) {
    var context = contextInput || {};
    var audit = auditIdentity(analysis, context);
    var summary = sampleCnSummary(analysis, audit);
    var sheets = [
      { name: "样本CN汇总", rows: summary.rows, headers: summary.headers },
      { name: "运行登记", rows: registrationRows(analysis, context, audit), headers: ["字段", "本次记录", "来源"] },
      { name: "批次质控", rows: batchQcRows(analysis, audit), headers: ["QC 项目", "检查对象", "观察结果", "状态", "说明/建议", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "CN计算明细", rows: sampleCnRows(analysis, audit), headers: ["Sample ID", "Target", "反应组合", "CN 判定", "连续 CN", "结果状态", "0-copy 依据", "批次状态", "有效复孔", "Target Ct mean", "Reference Ct mean", "Mean ΔCt", "SD(ΔCt)", "ΔΔCt", "RQ", "CN 区间", "Confidence-like", "|Z|", "校准", "Flags", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "复孔质控", rows: replicateQcRows(analysis, audit), headers: ["Sample ID", "Target", "反应组合", "孔位", "Target Ct 列表", "Target Ct mean", "Target Ct SD", "Target Ct CV", "Target 最大 Ct 差", "Reference Ct 列表", "Reference Ct mean", "Reference Ct SD", "Reference Ct CV", "ΔCt 列表", "Mean ΔCt", "SD(ΔCt)", "SD(ΔCt)预警阈值", "有效复孔", "自动结论", "0-copy 依据", "Flags", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "原始Ct", rows: rawCtRows(analysis, audit), headers: ["Well", "Well number", "Sample ID", "样本角色", "角色来源", "Task", "Target", "Reporter", "Quencher", "Ct", "Ct raw", "Ct mean(source)", "Ct SD(source)", "ΔCt(source)", "Mean ΔCt(source)", "SD(ΔCt)(source)", "ΔΔCt(source)", "RQ(source)", "RQ min(source)", "RQ max(source)", "Amp Status", "Cq Confidence", "THOLDFAIL", "CQCONF", "NOAMP", "EXPFAIL", "Omit", "Automatic Ct Threshold", "Ct Threshold", "Automatic Baseline", "Baseline Start", "Baseline End", "Comments", "反应组合", "源文件行", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "NTC审计", rows: ntcAuditRows(analysis, audit), headers: ["Well", "Well number", "原样本名", "角色来源", "NTC 指定方式", "人工确认", "指定依据", "反应组合", "Target", "Reporter", "Ct", "Amp Status", "NTC QC", "源文件行", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "校准记录", rows: calibrationRows(analysis, audit), headers: ["Target", "反应组合", "校准方式", "校准有效", "所选校准样本/组", "已知 CN", "独立确认", "确认依据/记录编号", "选择备注/替换原因", "预期众数 CN", "校准标签", "K", "仪器记录 Reference Sample", "错误", "警告", "板内 ΔCt SD", "质量模型", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "分析参数", rows: parameterRows(analysis, audit), headers: ["参数", "值", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "仪器元数据", rows: metadataRows(analysis, audit), headers: ["字段", "值", "Run ID", "Plate ID", "Analysis ID"] },
      { name: "方法说明", rows: methodRows(analysis, context, audit), headers: ["项目", "内容"] }
    ];
    return { audit: audit, sheets: sheets };
  }

  return {
    VERSION: VERSION,
    DEFAULTS: DEFAULTS,
    parseAoA: parseAoA,
    analyze: analyze,
    inferPlateFormat: inferPlateFormat,
    inferReferenceName: inferReferenceName,
    parseWellPosition: parseWellPosition,
    flattenResults: flattenResults,
    flattenWells: flattenWells,
    buildIntegratedExport: buildIntegratedExport,
    helpers: {
      normalizeKey: normalizeKey,
      toNumber: toNumber,
      toBoolean: toBoolean,
      mean: mean,
      median: median,
      sampleSd: sampleSd,
      round: round,
      fitPopulationCalibration: fitPopulationCalibration
    }
  };
});

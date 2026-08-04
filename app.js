(function () {
  "use strict";

  var core = window.CopyNumberCore;
  var REGISTRATION_STORAGE_KEY = "cnv-analysis-registration-presets-v1";
  var REGISTRATION_RECORDS_STORAGE_KEY = "cnv-analysis-registration-records-v1";
  var state = {
    fileName: "",
    fileFingerprint: "",
    sheetName: "",
    parsed: null,
    analysis: null,
    settings: Object.assign({}, core.DEFAULTS, { calibrations: {} }),
    registration: null,
    registrationSavedAt: "",
    registrationDirty: false
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return "—";
    return Number(value).toFixed(digits === undefined ? 3 : digits);
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

  function toast(message) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.classList.remove("is-visible"); }, 2800);
  }

  function setFileStatus(kind, text) {
    var el = $("#file-status");
    el.innerHTML = '<span class="status-dot status-dot--' + kind + '"></span><span>' + escapeHtml(text) + "</span>";
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function baseFileName() {
    return (state.fileName || "CNV_analysis").replace(/\.[^.]+$/, "").replace(/[^\w\-\u4e00-\u9fff]+/g, "_");
  }

  function loadRegistrationPresets() {
    try { return JSON.parse(localStorage.getItem(REGISTRATION_STORAGE_KEY) || "{}"); }
    catch (error) { return {}; }
  }

  function saveRegistrationPresets() {
    if (!state.registration) return;
    var assayPresets = {};
    (state.registration.assays || []).forEach(function (assay) {
      assayPresets[assay.key] = {
        brand: assay.brand || "",
        assayId: assay.assayId || "",
        concentration: assay.concentration || "",
        quencher: assay.quencher || ""
      };
    });
    try {
      localStorage.setItem(REGISTRATION_STORAGE_KEY, JSON.stringify({
        operator: state.registration.operator || "",
        reactionVolume: state.registration.reactionVolume || "",
        protocolVersion: state.registration.protocolVersion || "",
        masterMixBrand: state.registration.masterMixBrand || "",
        masterMixCatalog: state.registration.masterMixCatalog || "",
        assays: assayPresets
      }));
    } catch (error) {
      // Local browser storage is only a convenience; export must remain usable without it.
    }
  }

  function loadRegistrationRecords() {
    try { return JSON.parse(localStorage.getItem(REGISTRATION_RECORDS_STORAGE_KEY) || "{}"); }
    catch (error) { return {}; }
  }

  function currentRegistrationRecordKey() {
    return state.fileFingerprint || ((state.fileName || "未命名文件") + "|" + (state.registration ? state.registration.runId : ""));
  }

  function restoreRegistrationRecord() {
    var saved = loadRegistrationRecords()[currentRegistrationRecordKey()];
    if (!saved || !saved.registration) return false;
    var restored = saved.registration;
    var scalarFields = [
      "runId", "plateId", "analysisId", "experimentDate", "operator", "reactionVolume", "protocolVersion", "recordStatus",
      "masterMixBrand", "masterMixCatalog", "masterMixLot", "masterMixExpiry", "finalDecision", "reviewer", "reviewDate", "reviewNote", "notes", "approvalInvalidated"
    ];
    scalarFields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(restored, field)) state.registration[field] = restored[field];
    });
    var savedAssays = {};
    (restored.assays || []).forEach(function (assay) { savedAssays[assay.key] = assay; });
    state.registration.assays = (state.registration.assays || []).map(function (assay) {
      var prior = savedAssays[assay.key] || {};
      return Object.assign({}, assay, {
        brand: prior.brand || assay.brand || "",
        assayId: prior.assayId || assay.assayId || "",
        lot: prior.lot || "",
        concentration: prior.concentration || assay.concentration || "",
        quencher: prior.quencher || assay.quencher || ""
      });
    });
    if (saved.settings) {
      state.settings = Object.assign({}, core.DEFAULTS, saved.settings);
      state.settings.calibrations = saved.settings.calibrations || {};
      state.settings.ntcAssignment = saved.settings.ntcAssignment || core.DEFAULTS.ntcAssignment;
    }
    state.registrationSavedAt = saved.savedAt || "";
    state.registrationDirty = false;
    return true;
  }

  function updateRegistrationSaveStatus() {
    var status = $("#record-save-status");
    if (!status) return;
    if (state.registrationDirty) {
      status.textContent = "有未保存更改";
      status.className = "record-save-status record-save-status--dirty";
      return;
    }
    if (state.registrationSavedAt) {
      var savedDate = new Date(state.registrationSavedAt);
      status.textContent = "已保存到本机 · " + (isNaN(savedDate.getTime()) ? state.registrationSavedAt : savedDate.toLocaleString("zh-CN", { hour12: false }));
      status.className = "record-save-status record-save-status--saved";
      return;
    }
    status.textContent = "本次登记尚未保存";
    status.className = "record-save-status";
  }

  function invalidateApproval(options) {
    if (!state.registration) return false;
    var r = state.registration;
    var wasApproved = r.finalDecision === "同意放行" || r.recordStatus === "已复核";
    if (!wasApproved) return false;
    r.finalDecision = "待复核";
    r.recordStatus = "已记录";
    r.approvalInvalidated = true;
    if (!(options && options.preserveReviewDate)) r.reviewDate = "";
    if ($("#record-status")) $("#record-status").value = r.recordStatus;
    if ($("#record-review-date")) $("#record-review-date").value = r.reviewDate;
    updateFinalDecisionOptions();
    updateRegistrationStatus();
    return true;
  }

  function markRegistrationDirty(options) {
    if (!state.registration) return;
    invalidateApproval(options && options.invalidateApproval ? options : null);
    state.registrationDirty = true;
    updateRegistrationSaveStatus();
  }

  function fallbackFileFingerprint(file) {
    return [file.name, file.size || 0, file.lastModified || 0].join("|");
  }

  function computeFileFingerprint(arrayBuffer, file) {
    var fallback = fallbackFileFingerprint(file);
    if (!window.crypto || !window.crypto.subtle || !window.crypto.subtle.digest) return Promise.resolve(fallback);
    return window.crypto.subtle.digest("SHA-256", arrayBuffer).then(function (digest) {
      var hex = Array.prototype.map.call(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
      return "sha256:" + hex;
    }).catch(function () { return fallback; });
  }

  function saveCurrentRegistrationRecord() {
    if (!state.registration || !state.analysis) return;
    syncRegistrationFromUi();
    var records = loadRegistrationRecords();
    var savedAt = new Date().toISOString();
    records[currentRegistrationRecordKey()] = {
      savedAt: savedAt,
      sourceFile: state.fileName,
      registration: JSON.parse(JSON.stringify(state.registration)),
      settings: JSON.parse(JSON.stringify(state.settings))
    };
    var orderedKeys = Object.keys(records).sort(function (a, b) {
      return String(records[b].savedAt || "").localeCompare(String(records[a].savedAt || ""));
    });
    orderedKeys.slice(20).forEach(function (key) { delete records[key]; });
    try {
      localStorage.setItem(REGISTRATION_RECORDS_STORAGE_KEY, JSON.stringify(records));
      state.registrationSavedAt = savedAt;
      state.registrationDirty = false;
      updateRegistrationSaveStatus();
      toast("本次登记与分析设置已保存到当前浏览器。");
    } catch (error) {
      toast("本机保存失败；请直接导出 XLSX 保留记录。");
    }
  }

  function metadataValue(metadata, key) {
    if (!metadata) return "";
    var wanted = String(key).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
    var found = Object.keys(metadata).filter(function (candidate) { return String(candidate).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "") === wanted; })[0];
    return found ? metadata[found] : "";
  }

  function inferExperimentDate(metadata, fileName) {
    var source = String(metadataValue(metadata, "Date Created") || fileName || "");
    var match = source.match(/(20\d{2})[-_/](\d{2})[-_/](\d{2})/);
    if (match) return match[1] + "-" + match[2] + "-" + match[3];
    match = source.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    if (match) return match[1] + "-" + match[2] + "-" + match[3];
    return "";
  }

  function createAnalysisId(runId) {
    var stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return "CNV-" + String(runId || "RUN").replace(/[^\w\-\u4e00-\u9fff]+/g, "_") + "-" + stamp;
  }

  function initializeRegistration() {
    var presets = loadRegistrationPresets();
    var metadata = state.parsed ? state.parsed.metadata : {};
    var runId = metadataValue(metadata, "Experiment Name") || baseFileName();
    var assayMap = {};
    (state.parsed ? state.parsed.records : []).forEach(function (record) {
      var key = record.targetName + "|" + record.reporter;
      if (assayMap[key]) return;
      var preset = (presets.assays || {})[key] || {};
      assayMap[key] = {
        key: key,
        target: record.targetName,
        reporter: record.reporter,
        quencher: preset.quencher || record.quencher || "",
        brand: preset.brand || "",
        assayId: preset.assayId || "",
        lot: "",
        concentration: preset.concentration || ""
      };
    });
    state.registration = {
      runId: runId,
      plateId: "",
      analysisId: createAnalysisId(runId),
      experimentDate: inferExperimentDate(metadata, state.fileName),
      operator: presets.operator || "",
      reactionVolume: presets.reactionVolume || "",
      protocolVersion: presets.protocolVersion || "",
      recordStatus: "草稿",
      masterMixBrand: presets.masterMixBrand || "",
      masterMixCatalog: presets.masterMixCatalog || "",
      masterMixLot: "",
      masterMixExpiry: "",
      assays: Object.keys(assayMap).sort().map(function (key) { return assayMap[key]; }),
      finalDecision: "待复核",
      approvalInvalidated: false,
      reviewer: "",
      reviewDate: "",
      reviewNote: "",
      notes: ""
    };
  }

  function parseWorkbook(arrayBuffer, fileName) {
    var workbook = XLSX.read(arrayBuffer, { type: "array", raw: true, cellDates: false, dense: false });
    var candidates = [];
    var failures = [];
    workbook.SheetNames.forEach(function (sheetName) {
      var aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true });
      try {
        var parsed = core.parseAoA(aoa);
        candidates.push({ sheetName: sheetName, parsed: parsed, rows: parsed.records.length });
      } catch (error) {
        failures.push(sheetName + ": " + error.message);
      }
    });
    if (!candidates.length) throw new Error("工作簿中没有可识别的孔级 Ct 结果表。" + (failures.length ? " " + failures.join(" | ") : ""));
    candidates.sort(function (a, b) { return b.rows - a.rows; });
    state.fileName = fileName;
    state.sheetName = candidates[0].sheetName;
    return candidates[0].parsed;
  }

  function handleFile(file) {
    if (!file) return;
    state.fileFingerprint = fallbackFileFingerprint(file);
    state.registrationSavedAt = "";
    state.registrationDirty = false;
    setFileStatus("loading", "正在本地解析 " + file.name + " …");
    var reader = new FileReader();
    reader.onerror = function () { setFileStatus("error", "文件读取失败。"); };
    reader.onload = async function () {
      try {
        state.fileFingerprint = await computeFileFingerprint(reader.result, file);
        state.parsed = parseWorkbook(reader.result, file.name);
        state.settings = Object.assign({}, core.DEFAULTS, { calibrations: {} });
        initializeRegistration();
        var restored = restoreRegistrationRecord();
        runAnalysis();
        setFileStatus("ok", file.name + " · 工作表 " + state.sheetName + " · 表头位于第 " + state.parsed.headerRow + " 行" + (restored ? " · 已恢复本机登记" : ""));
        $("#workspace").classList.remove("is-hidden");
        $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        console.error(error);
        setFileStatus("error", error.message);
        toast("导入失败：" + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function runAnalysis() {
    if (!state.parsed) return;
    state.analysis = core.analyze(state.parsed.records, state.parsed.metadata, state.settings);
    state.settings.referenceName = state.analysis.referenceName;
    renderAll();
  }

  function renderAll() {
    renderSummary();
    renderQc();
    renderNtcSetup();
    renderMetadata();
    renderSettings();
    renderCalibration();
    renderRegistration();
    renderResultsFilter();
    renderResultsTable();
    renderCopyNumberPlot();
    renderDeltaCtPlot();
    renderPlateMap();
    renderWellTable();
    renderMethodNotes();
  }

  function renderSummary() {
    var a = state.analysis;
    $("#stat-wells").textContent = a.wellsUsed;
    $("#stat-capacity").textContent = "/ " + a.plateCapacity + " 孔板";
    $("#stat-samples").textContent = a.sampleCount;
    $("#stat-assays").textContent = a.assays.length;
    $("#stat-reference").textContent = a.referenceName || "未确定";
    $("#stat-release").textContent = a.releaseStatus === "HOLD" ? "HOLD · 不可放行" : "待人工复核";
    var card = $(".summary-release");
    card.classList.toggle("is-hold", a.releaseStatus === "HOLD");
    card.classList.toggle("is-ready", a.releaseStatus !== "HOLD");
  }

  function issueTitle(issue) {
    var titles = {
      EXPIRED_DYE_CALIBRATION: "通道校准过期",
      EXPIRED_INSTRUMENT_CALIBRATION: "仪器校准过期",
      CT_THRESHOLD_INCONSISTENT: "同一 assay 的 Ct 阈值不一致",
      AUTO_BASELINE_OFF: "自动基线未启用",
      NO_NTC: "未识别到 NTC",
      NTC_RECOGNIZED: "NTC 已识别",
      MANUAL_NTC_ASSIGNMENT: "人工 NTC 已应用",
      NTC_ASSIGNMENT_UNCONFIRMED: "人工 NTC 尚未确认",
      NTC_ASSIGNMENT_NOTE_MISSING: "人工 NTC 缺少依据",
      NTC_SELECTOR_NOT_FOUND: "NTC 选择不存在",
      NTC_PANEL_MISSING: "部分反应组合缺少 NTC",
      PARTIAL_SAMPLE_AS_NTC: "同名样本部分孔设为 NTC",
      NTC_WELL_SAMPLE_CONFLICT: "NTC 孔位样本冲突",
      NTC_CALIBRATOR_CONFLICT: "NTC 与校准品冲突",
      NO_ANALYTICAL_SAMPLES: "没有分析样本",
      WELL_OUTSIDE_PLATE: "孔位越界",
      WELL_NUMBER_MISMATCH: "孔号与坐标不一致",
      NO_REFERENCE_ASSAY: "内参缺失",
      WELL_SAMPLE_CONFLICT: "物理孔样本冲突",
      DUPLICATE_WELL_TARGET: "同孔 target 重复",
      REPORTER_MAPPING_CONFLICT: "Target-reporter 映射冲突",
      NTC_AMPLIFICATION: "NTC 出现扩增",
      SOURCE_FLAGS_PRESENT: "存在仪器原始 flags",
      TARGET_IN_MULTIPLE_PANELS: "检测到多反应组合"
    };
    return titles[issue.code] || issue.code;
  }

  function renderQc() {
    var a = state.analysis;
    var referenceWarnings = [];
    a.assays.forEach(function (assay) {
      (assay.calibration.warnings || []).forEach(function (message) {
        var assayLabel = assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "");
        if (/原运行|Reference Sample/.test(message)) referenceWarnings.push(assayLabel + "：" + message);
      });
    });
    var banner = $("#critical-banner");
    if (referenceWarnings.length) {
      banner.className = "critical-banner";
      banner.innerHTML = "<strong>已拦截仪器文件中的校准品自动继承</strong><p>" + referenceWarnings.map(escapeHtml).join("<br>") + "</p>";
    } else {
      banner.className = "";
      banner.innerHTML = "";
    }
    var list = $("#qc-list");
    if (!a.runIssues.length) {
      list.innerHTML = '<div class="qc-empty">未检测到板级结构或元数据问题。</div>';
      return;
    }
    list.innerHTML = a.runIssues.map(function (issue) {
      var severity = issue.severity || "info";
      var icon = severity === "blocker" ? "!" : (severity === "warning" ? "!" : "i");
      return '<div class="qc-item qc-item--' + severity + '">' +
        '<span class="qc-item__icon">' + icon + "</span>" +
        "<div><strong>" + escapeHtml(issueTitle(issue)) + "</strong><p>" + escapeHtml(issue.message) + "</p></div>" +
        '<span class="qc-item__code">' + escapeHtml(issue.code) + "</span></div>";
    }).join("");
  }

  function renderMetadata() {
    var metadata = state.analysis.metadata;
    var rows = Object.keys(metadata).map(function (key) {
      return "<tr><th>" + escapeHtml(key) + "</th><td>" + escapeHtml(metadata[key]) + "</td></tr>";
    }).join("");
    $("#metadata-table").innerHTML = "<table><tbody>" + rows + "</tbody></table>";
  }

  function renderSettings() {
    var targets = unique(state.parsed.records.map(function (r) { return r.targetName; })).filter(Boolean);
    $("#setting-reference").innerHTML = targets.map(function (target) {
      return '<option value="' + escapeAttr(target) + '"' + (target === state.analysis.referenceName ? " selected" : "") + ">" + escapeHtml(target) + "</option>";
    }).join("");
    $("#setting-reference-ct").value = state.settings.referenceCtMax;
    $("#setting-zero-dct").value = state.settings.zeroCopyDeltaCt;
    $("#setting-min-reps").value = state.settings.minReplicates;
    $("#setting-rep-sd").value = state.settings.replicateSdWarn;
    $("#setting-split-panels").checked = state.settings.splitPanels;
  }

  function ntcWellGroups() {
    var groups = {};
    (state.analysis.records || []).forEach(function (record) {
      var position = record.wellPosition || String(record.wellNumber);
      if (!groups[position]) groups[position] = { position: position, wellNumber: record.wellNumber, sampleNames: [], panels: [], automatic: false, conflict: false, rows: 0 };
      groups[position].sampleNames.push(record.sampleName);
      groups[position].panels.push(record.panelSignature);
      groups[position].automatic = groups[position].automatic || /AUTO_/.test(record.roleSource || "");
      groups[position].rows += 1;
    });
    return Object.keys(groups).map(function (position) {
      var group = groups[position];
      group.sampleNames = unique(group.sampleNames.filter(Boolean));
      group.panels = unique(group.panels.filter(Boolean));
      group.conflict = group.sampleNames.length > 1;
      return group;
    }).sort(function (a, b) { return (a.wellNumber || 0) - (b.wellNumber || 0) || a.position.localeCompare(b.position, undefined, { numeric: true }); });
  }

  function ntcSampleGroups(wellGroups) {
    var groups = {};
    wellGroups.forEach(function (well) {
      well.sampleNames.forEach(function (sampleName) {
        if (!groups[sampleName]) groups[sampleName] = { sampleName: sampleName, wells: [], rows: 0, automatic: false, conflict: false };
        groups[sampleName].wells.push(well.position);
        groups[sampleName].rows += well.rows;
        groups[sampleName].automatic = groups[sampleName].automatic || well.automatic;
        groups[sampleName].conflict = groups[sampleName].conflict || well.conflict;
      });
    });
    return Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).map(function (sampleName) { return groups[sampleName]; });
  }

  function renderNtcSetup() {
    var container = $("#ntc-setup");
    var summary = state.analysis.ntcSummary || { detected: false, physicalWellCount: 0, assayRowCount: 0, sources: [], assignment: {} };
    var assignment = state.settings.ntcAssignment || core.DEFAULTS.ntcAssignment;
    var mode = assignment.mode || "auto";
    var selectedSamples = assignment.sampleNames || [];
    var selectedWells = assignment.wellPositions || [];
    var wellGroups = ntcWellGroups();
    var sampleGroups = ntcSampleGroups(wellGroups);
    var statusClass = summary.detected ? "ok" : "missing";
    var statusText = summary.detected ? "已识别 " + summary.physicalWellCount + " 孔" : "尚未设置";
    var sampleRows = sampleGroups.map(function (sample) {
      var checked = selectedSamples.indexOf(sample.sampleName) >= 0 ? " checked" : "";
      var disabled = sample.automatic || sample.conflict;
      var reason = sample.automatic ? "已由导入文件识别为 NTC" : (sample.conflict ? "包含样本名冲突孔，禁止人工指定" : sample.wells.length + " 个物理孔：" + sample.wells.join("、"));
      return '<label class="ntc-candidate' + (disabled ? " is-disabled" : "") + '"><input class="ntc-sample-choice" type="checkbox" value="' + escapeAttr(sample.sampleName) + '"' + checked + (disabled ? " disabled" : "") + '><span><strong>' + escapeHtml(sample.sampleName) + "</strong><small>" + escapeHtml(reason) + "</small></span></label>";
    }).join("");
    var wellRows = wellGroups.map(function (well) {
      var checked = selectedWells.indexOf(well.position) >= 0 ? " checked" : "";
      var disabled = well.automatic || well.conflict;
      var reason = well.automatic ? "已由导入文件识别为 NTC" : (well.conflict ? "同孔存在多个样本名，禁止人工指定" : well.sampleNames.join("/") + " · " + well.panels.join("；"));
      return '<label class="ntc-candidate' + (disabled ? " is-disabled" : "") + '"><input class="ntc-well-choice" type="checkbox" value="' + escapeAttr(well.position) + '"' + checked + (disabled ? " disabled" : "") + '><span><strong>' + escapeHtml(well.position) + "</strong><small>" + escapeHtml(reason) + "</small></span></label>";
    }).join("");
    container.innerHTML =
      '<div class="ntc-setup__head"><div><h3>NTC 设置（无模板对照）</h3><p>如果实验中确实设置了无模板孔，但仪器 plate setup 没有标记，可在这里补充；文件中已有的 NTC 标记始终保留。原始样本名和孔级数据不会被修改。</p></div><span class="ntc-status ntc-status--' + statusClass + '">' + escapeHtml(statusText) + "</span></div>" +
      '<div class="ntc-boundary"><strong>实验边界：</strong>这里只能修正遗漏的板位标记；如果本次实验实际上没有设置 NTC，分析软件不能事后补造 NTC。</div>' +
      '<div class="ntc-config-grid"><label class="ntc-field"><span>NTC 识别方式</span><select id="setting-ntc-mode">' +
      '<option value="auto"' + (mode === "auto" ? " selected" : "") + '>仅使用导入文件中的标记</option>' +
      '<option value="manual_sample"' + (mode === "manual_sample" ? " selected" : "") + '>按样本名补标 NTC</option>' +
      '<option value="manual_wells"' + (mode === "manual_wells" ? " selected" : "") + '>按物理孔位补标 NTC</option></select><small>按样本名会覆盖该名称对应的全部孔；按孔位会覆盖该孔的全部 multiplex 行。</small></label>' +
      '<div><div id="ntc-sample-panel"' + (mode === "manual_sample" ? "" : " hidden") + '><span class="ntc-field"><span>选择实际未加模板的样本名</span></span><div class="ntc-candidates">' + (sampleRows || '<div class="qc-empty">没有可选样本。</div>') + "</div></div>" +
      '<div id="ntc-well-panel"' + (mode === "manual_wells" ? "" : " hidden") + '><span class="ntc-field"><span>选择实际未加模板的物理孔</span></span><div class="ntc-candidates">' + (wellRows || '<div class="qc-empty">没有可选孔位。</div>') + "</div></div>" +
      '<div id="ntc-auto-panel"' + (mode === "auto" ? "" : " hidden") + ' class="ntc-preview">自动模式不会新增 NTC，只使用样本名或 Task 中明确的 NTC / No Template 标记。</div></div></div>' +
      '<div id="ntc-manual-fields" class="ntc-manual-fields"' + (mode === "auto" ? " hidden" : "") + '><div id="ntc-selection-preview" class="ntc-preview"></div>' +
      '<label class="ntc-field"><span>指定依据（写入审计记录）</span><textarea id="setting-ntc-note" placeholder="例如：根据 2026-07-13 加样记录，H11/H12 未加入基因组 DNA。">' + escapeHtml(assignment.note || "") + "</textarea></label>" +
      '<label class="confirm-line ntc-confirm"><input id="setting-ntc-confirmed" type="checkbox"' + (assignment.confirmed ? " checked" : "") + '><span>我确认所选孔在本次实验中确实未加入模板 DNA；它们将从样本数、CN 结果、群体模型和校准候选中排除。</span></label></div>' +
      '<div class="action-row"><button class="button button--primary" id="apply-ntc" type="button">应用 NTC 设置并重新分析</button><span id="ntc-message" class="inline-message"></span></div>';

    function updateNtcModeAndPreview() {
      var activeMode = $("#setting-ntc-mode").value;
      $("#ntc-sample-panel").hidden = activeMode !== "manual_sample";
      $("#ntc-well-panel").hidden = activeMode !== "manual_wells";
      $("#ntc-auto-panel").hidden = activeMode !== "auto";
      $("#ntc-manual-fields").hidden = activeMode === "auto";
      if (activeMode === "auto") {
        $("#apply-ntc").textContent = mode !== "auto" ? "清除人工补标并重新分析" : "按导入文件重新分析";
        $("#ntc-auto-panel").textContent = "自动模式不会新增 NTC，只使用导入文件中的明确标记。" + (mode !== "auto" ? "应用后将清除当前人工补标。" : "");
      } else {
        $("#apply-ntc").textContent = "确认补标 NTC 并重新分析";
      }
      if (activeMode === "auto") return;
      var chosenSamples = $all(".ntc-sample-choice:checked").map(function (input) { return input.value; });
      var chosenWells = $all(".ntc-well-choice:checked").map(function (input) { return input.value; });
      var affectedWells = activeMode === "manual_sample" ? unique(wellGroups.filter(function (well) { return well.sampleNames.some(function (name) { return chosenSamples.indexOf(name) >= 0; }); }).map(function (well) { return well.position; })) : chosenWells;
      var affectedRows = state.analysis.records.filter(function (record) { return affectedWells.indexOf(record.wellPosition || String(record.wellNumber)) >= 0; });
      var affectedSamples = unique(affectedRows.map(function (record) { return record.sampleName; }).filter(Boolean));
      var preview = affectedWells.length ? "将把 " + affectedWells.length + " 个物理孔（" + affectedWells.join("、") + "）指定为 NTC，涉及 " + affectedRows.length + " 条 assay 记录；原样本名：" + affectedSamples.join("、") + "。" : "尚未选择 NTC 样本或孔位。";
      if (activeMode === "manual_wells") {
        var partial = affectedSamples.filter(function (sampleName) {
          var allSampleWells = wellGroups.filter(function (well) { return well.sampleNames.indexOf(sampleName) >= 0; }).map(function (well) { return well.position; });
          var selectedForSample = allSampleWells.filter(function (well) { return affectedWells.indexOf(well) >= 0; });
          return selectedForSample.length && selectedForSample.length < allSampleWells.length;
        });
        if (partial.length) preview += " 注意：" + partial.join("、") + " 只有部分同名孔被设为 NTC，其他孔仍作为分析样本。";
      }
      $("#ntc-selection-preview").textContent = preview;
    }

    function invalidateNtcConfirmation(message, clearNote) {
      $("#setting-ntc-confirmed").checked = false;
      if (clearNote) $("#setting-ntc-note").value = "";
      $("#ntc-message").textContent = message || "NTC 选择已改变，请重新核对并确认。";
      updateNtcModeAndPreview();
    }

    $("#setting-ntc-mode").addEventListener("change", function () { invalidateNtcConfirmation("NTC 指定方式已改变，请重新选择、填写依据并确认。", true); });
    $all(".ntc-sample-choice, .ntc-well-choice").forEach(function (input) {
      input.addEventListener("change", function () { invalidateNtcConfirmation("NTC 选择已改变，请重新核对并确认。", false); });
    });
    $("#setting-ntc-note").addEventListener("input", function () {
      if ($("#setting-ntc-confirmed").checked) invalidateNtcConfirmation("NTC 指定依据已改变，请重新核对并确认。", false);
    });
    $("#setting-ntc-confirmed").addEventListener("change", function () { if (this.checked) $("#ntc-message").textContent = ""; });
    $("#apply-ntc").addEventListener("click", applyNtcAssignmentFromUi);
    updateNtcModeAndPreview();
  }

  function applyNtcAssignmentFromUi() {
    var mode = $("#setting-ntc-mode").value;
    var sampleNames = mode === "manual_sample" ? $all(".ntc-sample-choice:checked").map(function (input) { return input.value; }) : [];
    var wellPositions = mode === "manual_wells" ? $all(".ntc-well-choice:checked").map(function (input) { return input.value; }) : [];
    var manual = mode !== "auto";
    var confirmed = manual && $("#setting-ntc-confirmed").checked;
    var note = manual ? $("#setting-ntc-note").value.trim() : "";
    if (manual && !sampleNames.length && !wellPositions.length) {
      $("#ntc-message").textContent = "请先选择至少一个真实 NTC 样本或孔位。";
      return;
    }
    if (manual && !confirmed) {
      $("#ntc-message").textContent = "请勾选实验事实确认；未确认的 NTC 不会生效。";
      return;
    }
    if (manual && !note) {
      $("#ntc-message").textContent = "请填写加样记录或实验依据，便于追溯。";
      return;
    }
    var next = { mode: mode, sampleNames: sampleNames, wellPositions: wellPositions, confirmed: confirmed, note: note, appliedAt: manual ? new Date().toISOString() : "" };
    var previous = state.settings.ntcAssignment || core.DEFAULTS.ntcAssignment;
    var comparable = function (value) { return JSON.stringify({ mode: value.mode || "auto", sampleNames: (value.sampleNames || []).slice().sort(), wellPositions: (value.wellPositions || []).slice().sort(), confirmed: value.confirmed === true, note: value.note || "" }); };
    var changed = comparable(previous) !== comparable(next);
    state.settings.ntcAssignment = next;
    if (changed) state.settings.calibrations = {};
    markRegistrationDirty({ invalidateApproval: true });
    runAnalysis();
    $("#ntc-message").textContent = manual ? "人工 NTC 已应用；请复核 NTC 扩增检查。" + (changed ? " 原校准设置已清空。" : "") : "已恢复为仅使用导入文件中的 NTC 标记。" + (changed ? " 原校准设置已清空。" : "");
    toast(manual ? "NTC 设置已记录并重新分析。" : "人工 NTC 设置已清除。");
  }

  function calibrationModePanel(mode, active, html) {
    return '<div class="mode-panel mode-panel--' + mode + '"' + (active ? "" : " hidden") + ">" + html + "</div>";
  }

  function renderCalibration() {
    var container = $("#calibration-cards");
    container.innerHTML = state.analysis.assays.map(function (assay) {
      var config = state.settings.calibrations[assay.key] || { mode: "none" };
      var mode = config.mode || "none";
      var candidateOptions = assay.calibrationCandidates.map(function (candidate) {
        var selected = config.sampleName === candidate.sampleName ? " selected" : "";
        var disabled = candidate.eligible ? "" : " disabled";
        return '<option value="' + escapeAttr(candidate.sampleName) + '"' + selected + disabled + ">" + escapeHtml(candidate.sampleName + (candidate.eligible ? " · 可选" : " · 禁止：" + candidate.reason)) + "</option>";
      }).join("");
      var candidateRows = assay.calibrationCandidates.map(function (candidate) {
        var selected = (config.sampleNames || []).indexOf(candidate.sampleName) >= 0 ? " checked" : "";
        return '<label class="candidate-row' + (candidate.eligible ? "" : " is-blocked") + '">' +
          '<input class="cal-group-sample" type="checkbox" value="' + escapeAttr(candidate.sampleName) + '"' + selected + (candidate.eligible ? "" : " disabled") + ">" +
          "<span>" + escapeHtml(candidate.sampleName) + " · n=" + candidate.validCount + " · SD=" + formatNumber(candidate.deltaCtSd, 3) + "</span>" +
          '<span class="candidate-badge ' + (candidate.eligible ? "candidate-badge--ok" : "candidate-badge--no") + '">' + (candidate.eligible ? "可选" : "禁止") + "</span></label>";
      }).join("");
      var notices = [];
      (assay.calibration.warnings || []).forEach(function (message) { notices.push('<div class="guard-message guard-message--warning">' + escapeHtml(message) + "</div>"); });
      (assay.calibration.errors || []).forEach(function (message) { notices.push('<div class="guard-message guard-message--error">' + escapeHtml(message) + "</div>"); });
      if (assay.calibration.ok) notices.push('<div class="guard-message guard-message--ok">校准已锁定：' + escapeHtml(assay.calibration.label) + "</div>");
      var samplePanel = '<div class="calibration-fields"><label class="calibration-field"><span>校准样本</span><select class="cal-sample"><option value="">请选择…</option>' + candidateOptions + '</select></label><label class="calibration-field"><span>已知 CN</span><input class="cal-cn" type="number" min="1" max="20" step="1" value="' + escapeAttr(config.copyNumber || 2) + '"></label></div><label class="confirm-line"><input class="cal-confirmed" type="checkbox"' + (config.independentlyConfirmed ? " checked" : "") + '><span>我确认该样本对当前 target / panel 的拷贝数已由独立方法或可追溯记录确认。</span></label>';
      var groupPanel = '<label class="calibration-field"><span>选择同一已知 CN 的校准组</span><div class="candidate-list">' + candidateRows + '</div></label><div class="calibration-fields"><label class="calibration-field"><span>该组已知 CN</span><input class="cal-group-cn" type="number" min="1" max="20" step="1" value="' + escapeAttr(config.copyNumber || 2) + '"></label></div><label class="confirm-line"><input class="cal-group-confirmed" type="checkbox"' + (config.independentlyConfirmed ? " checked" : "") + '><span>我确认所选样本具有相同、已知且独立确认的拷贝数。</span></label>';
      var populationPanel = '<div class="calibration-fields"><label class="calibration-field"><span>预期最常见的非零 CN</span><input class="cal-mode-cn" type="number" min="1" max="20" step="1" value="' + escapeAttr(config.expectedMostFrequentCopyNumber || 2) + '"></label></div><div class="guard-message guard-message--warning">只有在没有合格已知校准品、非零样本数充足，且预期众数 CN 有研究设计依据时才应人工选择。该模式为透明近似，不保证与 CopyCaller 专有实现逐值一致，也不会自动作为失败校准品的替代。</div>';
      return '<article class="calibration-card" data-assay-key="' + escapeAttr(assay.key) + '">' +
        '<div class="calibration-card__head"><h3>' + escapeHtml(assay.targetName) + "</h3><p>" + escapeHtml(assay.panelSignature || "合并所有反应组合") + " · reporter " + escapeHtml(assay.reporters.join("/")) + " · 样本 " + assay.results.length + "</p></div>" +
        '<div class="calibration-card__body">' + notices.join("") +
        '<label class="calibration-field"><span>校准方式</span><select class="cal-mode">' +
        '<option value="none"' + (mode === "none" ? " selected" : "") + '>未配置（停止 CN 计算）</option>' +
        '<option value="sample"' + (mode === "sample" ? " selected" : "") + '>已知拷贝数的单一校准样本</option>' +
        '<option value="group"' + (mode === "group" ? " selected" : "") + '>已知拷贝数的校准组</option>' +
        '<option value="population"' + (mode === "population" ? " selected" : "") + '>无校准品：众数 CN 群体拟合</option></select></label>' +
        calibrationModePanel("sample", mode === "sample", samplePanel) +
        calibrationModePanel("group", mode === "group", groupPanel) +
        calibrationModePanel("population", mode === "population", populationPanel) +
        '<div class="calibration-audit-fields"><label class="calibration-field"><span>确认依据 / 记录编号</span><input class="cal-evidence" value="' + escapeAttr(config.confirmationEvidence || "") + '" placeholder="例如 WGS 报告编号；群体模式填写众数假设依据"></label>' +
        '<label class="calibration-field"><span>选择备注 / 替换原因</span><input class="cal-selection-note" value="' + escapeAttr(config.selectionNote || "") + '" placeholder="例如主校准品内参失败，改用已确认的备用样本"></label></div>' +
        "</div></article>";
    }).join("");
    $all(".cal-mode", container).forEach(function (select) {
      select.addEventListener("change", function () {
        var card = select.closest(".calibration-card");
        $all(".mode-panel", card).forEach(function (panel) { panel.hidden = !panel.classList.contains("mode-panel--" + select.value); });
      });
    });
  }

  function registrationMissingItems() {
    if (!state.registration) return [];
    var r = state.registration;
    var missing = [];
    [
      ["protocolVersion", "Protocol/SOP 版本"],
      ["plateId", "Plate ID"],
      ["experimentDate", "实验日期"],
      ["operator", "操作人"],
      ["reactionVolume", "反应体积"],
      ["masterMixBrand", "Master Mix 品牌"],
      ["masterMixCatalog", "Master Mix Cat."],
      ["masterMixLot", "Master Mix 批号"],
      ["masterMixExpiry", "Master Mix 有效期"],
      ["reviewer", "复核人"],
      ["reviewDate", "复核日期"]
    ].forEach(function (item) { if (!String(r[item[0]] || "").trim()) missing.push(item[1]); });
    (r.assays || []).forEach(function (assay) {
      [["brand", "品牌"], ["assayId", "Assay ID"], ["lot", "批号"], ["concentration", "浓度"]].forEach(function (item) {
        if (!String(assay[item[0]] || "").trim()) missing.push(assay.target + " " + item[1]);
      });
    });
    (state.analysis ? state.analysis.assays : []).forEach(function (assay) {
      var calibration = assay.calibration.config || {};
      if (["sample", "group", "population"].indexOf(calibration.mode) >= 0 && !String(calibration.confirmationEvidence || "").trim()) {
        missing.push("校准依据：" + assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : ""));
      }
    });
    return missing;
  }

  function updateFinalDecisionOptions() {
    var select = $("#record-final-decision");
    if (!select || !state.registration || !state.analysis) return;
    var missing = registrationMissingItems();
    var automaticHold = state.analysis.releaseStatus === "HOLD";
    var canRelease = !automaticHold && !missing.length;
    if (state.registration.finalDecision === "同意放行" && (!canRelease || state.registration.approvalInvalidated)) state.registration.finalDecision = "待复核";
    var releaseLabel = canRelease ? "同意放行" : (automaticHold ? "同意放行（自动质控 HOLD）" : "同意放行（补全登记与复核后可选）");
    var options = [
      { value: "待复核", label: "待复核" },
      { value: "同意放行", label: releaseLabel, disabled: !canRelease },
      { value: "不放行", label: "不放行" },
      { value: "仅作调查性记录", label: "仅作调查性记录" }
    ];
    select.innerHTML = options.map(function (option) {
      return '<option value="' + escapeAttr(option.value) + '"' + (option.disabled ? " disabled" : "") + (state.registration.finalDecision === option.value ? " selected" : "") + ">" + escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function updateRegistrationStatus() {
    var status = $("#record-completeness");
    if (!status) return;
    var missing = registrationMissingItems();
    var needsRereview = state.registration.approvalInvalidated === true;
    status.className = "record-completeness " + (missing.length || needsRereview ? "record-completeness--warning" : "record-completeness--ok");
    status.textContent = missing.length ? "待补 " + missing.length + " 项" : (needsRereview ? "结果已变更 · 待重新复核" : (state.registration.recordStatus === "已复核" ? "登记已复核" : (state.registration.recordStatus === "草稿" ? "字段完整 · 草稿" : "登记信息完整")));
    status.title = missing.length ? missing.join("；") : (needsRereview ? "影响结果或追溯的信息已改变，原放行签认已自动撤销。" : "所有关键登记字段均已填写");
  }

  function syncRegistrationFromUi() {
    if (!state.registration || !$("#record-run-id")) return;
    var r = state.registration;
    r.plateId = $("#record-plate-id").value.trim();
    r.experimentDate = $("#record-date").value;
    r.operator = $("#record-operator").value.trim();
    r.reactionVolume = $("#record-volume").value.trim();
    r.protocolVersion = $("#record-protocol").value.trim();
    r.recordStatus = $("#record-status").value;
    r.masterMixBrand = $("#record-mix-brand").value.trim();
    r.masterMixCatalog = $("#record-mix-catalog").value.trim();
    r.masterMixLot = $("#record-mix-lot").value.trim();
    r.masterMixExpiry = $("#record-mix-expiry").value;
    r.finalDecision = $("#record-final-decision").value;
    r.reviewer = $("#record-reviewer").value.trim();
    r.reviewDate = $("#record-review-date").value;
    r.reviewNote = $("#record-review-note").value.trim();
    r.notes = $("#record-notes").value.trim();
    $all(".registration-assay-row").forEach(function (row) {
      var key = row.getAttribute("data-assay-key");
      var assay = (r.assays || []).filter(function (item) { return item.key === key; })[0];
      if (!assay) return;
      assay.brand = $(".record-assay-brand", row).value.trim();
      assay.assayId = $(".record-assay-id", row).value.trim();
      assay.lot = $(".record-assay-lot", row).value.trim();
      assay.concentration = $(".record-assay-concentration", row).value.trim();
      assay.quencher = $(".record-assay-quencher", row).value.trim();
    });
    var missing = registrationMissingItems();
    if (r.recordStatus === "已复核" && missing.length) {
      r.recordStatus = "已记录";
      $("#record-status").value = r.recordStatus;
      toast("仍有关键字段未填写，记录状态不能设为“已复核”。");
    }
    if (r.finalDecision === "同意放行") {
      if (state.analysis.releaseStatus === "HOLD" || missing.length) {
        r.finalDecision = "待复核";
        toast("自动质控或登记条件未满足，已阻止“同意放行”。");
      } else {
        r.recordStatus = "已复核";
        r.approvalInvalidated = false;
        $("#record-status").value = r.recordStatus;
      }
    }
    saveRegistrationPresets();
    updateFinalDecisionOptions();
    updateRegistrationStatus();
  }

  function handleRegistrationEdit(event) {
    var wasApproved = state.registration && (state.registration.finalDecision === "同意放行" || state.registration.recordStatus === "已复核");
    syncRegistrationFromUi();
    var targetId = event && event.target ? event.target.id : "";
    if (wasApproved && targetId !== "record-final-decision") {
      invalidateApproval({ preserveReviewDate: targetId === "record-review-date" });
    }
    markRegistrationDirty();
  }

  function renderRegistration() {
    if (!state.registration) return;
    var r = state.registration;
    $("#record-run-id").value = r.runId;
    $("#record-plate-id").value = r.plateId;
    $("#record-analysis-id").value = r.analysisId;
    $("#record-date").value = r.experimentDate;
    $("#record-operator").value = r.operator;
    $("#record-volume").value = r.reactionVolume;
    $("#record-protocol").value = r.protocolVersion;
    $("#record-status").value = r.recordStatus;
    $("#record-mix-brand").value = r.masterMixBrand;
    $("#record-mix-catalog").value = r.masterMixCatalog;
    $("#record-mix-lot").value = r.masterMixLot;
    $("#record-mix-expiry").value = r.masterMixExpiry;
    $("#record-reviewer").value = r.reviewer;
    $("#record-review-date").value = r.reviewDate;
    $("#record-review-note").value = r.reviewNote;
    $("#record-notes").value = r.notes;
    updateFinalDecisionOptions();
    $("#record-assays").innerHTML = (r.assays || []).map(function (assay) {
      return '<div class="registration-assay-row" data-assay-key="' + escapeAttr(assay.key) + '">' +
        '<div class="registration-assay-name"><strong>' + escapeHtml(assay.target) + '</strong><small>' + escapeHtml(assay.reporter || "Reporter 未记录") + '</small></div>' +
        '<label><span>品牌</span><input class="record-assay-brand" value="' + escapeAttr(assay.brand) + '" placeholder="品牌"></label>' +
        '<label><span>Assay ID</span><input class="record-assay-id" value="' + escapeAttr(assay.assayId) + '" placeholder="Assay ID"></label>' +
        '<label><span>批号</span><input class="record-assay-lot" value="' + escapeAttr(assay.lot) + '" placeholder="Lot"></label>' +
        '<label><span>浓度</span><input class="record-assay-concentration" value="' + escapeAttr(assay.concentration) + '" placeholder="例如 20X"></label>' +
        '<label><span>Quencher</span><input class="record-assay-quencher" value="' + escapeAttr(assay.quencher) + '" placeholder="Quencher"></label>' +
        '</div>';
    }).join("");
    $all("#record-section input, #record-section select, #record-section textarea").forEach(function (input) {
      if (input.tagName === "SELECT" || input.type === "date") input.onchange = handleRegistrationEdit;
      else input.oninput = handleRegistrationEdit;
    });
    updateRegistrationStatus();
    updateRegistrationSaveStatus();
  }

  var QUALITY_LABELS = {
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

  function statusClass(status) {
    if (status === "PASS") return "pass";
    if (["ZERO_COPY_CONFIRMED", "ZERO_COPY_CANDIDATE"].indexOf(status) >= 0) return "zero";
    if (["CAUTION_Z", "LOW_CONFIDENCE", "REVIEW_REPLICATE_SD", "METRICS_UNAVAILABLE", "METRICS_PENDING"].indexOf(status) >= 0) return "caution";
    if (["FAIL_Z", "NO_CALL_MIXED", "INVALID_REFERENCE", "NO_CALL"].indexOf(status) >= 0) return "fail";
    return "neutral";
  }

  function currentAssayFilter() {
    var select = $("#result-assay-filter");
    return select ? select.value : "all";
  }

  function selectedPlotAssay() {
    var key = currentAssayFilter();
    if (key !== "all") return state.analysis.assays.filter(function (assay) { return assay.key === key; })[0] || state.analysis.assays[0];
    return state.analysis.assays.filter(function (assay) { return assay.calibration.ok; })[0] || state.analysis.assays[0];
  }

  function renderResultsFilter() {
    var select = $("#result-assay-filter");
    var previous = select.value || "all";
    select.innerHTML = '<option value="all">全部 assay</option>' + state.analysis.assays.map(function (assay) {
      return '<option value="' + escapeAttr(assay.key) + '">' + escapeHtml(assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "")) + "</option>";
    }).join("");
    if ($all("option", select).some(function (option) { return option.value === previous; })) select.value = previous;
  }

  function renderResultsTable() {
    var key = currentAssayFilter();
    var query = normalizeSearch($("#result-search").value);
    var rows = core.flattenResults(state.analysis).filter(function (row) {
      return (key === "all" || row.assay === assayDisplayFromKey(key)) && (!query || normalizeSearch(row.sample).indexOf(query) >= 0);
    });
    var header = ["样本", "Assay", "信号分类", "有效 n/总 n", "Target Ct", "Reference Ct", "Mean ΔCt", "SD(ΔCt)", "ΔΔCt", "RQ", "CN calculated", "CN predicted", "Min–Max CN", "Confidence-like", "|Z|", "QC", "Flags"];
    var html = "<table><thead><tr>" + header.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>";
    html += rows.map(function (row) {
      return "<tr>" +
        "<td><strong>" + escapeHtml(row.sample) + "</strong></td>" +
        "<td>" + escapeHtml(row.assay) + "</td>" +
        "<td>" + escapeHtml(classificationLabel(row)) + "</td>" +
        '<td class="is-number">' + row.valid_replicates + "/" + row.total_replicates + "</td>" +
        numberCell(row.target_ct_mean, 3) + numberCell(row.reference_ct_mean, 3) + numberCell(row.delta_ct_mean, 3) + numberCell(row.delta_ct_sd, 3) +
        numberCell(row.delta_delta_ct, 3) + numberCell(row.rq, 3) + numberCell(row.copy_number_calculated, 3) +
        '<td class="is-number"><strong>' + (row.copy_number_predicted === null || row.copy_number_predicted === undefined ? "—" : row.copy_number_predicted) + "</strong></td>" +
        '<td class="is-number">' + (row.min_copy_number === null ? "—" : formatNumber(row.min_copy_number, 2) + "–" + formatNumber(row.max_copy_number, 2)) + "</td>" +
        numberCell(row.confidence_like, 3) + numberCell(row.absolute_z_score, 2) +
        '<td><span class="status-chip status-chip--' + statusClass(row.quality_status) + '">' + escapeHtml(QUALITY_LABELS[row.quality_status] || row.quality_status) + "</span></td>" +
        '<td class="flag-list">' + escapeHtml(row.flags || "—") + "</td></tr>";
    }).join("");
    if (!rows.length) html += '<tr><td colspan="17">没有匹配的结果。</td></tr>';
    html += "</tbody></table>";
    $("#results-table").innerHTML = html;
  }

  function numberCell(value, digits) { return '<td class="is-number">' + formatNumber(value, digits) + "</td>"; }
  function classificationLabel(row) {
    if (row.quality_status === "ZERO_COPY_CONFIRMED") return "0 copy";
    if (row.quality_status === "ZERO_COPY_CANDIDATE") return "0-copy 候选";
    return { NONZERO: "检出", MIXED: "部分扩增", INVALID: "内参无效" }[row.classification] || row.classification;
  }
  function normalizeSearch(value) { return String(value || "").trim().toLowerCase(); }
  function assayDisplayFromKey(key) {
    var assay = state.analysis.assays.filter(function (a) { return a.key === key; })[0];
    return assay ? assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "") : "";
  }

  function copyColor(cn) {
    var palette = ["#7157a4", "#2f7a9b", "#167d7f", "#cf604f", "#b67818", "#6f6590", "#3d7b55", "#8c5a45", "#4a6375"];
    return palette[Math.max(0, Math.min(palette.length - 1, Number(cn) || 0))];
  }

  function renderCopyNumberPlot() {
    var assay = selectedPlotAssay();
    var el = $("#copy-number-plot");
    if (!assay) { el.innerHTML = '<div class="chart-empty">无 assay 可显示。</div>'; return; }
    var values = assay.results.filter(function (r) { return r.calculatedCopyNumber !== null || r.qualityStatus === "ZERO_COPY_CONFIRMED"; });
    if (!values.length) {
      el.innerHTML = '<div class="chart-empty"><div><strong>尚无可绘制的连续拷贝数</strong><br>请先为 ' + escapeHtml(assay.targetName) + " 配置并通过校准检查。</div></div>";
      return;
    }
    var width = Math.max(820, values.length * 72 + 130);
    var height = 430;
    var margin = { left: 62, right: 30, top: 42, bottom: 110 };
    var plotW = width - margin.left - margin.right;
    var plotH = height - margin.top - margin.bottom;
    var ymax = Math.max(3, Math.ceil(Math.max.apply(null, values.map(function (r) { return Math.max(r.maxCopyNumberObserved || 0, r.calculatedCopyNumber || 0); })) + 0.5));
    var y = function (v) { return margin.top + plotH - Math.max(0, Math.min(ymax, v)) / ymax * plotH; };
    var xstep = plotW / values.length;
    var svg = [];
    svg.push('<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Copy number plot">');
    for (var tick = 0; tick <= ymax; tick += 1) {
      svg.push('<line x1="' + margin.left + '" y1="' + y(tick) + '" x2="' + (width - margin.right) + '" y2="' + y(tick) + '" stroke="#e1e7ea" stroke-width="1"/>');
      svg.push('<text x="' + (margin.left - 12) + '" y="' + (y(tick) + 4) + '" text-anchor="end" font-size="11">' + tick + "</text>");
    }
    values.forEach(function (r, i) {
      var cx = margin.left + xstep * (i + 0.5);
      var color = copyColor(r.predictedCopyNumber);
      var plotValue = r.qualityStatus === "ZERO_COPY_CONFIRMED" ? 0 : r.calculatedCopyNumber;
      var min = r.minCopyNumber === null ? plotValue : r.minCopyNumber;
      var max = r.maxCopyNumberObserved === null ? plotValue : r.maxCopyNumberObserved;
      svg.push('<line x1="' + cx + '" y1="' + y(min) + '" x2="' + cx + '" y2="' + y(max) + '" stroke="#384b56" stroke-width="1.5"/>');
      svg.push('<line x1="' + (cx - 6) + '" y1="' + y(min) + '" x2="' + (cx + 6) + '" y2="' + y(min) + '" stroke="#384b56"/>');
      svg.push('<line x1="' + (cx - 6) + '" y1="' + y(max) + '" x2="' + (cx + 6) + '" y2="' + y(max) + '" stroke="#384b56"/>');
      svg.push('<circle cx="' + cx + '" cy="' + y(plotValue) + '" r="7" fill="' + color + '" stroke="white" stroke-width="2"><title>' + escapeHtml(r.sampleName + " | CN=" + (r.qualityStatus === "ZERO_COPY_CONFIRMED" ? "0（未检出判定）" : formatNumber(r.calculatedCopyNumber, 3)) + " | predicted=" + r.predictedCopyNumber) + "</title></circle>");
      svg.push('<text transform="translate(' + (cx + 3) + " " + (height - margin.bottom + 18) + ') rotate(55)" text-anchor="start" font-size="10">' + escapeHtml(r.sampleName) + "</text>");
    });
    svg.push('<line x1="' + margin.left + '" y1="' + (margin.top + plotH) + '" x2="' + (width - margin.right) + '" y2="' + (margin.top + plotH) + '" stroke="#71808a"/>');
    svg.push('<line x1="' + margin.left + '" y1="' + margin.top + '" x2="' + margin.left + '" y2="' + (margin.top + plotH) + '" stroke="#71808a"/>');
    svg.push('<text x="16" y="' + (margin.top + plotH / 2) + '" transform="rotate(-90 16 ' + (margin.top + plotH / 2) + ')" text-anchor="middle" font-size="12">Copy number</text>');
    svg.push("</svg>");
    var subtitle = assay.calibration.ok ? "校准：" + assay.calibration.label + "。非零点表示连续 CN；0 copy 点表示未检出/背景阈值判定；竖线表示有效复孔的 Min–Max。" : "未校准";
    el.innerHTML = '<h3 class="chart-title">' + escapeHtml(assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "")) + '</h3><p class="chart-subtitle">' + escapeHtml(subtitle) + "</p>" + svg.join("");
  }

  function renderDeltaCtPlot() {
    var assay = selectedPlotAssay();
    var el = $("#delta-ct-plot");
    if (!assay) { el.innerHTML = '<div class="chart-empty">无 assay 可显示。</div>'; return; }
    var values = assay.results.filter(function (r) { return r.meanDeltaCt !== null; });
    if (!values.length) { el.innerHTML = '<div class="chart-empty">没有有效的非零拷贝 ΔCt 数据。</div>'; return; }
    var width = Math.max(820, values.length * 54 + 180);
    var height = Math.max(390, values.length * 27 + 110);
    var margin = { left: 130, right: 40, top: 42, bottom: 55 };
    var xs = values.map(function (r) { return r.meanDeltaCt; });
    var xmin = Math.floor((Math.min.apply(null, xs) - 0.6) * 2) / 2;
    var xmax = Math.ceil((Math.max.apply(null, xs) + 0.6) * 2) / 2;
    if (xmax - xmin < 1) xmax = xmin + 1;
    var x = function (v) { return margin.left + (v - xmin) / (xmax - xmin) * (width - margin.left - margin.right); };
    var rowH = (height - margin.top - margin.bottom) / values.length;
    var svg = ['<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '">'];
    for (var tick = Math.ceil(xmin * 2) / 2; tick <= xmax + 1e-6; tick += 0.5) {
      svg.push('<line x1="' + x(tick) + '" y1="' + margin.top + '" x2="' + x(tick) + '" y2="' + (height - margin.bottom) + '" stroke="#e3e8eb"/>');
      svg.push('<text x="' + x(tick) + '" y="' + (height - margin.bottom + 21) + '" text-anchor="middle" font-size="10">' + tick.toFixed(1) + "</text>");
    }
    if (assay.calibration.ok) {
      for (var cn = 1; cn <= state.settings.maxCopyNumber; cn += 1) {
        var center = assay.calibration.K - Math.log(cn) / Math.log(2);
        if (center >= xmin && center <= xmax) {
          svg.push('<line x1="' + x(center) + '" y1="' + margin.top + '" x2="' + x(center) + '" y2="' + (height - margin.bottom) + '" stroke="' + copyColor(cn) + '" stroke-dasharray="4 4" opacity=".55"/>');
          svg.push('<text x="' + (x(center) + 3) + '" y="' + (margin.top - 8) + '" font-size="9" fill="' + copyColor(cn) + '">CN ' + cn + "</text>");
        }
      }
    }
    values.forEach(function (r, i) {
      var cy = margin.top + rowH * (i + 0.5);
      svg.push('<text x="' + (margin.left - 10) + '" y="' + (cy + 4) + '" text-anchor="end" font-size="10">' + escapeHtml(r.sampleName) + "</text>");
      svg.push('<line x1="' + margin.left + '" y1="' + cy + '" x2="' + (width - margin.right) + '" y2="' + cy + '" stroke="#f1f3f4"/>');
      var color = r.predictedCopyNumber === null ? "#8b969c" : copyColor(r.predictedCopyNumber);
      svg.push('<circle cx="' + x(r.meanDeltaCt) + '" cy="' + cy + '" r="6" fill="' + color + '" stroke="white" stroke-width="2"><title>' + escapeHtml(r.sampleName + " | ΔCt=" + formatNumber(r.meanDeltaCt, 4) + " | CN=" + (r.predictedCopyNumber === null ? "NA" : r.predictedCopyNumber)) + "</title></circle>");
    });
    svg.push('<line x1="' + margin.left + '" y1="' + (height - margin.bottom) + '" x2="' + (width - margin.right) + '" y2="' + (height - margin.bottom) + '" stroke="#71808a"/>');
    svg.push('<text x="' + ((margin.left + width - margin.right) / 2) + '" y="' + (height - 10) + '" text-anchor="middle" font-size="12">ΔCt = Ct(target) − Ct(reference)</text></svg>');
    var modelNote = assay.qualityModel && !assay.qualityModel.ok ? assay.qualityModel.reason : "虚线为校准模型下的整数 CN 理论中心。";
    el.innerHTML = '<h3 class="chart-title">' + escapeHtml(assay.targetName + " · 样本级 ΔCt") + '</h3><p class="chart-subtitle">' + escapeHtml(modelNote || "") + "</p>" + svg.join("");
  }

  function wellSeverity(well) {
    if (well.analysisState === "NTC_AMPLIFICATION") return { level: 5, cls: "invalid", label: "NTC 出现扩增" };
    if (well.analysisState === "NTC_CLEAR") return { level: 1, cls: "ntc", label: "NTC 无扩增" };
    if (["INVALID_REFERENCE"].indexOf(well.analysisState) >= 0) return { level: 4, cls: "invalid", label: "内参无效" };
    if (well.analysisState === "OUTLIER") return { level: 3, cls: "warning", label: "离群孔" };
    if (well.analysisState === "ZERO_EVIDENCE") return { level: 2, cls: "zero", label: "0-copy 证据" };
    if (well.analysisState === "OMIT") return { level: 3, cls: "warning", label: "已排除" };
    return { level: 1, cls: "valid", label: "有效" };
  }

  function renderPlateMap() {
    var a = state.analysis;
    var rows = a.plateFormat === 384 ? 16 : 8;
    var columns = a.plateFormat === 384 ? 24 : 12;
    var wellMap = {};
    a.assays.forEach(function (assay) {
      assay.wells.forEach(function (well) {
        var key = well.wellPosition;
        if (!wellMap[key]) wellMap[key] = { status: { level: 0, cls: "", label: "" }, lines: [] };
        var status = wellSeverity(well);
        if (status.level > wellMap[key].status.level) wellMap[key].status = status;
        wellMap[key].lines.push(well.sampleName + " | " + well.targetName + " | " + status.label + " | Ct=" + (well.targetCt === null ? "Undetermined" : formatNumber(well.targetCt, 3)));
      });
    });
    var html = '<div class="plate-tooltip" id="plate-tooltip"></div><div class="plate-cell plate-cell--header"></div>';
    for (var c = 1; c <= columns; c += 1) html += '<div class="plate-cell plate-cell--header">' + c + "</div>";
    for (var r = 1; r <= rows; r += 1) {
      var letter = String.fromCharCode(64 + r);
      html += '<div class="plate-cell plate-cell--header">' + letter + "</div>";
      for (var col = 1; col <= columns; col += 1) {
        var label = letter + col;
        var info = wellMap[label];
        html += '<div class="plate-cell' + (info ? " plate-cell--" + info.status.cls : "") + '" data-tooltip="' + escapeAttr(info ? label + "\n" + info.lines.join("\n") : label + " · 未使用") + '">' + (info ? "•" : "") + "</div>";
      }
    }
    var map = $("#plate-map");
    var plateCellSize = a.plateFormat === 384 ? 22 : 38;
    map.style.gridTemplateColumns = "repeat(" + (columns + 1) + ", " + plateCellSize + "px)";
    map.innerHTML = html;
    var tooltip = $("#plate-tooltip", map);
    $all(".plate-cell[data-tooltip]", map).forEach(function (cell) {
      cell.addEventListener("mouseenter", function () { tooltip.style.display = "block"; tooltip.textContent = cell.getAttribute("data-tooltip"); });
      cell.addEventListener("mousemove", function (event) { tooltip.style.left = (event.clientX + 14) + "px"; tooltip.style.top = (event.clientY + 14) + "px"; });
      cell.addEventListener("mouseleave", function () { tooltip.style.display = "none"; });
    });
  }

  function renderWellTable() {
    var key = currentAssayFilter();
    var rows = core.flattenWells(state.analysis).filter(function (row) { return key === "all" || row.assay === assayDisplayFromKey(key); });
    var headers = ["Well", "原样本名", "角色", "角色来源", "Assay", "Target Ct", "Reference Ct", "ΔCt", "分析状态", "QC codes", "排除理由", "源行", "仪器 flags"];
    var html = "<table><thead><tr>" + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>";
    html += rows.map(function (row) {
      return "<tr><td><strong>" + escapeHtml(row.well) + "</strong></td><td>" + escapeHtml(row.original_sample) + '</td><td><span class="status-chip ' + (row.sample_role === "NTC" ? "status-chip--zero" : "status-chip--neutral") + '">' + escapeHtml(row.sample_role) + "</span></td><td>" + escapeHtml(row.role_source || "—") + "</td><td>" + escapeHtml(row.assay) + "</td>" +
        numberCell(row.target_ct, 3) + numberCell(row.reference_ct, 3) + numberCell(row.delta_ct, 3) +
        "<td>" + escapeHtml(row.analysis_state) + "</td><td>" + escapeHtml(row.qc_codes || "—") + "</td><td>" + escapeHtml(row.omitted_reason || "—") + "</td>" +
        '<td class="is-number">' + row.source_row + "</td><td>" + escapeHtml(row.source_flags || "—") + "</td></tr>";
    }).join("");
    html += "</tbody></table>";
    $("#well-table").innerHTML = html;
  }

  function renderMethodNotes() {
    var a = state.analysis;
    var ntc = a.ntcSummary || { detected: false, physicalWellCount: 0, assignment: {} };
    var confidenceNotes = a.assays.map(function (assay) {
      var note = assay.qualityModel && !assay.qualityModel.ok ? assay.qualityModel.reason : (assay.qualityModel && assay.qualityModel.note ? assay.qualityModel.note : "未校准或无可用数据。");
      return "<li><strong>" + escapeHtml(assay.targetName + (assay.panelSignature ? " [" + assay.panelSignature + "]" : "")) + "：</strong>" + escapeHtml(note) + "</li>";
    }).join("");
    $("#method-notes").innerHTML =
      '<div class="method-box"><h3>已公开且按公式实现的主计算</h3>' +
      '<span class="formula">ΔCt(well) = Ct(target) − Ct(reference)<br>ΔΔCt(sample) = mean ΔCt(sample) − mean ΔCt(calibrator)<br>CN(calculated) = CN(calibrator) × 2<sup>−ΔΔCt</sup></span>' +
      '<p>0-copy 不强行填入 Ct=40。全部可分析复孔 target 未检出（或仅达到 zero-copy 背景阈值）、内参有效、复孔数达标，并且同 assay / panel 有有效阳性校准时，判定为 0 copy；缺少阳性校准或复孔证据不足时保留为 0-copy 候选。</p></div>' +
      '<div class="method-box"><h3>校准防错逻辑</h3><ul>' +
      "<li>导出文件中记录的 Reference Sample“" + escapeHtml(a.recordedReferenceSample || "未设置") + "”只显示、不自动使用。</li>" +
      "<li>校准资格按 target / panel 分别审查：内参有效、目标为稳定非零扩增、有效复孔足够、复孔 SD 未超限。</li>" +
      "<li>已知 CN 校准品还必须由用户明确确认“已有独立拷贝数依据”；否则停止 CN 计算。</li>" +
      "<li>批量板建议每个 target / panel 预先设置主校准品和至少 1 个已独立确认 CN 的备用校准品，最好使用同一批次桥接 DNA。</li>" +
      "<li>主校准品不合格时，只能人工改选本板通过检查的备用校准品/校准组；不会从普通样本中自动替换。无合格已知校准品时，只有群体模式前提成立才可人工切换。</li>" +
      "<li>内参全失败的样本标为 Invalid，绝不把目标 Undetermined 解释为 0 copy。</li></ul></div>" +
      '<div class="method-box"><h3>NTC 识别与审计</h3><ul>' +
      "<li>当前识别 " + ntc.physicalWellCount + " 个 NTC 物理孔；人工补标只修正 plate setup 遗漏，不能补造实验中不存在的 NTC。</li>" +
      "<li>NTC 保留原样本名和孔级数据，但从样本数、CN 结果、群体模型和校准候选中排除。</li>" +
      "<li>未识别 NTC，或某个反应组合没有对应 NTC 时，记为 warning 而不单独触发 HOLD；仍必须在人工复核中记录“无法排除污染”的局限。</li>" +
      "<li>NTC 的 target 或内参任一通道出现数值 Ct 都会触发 blocker，并保留孔位、target 与 Ct 审计信息。</li>" +
      (ntc.assignment && ntc.assignment.note ? "<li>人工指定依据：" + escapeHtml(ntc.assignment.note) + "</li>" : "") + "</ul></div>" +
      '<div class="method-box"><h3>Confidence-like 与 |Z-score| 边界</h3><p>' + escapeHtml(a.methodBoundary) + '</p><ul>' + confidenceNotes + '</ul></div>' +
      '<div class="method-box"><h3>当前板的解释限制</h3><ul>' +
      "<li>使用 " + a.wellsUsed + "/" + a.plateCapacity + " 个物理孔，" + a.sampleCount + " 个非 NTC 样本；行数不等于物理孔数，multiplex 每个 target 占一行。</li>" +
      "<li>文档建议每样本 4 复孔；当前设置的最低可分析复孔数为 " + state.settings.minReplicates + "。</li>" +
      "<li>Confidence 和 |Z-score| 至少需要 7 个相同拷贝数的样本类别；样本数不足时输出 NA，不伪造数值。</li></ul></div>";
  }

  function applySettingsFromUi() {
    var previousSplit = state.settings.splitPanels;
    state.settings.referenceName = $("#setting-reference").value;
    state.settings.referenceCtMax = Number($("#setting-reference-ct").value);
    state.settings.zeroCopyDeltaCt = Number($("#setting-zero-dct").value);
    state.settings.minReplicates = Number($("#setting-min-reps").value);
    state.settings.replicateSdWarn = Number($("#setting-rep-sd").value);
    state.settings.calibratorMaxSd = state.settings.replicateSdWarn;
    state.settings.splitPanels = $("#setting-split-panels").checked;
    if (previousSplit !== state.settings.splitPanels) state.settings.calibrations = {};
    markRegistrationDirty({ invalidateApproval: true });
    runAnalysis();
    $("#settings-message").textContent = previousSplit !== state.settings.splitPanels ? "反应组合层级已变更，原校准设置已清空。" : "参数已应用。";
    toast("已重新分析孔级和样本级结果。");
  }

  function collectCalibrationSettings() {
    var calibrations = {};
    $all(".calibration-card").forEach(function (card) {
      var key = card.getAttribute("data-assay-key");
      var mode = $(".cal-mode", card).value;
      var config = { mode: mode };
      if (mode === "sample") {
        config.sampleName = $(".cal-sample", card).value;
        config.copyNumber = Number($(".cal-cn", card).value);
        config.independentlyConfirmed = $(".cal-confirmed", card).checked;
      } else if (mode === "group") {
        config.sampleNames = $all(".cal-group-sample:checked", card).map(function (input) { return input.value; });
        config.copyNumber = Number($(".cal-group-cn", card).value);
        config.independentlyConfirmed = $(".cal-group-confirmed", card).checked;
      } else if (mode === "population") {
        config.expectedMostFrequentCopyNumber = Number($(".cal-mode-cn", card).value);
      }
      config.confirmationEvidence = $(".cal-evidence", card).value.trim();
      config.selectionNote = $(".cal-selection-note", card).value.trim();
      calibrations[key] = config;
    });
    state.settings.calibrations = calibrations;
    markRegistrationDirty({ invalidateApproval: true });
    runAnalysis();
    var invalid = state.analysis.assays.filter(function (assay) { return !assay.calibration.ok; }).length;
    $("#calibration-message").textContent = invalid ? invalid + " 个 assay 仍未通过校准检查，数值 CN 保持停止。" : "所有 assay 校准已锁定，请继续人工复核 QC。";
    toast(invalid ? "部分校准设置被防错规则拦截。" : "校准设置已应用。");
  }

  function jsonSheet(rows, headers) {
    var orderedHeaders = headers && headers.length ? headers : (rows.length ? Object.keys(rows[0]) : ["message"]);
    var safeRows = rows.length ? rows : [orderedHeaders.reduce(function (row, header) { row[header] = ""; return row; }, {})];
    var sheet = XLSX.utils.json_to_sheet(safeRows, { header: orderedHeaders });
    sheet["!cols"] = orderedHeaders.map(function (header) {
      var width = Math.max(String(header).length + 2, Math.min(55, safeRows.reduce(function (max, row) { return Math.max(max, String(row[header] === null || row[header] === undefined ? "" : row[header]).length + 2); }, 0)));
      return { wch: width };
    });
    orderedHeaders.forEach(function (header, columnIndex) {
      var numberFormat = /\bCV\b/.test(header) ? "0.00%" : (/Ct Threshold/.test(header) ? "0.00000" : (/连续 ?CN|Ct mean|Ct SD|Mean ΔCt|SD\(ΔCt\)|ΔΔCt|^RQ$|Confidence|\|Z\||板内 ΔCt SD/.test(header) ? "0.000" : ""));
      if (!numberFormat) return;
      for (var rowIndex = 1; rowIndex <= safeRows.length; rowIndex += 1) {
        var cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
        if (cell && cell.t === "n") cell.z = numberFormat;
      }
    });
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    return sheet;
  }

  function exportXlsx() {
    if (!state.analysis) return;
    syncRegistrationFromUi();
    var exportData = core.buildIntegratedExport(state.analysis, {
      fileName: state.fileName,
      sheetName: state.sheetName,
      registration: state.registration
    });
    var wb = XLSX.utils.book_new();
    exportData.sheets.forEach(function (definition) {
      XLSX.utils.book_append_sheet(wb, jsonSheet(definition.rows, definition.headers), definition.name);
    });
    wb.Props = {
      Title: "CNV实验记录与样本结果",
      Subject: "TaqMan qPCR CNV analysis",
      Author: state.registration.operator || "CNV分析工具",
      Comments: "For Research Use Only"
    };
    XLSX.writeFile(wb, baseFileName() + "_CNV_实验记录.xlsx", { compression: true });
    toast("完整实验记录与一行一个 Sample 的 CN 汇总已导出。");
  }

  function exportCsv() {
    syncRegistrationFromUi();
    var exportData = core.buildIntegratedExport(state.analysis, { fileName: state.fileName, sheetName: state.sheetName, registration: state.registration });
    var sheet = jsonSheet(exportData.sheets[0].rows, exportData.sheets[0].headers);
    var csv = XLSX.utils.sheet_to_csv(sheet);
    downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), baseFileName() + "_样本CN汇总.csv");
    toast("Sample CN 汇总 CSV 已生成。");
  }

  function exportJson() {
    syncRegistrationFromUi();
    var payload = { sourceFile: state.fileName, sourceSheet: state.sheetName, registration: state.registration, analysis: state.analysis };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), baseFileName() + "_CNV_analysis.json");
    toast("可复现分析 JSON 已生成。");
  }

  function bindEvents() {
    var input = $("#file-input");
    input.addEventListener("change", function () { handleFile(input.files[0]); input.value = ""; });
    var drop = $("#drop-zone");
    ["dragenter", "dragover"].forEach(function (eventName) {
      drop.addEventListener(eventName, function (event) { event.preventDefault(); drop.classList.add("is-dragging"); });
    });
    ["dragleave", "drop"].forEach(function (eventName) {
      drop.addEventListener(eventName, function (event) { event.preventDefault(); drop.classList.remove("is-dragging"); });
    });
    drop.addEventListener("drop", function (event) { handleFile(event.dataTransfer.files[0]); });
    $("#apply-settings").addEventListener("click", applySettingsFromUi);
    $("#apply-calibration").addEventListener("click", collectCalibrationSettings);
    $("#save-registration").addEventListener("click", saveCurrentRegistrationRecord);
    $("#toggle-metadata").addEventListener("click", function () { $("#metadata-panel").open = !$("#metadata-panel").open; });
    $all(".result-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        $all(".result-tab").forEach(function (b) { b.classList.toggle("is-active", b === button); });
        $all(".tab-panel").forEach(function (panel) { panel.classList.toggle("is-active", panel.getAttribute("data-panel") === button.getAttribute("data-tab")); });
      });
    });
    $("#result-assay-filter").addEventListener("change", function () { renderResultsTable(); renderCopyNumberPlot(); renderDeltaCtPlot(); renderWellTable(); });
    $("#result-search").addEventListener("input", renderResultsTable);
    $("#export-xlsx").addEventListener("click", exportXlsx);
    $("#export-csv").addEventListener("click", exportCsv);
    $("#export-json").addEventListener("click", exportJson);
    $("#print-report").addEventListener("click", function () { window.print(); });
  }

  bindEvents();
})();

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const MODE_META = {
    graph: { icon: "i-atom", hint: "展开局部知识图谱", placeholder: "展开一个概念，看看它连接了哪些节点…" },
    causal: { icon: "i-flow", hint: "条件 → 过程 → 现象 → 影响", placeholder: "例如：生成因果图谱：水的三态变化" },
    compare: { icon: "i-compare", hint: "对比结构、条件与证据", placeholder: "例如：对比物理变化与化学变化" },
    inquiry: { icon: "i-flask", hint: "设计一个可检验的探究", placeholder: "例如：怎样探究溶解快慢的影响因素？" },
    project: { icon: "i-project", hint: "从问题到物化的完整项目", placeholder: "例如：设计一个校园节水工程方案" },
    assessment: { icon: "i-target", hint: "情境化、素养导向的测评", placeholder: "例如：用三道题检测我的三态变化理解" },
    explain: { icon: "i-spark", hint: "用问题链理解概念", placeholder: "问问格物：为什么冰会浮在水面上？" }
  };

  const LITERACY_COLORS = {
    "科学观念": "#0f766e",
    "科学思维": "#1d4ed8",
    "探究实践": "#b45309",
    "态度责任": "#be123c"
  };

  const SUGGESTION_ACCENTS = ["#0f766e", "#b45309", "#1d4ed8", "#4d7c0f"];
  const SESSION_STORAGE_KEY = "gewu-sessions-v1";
  const MAX_STORED_SESSIONS = 20;
  const MAX_STORED_MESSAGES = 60;

  const state = {
    config: null,
    curriculum: null,
    stage: "3-4",
    concept: null,
    conceptId: null,
    mode: "graph",
    history: [],
    streaming: false,
    controller: null,
    currentAssistant: null,
    sources: [],
    graph: null,
    graphZoom: 1,
    graphView: "relations",
    selectedNodeId: null,
    focusNodeId: null,
    focusTrail: [],
    nodeAction: null,
    sessionActive: false,
    libraryTag: "",
    libraryItems: [],
    libraryRequest: 0,
    libraryLoaded: false,
    libraryDebounce: null,
    libraryPinnedId: null,
    libraryFocusText: "",
    sessions: [],
    currentSession: null,
    stageTouched: false,
    experiment: {
      status: "idle",
      temperature: 20,
      stirring: "yes",
      particle: "medium",
      progress: 0,
      elapsed: 0,
      result: null,
      timer: null,
      records: []
    }
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindGlobalEvents();
    autoResizeInput();

    try {
      const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("配置接口不可用");
      state.config = await response.json();
      state.curriculum = state.config.curriculum;
    } catch (error) {
      console.error(error);
      setModelStatus(false);
      showToast("无法连接后端服务，请先启动 app.py。", "error");
      return;
    }

    const storedStage = safeStorageGet("gewu-stage");
    if (storedStage && ["1-2", "3-4", "5-6", "7-9"].includes(storedStage)) {
      state.stage = storedStage;
    }

    populateInterface();
    setStage(state.stage, { silent: true });
    setMode("graph", { silent: true });
    setGraph(buildOverviewGraph(), { badge: "课程总览 · 点击节点探索" });
    renderSources([]);
    updateLibraryMeta();
    state.sessions = loadSessions();
    updateArchiveMeta();
    setModelStatus(state.config.configured);
    maybeWelcomeStageNote();
  }

  function cacheElements() {
    const ids = [
      "chatScroll", "welcome", "conversation", "greetingText", "suggestionGrid",
      "conceptList", "crosscuttingList", "stageSwitch", "stageGlider", "stagePill",
      "conceptPill", "conceptPillText", "clearConcept", "modeRow", "modeHint",
      "composerForm", "messageInput", "sendBtn", "contextPills",
      "openExperiment", "experimentModal", "experimentStatus", "experimentBench",
      "experimentObservation", "experimentProgressText", "experimentTimer", "experimentProgressBar",
      "experimentResultNote", "experimentTemperature", "experimentTemperatureValue", "experimentStirring",
      "experimentParticle", "experimentLoad", "experimentRun", "experimentReset", "experimentRecords",
      "clearExperimentRecords", "experimentInference", "sendExperimentConclusion",
      "modelChip", "modelName", "graphSvg", "graphTitle", "graphCount", "graphBadge",
      "graphLegend", "nodeDetail", "nodeType", "nodeStage", "nodeTitle", "nodeNote",
      "nodeAction", "sourcesList", "openLibrarySmall", "openLibrary", "libraryCard",
      "openCourses", "openGraph", "newChat", "leftRail", "rightRail", "scrim",
      "libraryModal", "librarySearch", "libraryTags", "libraryResults",
      "libraryResultMeta", "libraryRange", "libraryMeta", "toastWrap", "srStatus", "zoomIn",
      "zoomOut", "resetGraph", "libraryTitle", "railStageName", "railStageMode",
      "railStageDesc", "openArchive", "archiveModal", "archiveList", "archiveMeta",
      "archiveCount", "archiveSummary", "exportSession", "newSessionFromArchive",
      "graphViewSwitch", "graphStage", "relationView", "relationBack", "relationPath",
      "relationScroll", "focusCard", "relationGroups"
    ];
    ids.forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindGlobalEvents() {
    els.stageSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-stage]");
      if (!button) return;
      setStage(button.dataset.stage);
    });

    $$("[data-close-modal]").forEach((node) => {
      node.addEventListener("click", closeLibrary);
    });
    $$("[data-close-archive]").forEach((node) => {
      node.addEventListener("click", closeArchive);
    });
    $$('[data-close-experiment]').forEach((node) => {
      node.addEventListener("click", closeExperiment);
    });

    els.openLibrary.addEventListener("click", () => openLibrary(""));
    els.libraryCard.addEventListener("click", () => openLibrary(""));
    els.openLibrarySmall.addEventListener("click", () => openLibrary(""));
    els.clearConcept.addEventListener("click", clearConcept);
    els.openArchive.addEventListener("click", openArchive);
    els.exportSession.addEventListener("click", exportCurrentSession);
    els.newSessionFromArchive.addEventListener("click", () => {
      closeArchive();
      resetSession();
    });
    els.openExperiment.addEventListener("click", openExperiment);
    els.experimentTemperature.addEventListener("input", () => {
      state.experiment.temperature = Number(els.experimentTemperature.value);
      markExperimentDirty();
      renderExperiment();
    });
    els.experimentStirring.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-stirring]");
      if (!button || state.experiment.status === "running") return;
      state.experiment.stirring = button.dataset.stirring;
      markExperimentDirty();
      renderExperiment();
    });
    els.experimentParticle.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-particle]");
      if (!button || state.experiment.status === "running") return;
      state.experiment.particle = button.dataset.particle;
      markExperimentDirty();
      renderExperiment();
    });
    els.experimentLoad.addEventListener("click", loadExperiment);
    els.experimentRun.addEventListener("click", runExperiment);
    els.experimentReset.addEventListener("click", resetExperiment);
    els.clearExperimentRecords.addEventListener("click", clearExperimentRecords);
    els.sendExperimentConclusion.addEventListener("click", sendExperimentConclusion);
    els.archiveList.addEventListener("click", (event) => {
      const restore = event.target.closest("[data-restore-session]");
      if (restore) {
        restoreSession(restore.dataset.restoreSession);
        return;
      }
      const remove = event.target.closest("[data-delete-session]");
      if (remove) {
        deleteSession(remove.dataset.deleteSession);
      }
    });

    els.composerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.streaming) {
        stopStreaming();
        return;
      }
      const text = els.messageInput.value.trim();
      if (!text) {
        els.messageInput.focus();
        return;
      }
      sendMessage(text);
    });

    els.messageInput.addEventListener("input", autoResizeInput);
    els.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        if (state.streaming) return;
        event.preventDefault();
        const text = els.messageInput.value.trim();
        if (text) sendMessage(text);
      }
    });

    els.newChat.addEventListener("click", resetSession);
    els.openCourses.addEventListener("click", () => openDrawer("left"));
    els.openGraph.addEventListener("click", () => openDrawer("right"));
    els.scrim.addEventListener("click", closeDrawers);
    els.nodeAction.addEventListener("click", () => {
      if (typeof state.nodeAction === "function") state.nodeAction();
    });

    els.zoomIn.addEventListener("click", () => setGraphZoom(state.graphZoom + 0.15));
    els.zoomOut.addEventListener("click", () => setGraphZoom(state.graphZoom - 0.15));
    els.resetGraph.addEventListener("click", () => {
      setGraphZoom(1);
      showToast("图谱视图已重置");
    });

    els.graphViewSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-graph-view]");
      if (!button) return;
      setGraphView(button.dataset.graphView);
    });
    els.relationBack.addEventListener("click", relationBack);
    els.relationGroups.addEventListener("click", (event) => {
      const target = event.target.closest("[data-focus-node]");
      if (!target) return;
      focusRelationNode(target.dataset.focusNode);
    });

    els.librarySearch.addEventListener("input", () => {
      state.libraryPinnedId = null;
      clearTimeout(state.libraryDebounce);
      state.libraryDebounce = setTimeout(() => fetchLibrary(els.librarySearch.value.trim()), 260);
    });

    els.libraryTags.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-lib-tag]");
      if (!button) return;
      state.libraryTag = button.dataset.libTag || "";
      $$("button[data-lib-tag]", els.libraryTags).forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      if (state.libraryPinnedId) {
        state.libraryPinnedId = null;
        els.librarySearch.value = "";
        fetchLibrary("");
      } else {
        renderLibrary(state.libraryItems);
      }
    });

    els.libraryResults.addEventListener("click", (event) => {
      const button = event.target.closest("[data-expand-lib]");
      if (!button) return;
      const card = button.closest(".library-result");
      if (!card) return;
      card.classList.toggle("is-expanded");
      button.textContent = card.classList.contains("is-expanded") ? "收起" : "展开全文";
    });

    els.sourcesList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-source-id]");
      if (!card) return;
      openLibraryById(card.dataset.sourceId, card.dataset.sourceTitle || "");
    });

    els.conversation.addEventListener("click", (event) => {
      const cite = event.target.closest(".cite[data-cite-index]");
      if (!cite) return;
      const message = cite.closest(".message.assistant");
      const sourceList = message?._sources || [];
      const index = Number(cite.dataset.citeIndex) - 1;
      const source = sourceList[index];
      if (!source) {
        showToast("本轮资料中没有这个引用编号。", "warn");
        return;
      }
      const contextNode = cite.closest("p, li, blockquote, td");
      const contextText = (contextNode?.innerText || "").trim();
      openLibraryById(source.id, source.title || "", contextText);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.archiveModal.hidden) {
        closeArchive();
        return;
      }
      if (!els.libraryModal.hidden) {
        closeLibrary();
        return;
      }
      if (!els.experimentModal.hidden) {
        closeExperiment();
        return;
      }
      closeDrawers();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1180) closeDrawers();
      autoResizeInput();
    });
  }

  function populateInterface() {
    const starter = state.curriculum.starter || {};
    if (starter.greeting) els.greetingText.textContent = starter.greeting;
    renderConceptList();
    renderCrosscutting();
    renderModes();
    renderSuggestions(starter.suggestions || []);
    renderGraphLegend();
    els.modelName.textContent = prettyModelName(state.config.model);
    els.modelChip.title = `${state.config.model} · LangChain ChatOpenAI · 阿里云百炼`;
    els.modelChip.dataset.framework = state.config.framework || "LangChain";
    document.title = "格物 · 科学图谱 | 义务教育科学智能学习助手";
  }

  function prettyModelName(model) {
    if (!model) return "Qwen";
    return model.replace(/^qwen/i, "Qwen");
  }

  function conceptCoverage(conceptId) {
    return state.config?.knowledge_coverage?.concepts?.find((item) => Number(item.id) === Number(conceptId)) || null;
  }

  function evidenceLabel(item) {
    if (item?.evidence_label) return item.evidence_label;
    if (item?.scope === "framework_stage") return "框架学段整理";
    if (item?.scope === "framework") return "框架摘要";
    return "条文整理";
  }

  function evidenceClass(item) {
    return evidenceLabel(item) === "条文整理" ? "" : "is-framework";
  }

  function coverageBadge(coverage) {
    if (!coverage || coverage.level === "missing") return { text: "缺", className: "" };
    if (coverage.level === "detail") return { text: "详", className: "is-indexed" };
    if (coverage.level === "framework_stage") return { text: "段", className: "is-stage" };
    return { text: "框", className: "" };
  }

  function renderConceptList() {
    els.conceptList.innerHTML = "";
    const conceptById = new Map(state.curriculum.concepts.map((item) => [item.id, item]));
    state.curriculum.domains.forEach((domain, index) => {
      const block = document.createElement("details");
      block.className = "domain-block";
      block.dataset.domainId = domain.id;
      block.open = index === 0;

      const label = document.createElement("summary");
      label.className = "domain-label";
      label.style.setProperty("--accent", domain.color);
      label.innerHTML = `<svg class="domain-chevron" aria-hidden="true"><use href="#i-chevron"/></svg><i aria-hidden="true"></i><strong>${escapeHtml(domain.name)}</strong><span class="domain-count" aria-label="${domain.concepts.length} 个核心概念">${String(domain.concepts.length).padStart(2, "0")}</span>`;
      block.appendChild(label);
      const children = document.createElement("div");
      children.className = "domain-children";
      children.setAttribute("role", "group");
      children.setAttribute("aria-label", `${domain.name}核心概念`);

      domain.concepts.forEach((conceptId) => {
        const concept = conceptById.get(conceptId);
        if (!concept) return;
        const stageFocus = concept.stage_focus?.[state.stage];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "concept-item";
        button.dataset.conceptId = String(concept.id);
        button.dataset.conceptName = concept.name;
        button.style.setProperty("--accent", domain.color);
        const coverage = conceptCoverage(concept.id);
        const badge = coverageBadge(coverage);
        const coverageTitle = coverage
          ? `${coverage.label} · ${coverage.total_blocks}个知识块${coverage.is_detailed ? "，可按条文整理引用" : "，回答时会保留框架证据边界"}`
          : "尚未建立资料覆盖记录";
        button.title = stageFocus
          ? `${stageFocus.focus}\n本学段任务：${stageFocus.task}\n资料状态：${coverageTitle}`
          : `${concept.summary}\n资料状态：${coverageTitle}`;
        button.innerHTML = `
          <span class="num">${String(concept.id).padStart(2, "0")}</span>
          <span class="name">${escapeHtml(concept.name)}</span>
          <span class="coverage ${badge.className}" title="${escapeHtml(coverageTitle)}">${badge.text}</span>
        `;
        button.addEventListener("click", () => selectConcept(concept));
        children.appendChild(button);
      });

      block.appendChild(children);
      els.conceptList.appendChild(block);
    });
  }

  function renderCrosscutting() {
    els.crosscuttingList.innerHTML = "";
    state.curriculum.crosscutting.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "crosscut";
      button.style.setProperty("--accent", item.color);
      button.textContent = item.name;
      button.title = item.summary;
      button.addEventListener("click", () => {
        fillComposer(`用「${item.name}」跨学科视角分析一个科学现象，并生成局部图谱`);
        closeDrawers();
      });
      els.crosscuttingList.appendChild(button);
    });
  }

  function renderModes() {
    els.modeRow.innerHTML = "";
    const modeOrder = ["graph", "causal", "compare", "inquiry", "project", "assessment", "explain"];
    const available = new Map((state.config.chat_modes || []).map((item) => [item.id, item]));
    modeOrder.forEach((id) => {
      if (!available.has(id) && id !== "explain") return;
      const meta = MODE_META[id];
      if (!meta) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-btn";
      button.dataset.mode = id;
      button.innerHTML = `<svg><use href="#${meta.icon}"/></svg><span>${escapeHtml(available.get(id)?.name || id)}</span>`;
      button.title = meta.hint;
      button.addEventListener("click", () => setMode(id));
      els.modeRow.appendChild(button);
    });
  }

  function renderSuggestions(suggestions) {
    els.suggestionGrid.innerHTML = "";
    const icons = ["i-atom", "i-flow", "i-compare", "i-flask"];
    const displaySuggestions = [...suggestions];
    const experimentSuggestion = {
      title: "实验模拟：溶解快慢",
      desc: "调节温度、颗粒和玻璃棒搅拌",
      prompt: "打开溶解快慢实验模拟",
      mode: "experiment",
      icon: "flask"
    };
    const experimentIndex = displaySuggestions.findIndex((item) => item.mode === "experiment");
    if (experimentIndex >= 0) {
      displaySuggestions[experimentIndex] = { ...experimentSuggestion, ...displaySuggestions[experimentIndex] };
    } else if (displaySuggestions.length >= 4) {
      displaySuggestions[3] = experimentSuggestion;
    } else {
      displaySuggestions.push(experimentSuggestion);
    }
    displaySuggestions.forEach((suggestion, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `suggestion-card${suggestion.mode === "experiment" ? " is-experiment" : ""}`;
      button.style.setProperty("--accent", suggestion.mode === "experiment" ? "#b45309" : SUGGESTION_ACCENTS[index % SUGGESTION_ACCENTS.length]);
      button.innerHTML = `
        <span class="s-icon"><svg><use href="#${icons[index % icons.length]}"/></svg></span>
        <span class="s-copy">
          <strong>${escapeHtml(suggestion.title)}</strong>
          <small>${escapeHtml(suggestion.desc)}</small>
        </span>
        <span class="s-arrow">${suggestion.mode === "experiment" ? "开始" : "<svg><use href=\"#i-arrow\"/></svg>"}</span>
      `;
      button.addEventListener("click", () => {
        if (suggestion.mode === "experiment") {
          openExperiment();
          return;
        }
        if (suggestion.mode && MODE_META[suggestion.mode]) setMode(suggestion.mode);
        inferConceptFromText(suggestion.prompt);
        fillComposer(suggestion.prompt, false);
        sendMessage(suggestion.prompt);
      });
      els.suggestionGrid.appendChild(button);
    });
  }

  function renderGraphLegend() {
    els.graphLegend.innerHTML = Object.entries(LITERACY_COLORS)
      .map(([name, color]) => `<span><i style="--dot:${color}"></i>${name}</span>`)
      .join("");
  }

  function maybeWelcomeStageNote() {
    if (!state.curriculum) return;
    const stage = state.curriculum.stages.find((item) => item.id === state.stage);
    if (stage) {
      els.messageInput.placeholder = stage.id === "1-2"
        ? "例如：观察并描述你身边的一件物体…"
        : stage.id === "3-4"
          ? "问问格物：空气真的有质量吗？"
          : stage.id === "5-6"
            ? "问问格物：为什么水烧开时温度不再上升？"
            : "问问格物：如何用控制变量法探究燃烧条件？";
    }
  }

  function setStage(stageId, options = {}) {
    if (!state.curriculum) return;
    const valid = state.curriculum.stages.map((item) => item.id);
    if (!valid.includes(stageId)) return;
    const changed = state.stage !== stageId;
    if (changed && !options.silent) resetSession({ silent: true });
    state.stage = stageId;
    safeStorageSet("gewu-stage", stageId);
    const stage = state.curriculum.stages.find((item) => item.id === stageId);
    const index = valid.indexOf(stageId);

    $$("button[data-stage]", els.stageSwitch).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.stage === stageId);
    });
    els.stageGlider.style.transform = `translateX(${index * 100}%)`;
    els.stagePill.textContent = stage.name;
    els.stagePill.title = stage.mode;
    if (els.railStageName) {
      els.railStageName.textContent = stage.name;
      els.railStageMode.textContent = stage.mode;
      els.railStageDesc.textContent = stage.description;
    }
    refreshConceptStageCards();
    maybeWelcomeStageNote();

    if (state.conceptId) {
      const concept = state.curriculum.concepts.find((item) => item.id === state.conceptId);
      if (concept) setGraph(buildConceptPreview(concept), { badge: "概念预览 · 等待提问展开" });
    }

    if (changed && !options.silent) {
      showToast(`已切换至 ${stage.name}，已开启新对话`);
    }
  }

  function refreshConceptStageCards() {
    if (!state.curriculum) return;
    $$(".concept-item", els.conceptList).forEach((button) => {
      const concept = state.curriculum.concepts.find((item) => item.id === Number(button.dataset.conceptId));
      if (!concept) return;
      const stageFocus = concept.stage_focus?.[state.stage];
      button.title = stageFocus
        ? `${stageFocus.focus}\n本学段任务：${stageFocus.task}`
        : concept.summary;
    });
  }

  function setMode(modeId, options = {}) {    if (!MODE_META[modeId]) return;
    state.mode = modeId;
    $$("button[data-mode]", els.modeRow).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === modeId);
    });
    const meta = MODE_META[modeId];
    els.modeHint.textContent = meta.hint;
    updateExperimentTrigger();
    if (!state.sessionActive || !els.messageInput.value.trim()) {
      els.messageInput.placeholder = meta.placeholder;
    }
    if (!options.silent) {
      els.messageInput.focus();
    }
    if (state.currentSession?.messages.length) {
      state.currentSession.mode = modeId;
      persistCurrentSession();
    }
  }

  function inferConceptFromText(text) {
    if (!state.curriculum || !text) return;
    const matches = [
      { id: 1, words: ["物质的结构与性质", "结构性质", "空气与水", "金属材料", "元素与微粒"] },
      { id: 2, words: ["物质的变化与化学反应", "三态变化", "溶解", "化学变化", "物理变化", "质量守恒", "水的三态"] }
    ];
    for (const match of matches) {
      if (match.words.some((word) => text.includes(word))) {
        const concept = state.curriculum.concepts.find((item) => item.id === match.id);
        if (concept) {
          state.concept = concept.name;
          state.conceptId = concept.id;
          updateConceptUI();
        }
        return;
      }
    }
  }

  function selectConcept(concept) {
    state.concept = concept.name;
    state.conceptId = concept.id;
    updateConceptUI();
    setGraph(buildConceptPreview(concept), { badge: "概念预览 · 提问后展开" });
    fillComposer(`展开「${concept.name}」知识图谱`);
    closeDrawers();
    if (state.currentSession?.messages.length) {
      state.currentSession.concept = concept.name;
      persistCurrentSession();
    }
    showToast(`已定位：${concept.name}`);
  }

  function updateConceptUI() {
    const visible = Boolean(state.concept);
    els.conceptPill.classList.toggle("is-hidden", !visible);
    updateExperimentTrigger();
    if (visible) {
      els.conceptPillText.textContent = state.concept;
      els.conceptPill.title = state.concept;
    }
    $$(".concept-item", els.conceptList).forEach((item) => {
      const active = visible && Number(item.dataset.conceptId) === state.conceptId;
      item.classList.toggle("is-active", active);
      if (active) {
        item.setAttribute("aria-current", "true");
        item.closest(".domain-block").open = true;
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }

  function clearConcept() {
    state.concept = null;
    state.conceptId = null;
    updateConceptUI();
    setGraph(buildOverviewGraph(), { badge: "课程总览 · 点击节点探索" });
    if (state.currentSession?.messages.length) {
      state.currentSession.concept = null;
      persistCurrentSession();
    }
    els.messageInput.focus();
  }

  function autoResizeInput() {
    if (!els.messageInput) return;
    els.messageInput.style.height = "auto";
    uiHeightRestore(els.messageInput);
  }

  function uiHeightRestore(textarea) {
    const next = Math.min(textarea.scrollHeight, 158);
    textarea.style.height = `${Math.max(26, next)}px`;
  }

  function fillComposer(text, focus = true) {
    els.messageInput.value = text;
    autoResizeInput();
    if (focus) {
      els.messageInput.focus();
      els.messageInput.setSelectionRange(els.messageInput.value.length, els.messageInput.value.length);
    }
    maybeScrollToComposerOnMobile();
  }

  function maybeScrollToComposerOnMobile() {
    if (window.innerWidth <= 900 && state.sessionActive) {
      els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    }
  }

  function hideWelcome() {
    if (!state.sessionActive) {
      els.welcome.style.display = "none";
      state.sessionActive = true;
    }
  }

  function interruptActiveResponse() {
    if (!state.streaming) return;
    stopStreaming();
    if (state.currentAssistant) finalizeAssistant(state.currentAssistant, { aborted: true });
    setStreaming(false);
    state.controller = null;
    state.currentAssistant = null;
  }

  function resetSession(options = {}) {
    interruptActiveResponse();
    persistCurrentSession();
    state.currentSession = null;
    state.history = [];
    state.sources = [];
    state.concept = null;
    state.conceptId = null;
    state.sessionActive = false;
    state.currentAssistant = null;
    state.libraryLoaded = false;
    els.conversation.innerHTML = "";
    els.welcome.style.display = "";
    els.welcome.classList.remove("is-hidden");
    els.messageInput.value = "";
    autoResizeInput();
    updateConceptUI();
    setMode("graph", { silent: true });
    setGraph(buildOverviewGraph(), { badge: "课程总览 · 点击节点探索" });
    renderSources([]);
    els.chatScroll.scrollTop = 0;
    closeDrawers();
    updateArchiveMeta();
    if (!options.silent) showToast("已开启新的学习会话");
  }

  async function sendMessage(text) {
    if (state.streaming) return;
    const message = String(text || "").trim();
    if (!message) return;

    hideWelcome();
    closeDrawers();
    els.messageInput.value = "";
    autoResizeInput();
    if (!state.concept) inferConceptFromText(message);

    const session = ensureCurrentSession();
    session.stage = state.stage;
    session.concept = state.concept;
    session.mode = state.mode;
    session.messages.push({
      role: "user",
      content: message,
      stage: state.stage,
      concept: state.concept,
      mode: state.mode,
      at: Date.now()
    });
    if (session.messages.filter((item) => item.role === "user").length === 1) {
      session.title = message.slice(0, 36) || "未命名学习会话";
    }
    persistCurrentSession();

    const priorHistory = state.history.slice(-12);
    state.history.push({ role: "user", content: message });

    appendUserMessage(message);
    const assistant = appendAssistantMessage();
    state.currentAssistant = assistant;
    const controller = new AbortController();
    state.controller = controller;
    const isCurrentRequest = () => state.currentAssistant === assistant && state.currentSession === session;
    setStreaming(true);

    const payload = {
      message,
      stage: state.stage,
      concept: state.concept,
      mode: state.mode,
      history: priorHistory
    };

    let firstContent = true;
    let graphReceived = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        let detail = `服务返回 ${response.status}`;
        try {
          const data = await response.json();
          detail = data.error || data.detail || detail;
        } catch (error) { /* no-op */ }
        throw new Error(detail);
      }

      await consumeSSE(response, (event, data) => {
        if (!isCurrentRequest()) return;
        if (event === "meta") {
          state.sources = data.sources || [];
          assistant.sourceData = state.sources;
          renderSources(state.sources);
          renderMessageSources(assistant, state.sources);
          setAssistantLive(assistant, "正在构建图谱…");
        } else if (event === "delta") {
          if (firstContent) {
            firstContent = false;
            removeTyping(assistant);
            assistant.md.classList.add("is-streaming");
          }
          assistant.content += data.text || "";
          scheduleMarkdownRender(assistant);
        } else if (event === "graph") {
          graphReceived = true;
          const graph = normalizeGraph(data);
          if (graph) {
            assistant.graphData = graph;
            setGraph(graph, { badge: "本轮图谱 · 已可视化", fromModel: true });
          }
        } else if (event === "done") {
          setAssistantLive(assistant, "");
        } else if (event === "error") {
          throw new Error(data.message || "模型服务暂时不可用");
        }
      });

      if (!isCurrentRequest()) return;
      finalizeAssistant(assistant, { failed: false });
      if (assistant.content.trim()) {
        state.history.push({ role: "assistant", content: assistant.content });
      }
      if (!graphReceived) {
        els.graphBadge.textContent = "本轮未返回可视化数据";
        els.graphBadge.classList.remove("is-ready");
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (error.name === "AbortError") {
        finalizeAssistant(assistant, { aborted: true });
      } else {
        console.error(error);
        finalizeAssistant(assistant, { failed: true, error });
        showToast(error.message || "对话失败，请重试", "error");
      }
    } finally {
      if (isCurrentRequest()) {
        setStreaming(false);
        state.controller = null;
        state.currentAssistant = null;
        scrollToBottom(true);
      }
    }
  }

  function consumeSSE(response, onEvent) {
    if (!response.body) throw new Error("浏览器不支持流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    return new Promise((resolve, reject) => {
      const pump = () => {
        reader.read().then(({ done, value }) => {
          if (done) {
            if (buffer.trim()) parseSSEBlock(buffer);
            resolve();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            try {
              parseSSEBlock(block);
            } catch (error) {
              reject(error);
              return;
            }
            boundary = buffer.indexOf("\n\n");
          }
          pump();
        }).catch(reject);
      };

      const parseSSEBlock = (block) => {
        let event = "message";
        const dataLines = [];
        block.split("\n").forEach((line) => {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        });
        if (!dataLines.length) return;
        let data;
        try {
          data = JSON.parse(dataLines.join("\n"));
        } catch (error) {
          return;
        }
        onEvent(event, data);
      };

      pump();
    });
  }

  function appendUserMessage(text, options = {}) {
    const article = document.createElement("article");
    article.className = "message user";
    const bubble = document.createElement("div");
    bubble.className = "user-bubble";
    const meta = document.createElement("span");
    meta.className = "u-meta";
    const stageId = options.stage || state.stage;
    const modeId = options.mode || state.mode;
    const stage = state.curriculum?.stages.find((item) => item.id === stageId);
    meta.textContent = `${stage?.name || stageId} · ${MODE_META[modeId]?.hint || "学习提问"}`;
    bubble.appendChild(meta);
    bubble.appendChild(document.createTextNode(text));
    article.appendChild(bubble);
    els.conversation.appendChild(article);
    if (options.scroll !== false) scrollToBottom(true);
    return article;
  }

  function appendAssistantMessage() {
    const article = document.createElement("article");
    article.className = "message assistant";

    const avatar = document.createElement("span");
    avatar.className = "assistant-avatar";
    avatar.innerHTML = `<svg><use href="#i-orbit"/></svg>`;

    const body = document.createElement("div");
    body.className = "assistant-body";

    const meta = document.createElement("div");
    meta.className = "assistant-meta";
    const stage = state.curriculum?.stages.find((item) => item.id === state.stage);
    meta.innerHTML = `
      <strong>格物 · 科学导师</strong>
      <span class="meta-divider"></span>
      <span class="meta-stage">${escapeHtml(stage?.name || state.stage)} · ${escapeHtml(MODE_META[state.mode]?.hint || "")}</span>
      <span class="meta-live">正在检索课标证据…</span>
    `;

    const sources = document.createElement("div");
    sources.className = "message-sources is-hidden";

    const md = document.createElement("div");
    md.className = "md";

    const typing = document.createElement("div");
    typing.className = "typing";
    typing.innerHTML = "<i></i><i></i><i></i><span>格物正在翻检课标资料</span>";

    const errorBox = document.createElement("div");
    errorBox.className = "message-error is-hidden";

    const followups = document.createElement("div");
    followups.className = "followups is-hidden";

    const tools = document.createElement("div");
    tools.className = "message-tools is-hidden";

    body.append(meta, sources, typing, md, errorBox, followups, tools);
    article.append(avatar, body);
    els.conversation.appendChild(article);
    scrollToBottom(true);

    return {
      root: article,
      body,
      meta,
      sources,
      md,
      typing,
      errorBox,
      followups,
      tools,
      content: "",
      raf: null,
      finalized: false,
      liveEl: $(".meta-live", meta),
      mode: state.mode,
      stage: state.stage,
      concept: state.concept,
      sourceData: [],
      graphData: null,
      sessionRecord: null
    };
  }

  function scheduleMarkdownRender(assistant) {
    if (assistant.raf) return;
    const nearBottom = isNearBottom();
    assistant.raf = requestAnimationFrame(() => {
      assistant.raf = null;
      assistant.md.innerHTML = renderMarkdown(assistant.content);
      if (nearBottom) scrollToBottom(false);
    });
  }

  function finalizeAssistant(assistant, options = {}) {
    if (assistant.finalized) return;
    assistant.finalized = true;
    if (assistant.raf) {
      cancelAnimationFrame(assistant.raf);
      assistant.raf = null;
    }
    removeTyping(assistant);
    assistant.md.classList.remove("is-streaming");
    if (assistant.content.trim()) {
      assistant.md.innerHTML = renderMarkdown(assistant.content);
    } else if (options.failed) {
      assistant.md.innerHTML = "";
    } else if (options.aborted) {
      assistant.md.innerHTML = `<p class="source-note" style="border-top:none;padding-top:0">本次生成已停止。</p>`;
    } else {
      assistant.md.innerHTML = `<p>本轮没有生成可显示的内容，请换一种问法再试。</p>`;
    }

    if (assistant.liveEl) {
      if (options.aborted) assistant.liveEl.textContent = "已停止";
      else assistant.liveEl.remove();
    }

    if (options.error) {
      assistant.errorBox.classList.remove("is-hidden");
      assistant.errorBox.textContent = options.error.message || "对话失败，请稍后重试。";
    }

    if (assistant.content.trim()) {
      buildMessageTools(assistant);
      buildFollowups(assistant);
    }
    if (assistant.sources.children.length) {
      assistant.sources.classList.remove("is-hidden");
    }

    if (assistant.content.trim() && state.currentSession && !assistant.sessionRecord) {
      const record = {
        role: "assistant",
        content: assistant.content,
        mode: assistant.mode,
        stage: assistant.stage,
        concept: assistant.concept,
        sources: assistant.sourceData || [],
        graph: assistant.graphData || null,
        at: Date.now(),
        aborted: Boolean(options.aborted)
      };
      state.currentSession.messages.push(record);
      assistant.sessionRecord = record;
      persistCurrentSession();
    }

    if (assistant.content.trim() && assistant.mode === "assessment") {
      buildAssessmentCard(assistant);
    }
    scrollToBottom(false);
  }

  function removeTyping(assistant) {
    if (assistant.typing && assistant.typing.parentNode) {
      assistant.typing.remove();
    }
  }

  function setAssistantLive(assistant, text) {
    if (!assistant.liveEl) return;
    if (!text) {
      assistant.liveEl.remove();
      assistant.liveEl = null;
    } else {
      assistant.liveEl.textContent = text;
    }
  }

  function renderMessageSources(assistant, sources) {
    if (!assistant || !sources.length) return;
    assistant.root._sources = sources;
    assistant.sources.innerHTML = "";
    const label = document.createElement("span");
    label.className = "src-label";
    label.textContent = "本轮依据";
    assistant.sources.appendChild(label);
    sources.slice(0, 4).forEach((source, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "source-chip";
      chip.title = source.title || source.chapter;
      chip.innerHTML = `<span class="chip-index">资料${index + 1}</span><span>${escapeHtml(shortSourceLabel(source))}</span>`;
      chip.addEventListener("click", () => openLibraryById(source.id, source.title || ""));
      assistant.sources.appendChild(chip);
    });
    assistant.sources.classList.remove("is-hidden");
  }

  function shortSourceLabel(source) {
    const chapter = (source.chapter || "").replace(/第四章\s*核心概念（[一二三四五六七八九十]+）/, "核心概念");
    return `${chapter} ${source.pages || ""}`.trim() || "课标资料";
  }

  function buildMessageTools(assistant) {
    assistant.tools.innerHTML = "";
    assistant.tools.classList.remove("is-hidden");

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "tool-btn";
    copy.innerHTML = `<svg><use href="#i-copy"/></svg><span>复制</span>`;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(assistant.content);
        copy.querySelector("span").textContent = "已复制";
        copy.querySelector("use").setAttribute("href", "#i-check");
        setTimeout(() => {
          copy.querySelector("span").textContent = "复制";
          copy.querySelector("use").setAttribute("href", "#i-copy");
        }, 1600);
      } catch (error) {
        showToast("复制失败，请手动选择文本", "warn");
      }
    });

    const graph = document.createElement("button");
    graph.type = "button";
    graph.className = "tool-btn";
    graph.innerHTML = `<svg><use href="#i-graph"/></svg><span>查看图谱</span>`;
    graph.addEventListener("click", () => {
      if (window.innerWidth <= 1180) openDrawer("right");
      flashGraphPanel();
    });

    const experiment = document.createElement("button");
    experiment.type = "button";
    experiment.className = "tool-btn experiment-message-tool";
    experiment.innerHTML = `<svg><use href="#i-flask"/></svg><span>打开实验模拟</span>`;
    experiment.addEventListener("click", openExperiment);

    assistant.tools.append(copy, graph);
    if (shouldOfferDissolutionExperiment(assistant)) {
      assistant.tools.append(experiment);
    }
  }

  const EXPERIMENT_PARTICLES = {
    large: { label: "块状", factor: 1.48, area: "较小" },
    medium: { label: "颗粒", factor: 1, area: "中等" },
    powder: { label: "粉末", factor: 0.68, area: "较大" }
  };

  function updateExperimentTrigger() {
    if (!els.openExperiment) return;
    const visible = state.mode === "inquiry" || state.concept === "物质的变化与化学反应";
    els.openExperiment.classList.toggle("is-hidden", !visible);
  }

  function shouldOfferDissolutionExperiment(assistant) {
    if (!assistant || assistant.mode !== "inquiry") return false;
    return /(溶解|搅拌|颗粒|粉末|白糖)/u.test(assistant.content || "");
  }

  function openExperiment() {
    if (!els.experimentModal) return;
    if (!els.libraryModal.hidden) closeLibrary();
    if (!els.archiveModal.hidden) closeArchive();
    closeDrawers();
    els.experimentModal.hidden = false;
    document.body.classList.add("modal-open");
    renderExperiment();
    setTimeout(() => els.experimentLoad?.focus(), 80);
  }

  function closeExperiment() {
    if (!els.experimentModal) return;
    if (state.experiment.status === "running") {
      clearExperimentTimer();
      state.experiment.status = "loaded";
      state.experiment.progress = 0;
      state.experiment.elapsed = 0;
      state.experiment.result = null;
    }
    els.experimentModal.hidden = true;
    if (els.libraryModal.hidden && els.archiveModal.hidden) {
      document.body.classList.remove("modal-open");
    }
  }

  function calculateExperimentResult() {
    const temperature = Number(state.experiment.temperature) || 20;
    const particle = EXPERIMENT_PARTICLES[state.experiment.particle] || EXPERIMENT_PARTICLES.medium;
    const temperatureFactor = 1.32 - ((temperature - 20) * 0.008);
    const stirringFactor = state.experiment.stirring === "yes" ? 0.68 : 1;
    const seconds = Math.max(8, Math.round(34 * temperatureFactor * particle.factor * stirringFactor * 10) / 10);
    return {
      seconds,
      temperature,
      stirring: state.experiment.stirring,
      particle: state.experiment.particle,
      particleLabel: particle.label,
      particleArea: particle.area
    };
  }

  function markExperimentDirty() {
    if (state.experiment.status === "running") return;
    if (state.experiment.status === "loaded" || state.experiment.status === "complete") {
      state.experiment.status = "idle";
      state.experiment.progress = 0;
      state.experiment.elapsed = 0;
      state.experiment.result = null;
    }
  }

  function loadExperiment() {
    if (state.experiment.status === "running") return;
    state.experiment.status = "loaded";
    state.experiment.progress = 0;
    state.experiment.elapsed = 0;
    state.experiment.result = null;
    renderExperiment();
    showToast("白糖已加入，请点击“开始观察”");
    els.experimentRun?.focus();
  }

  function runExperiment() {
    if (state.experiment.status !== "loaded") return;
    clearExperimentTimer();
    const result = calculateExperimentResult();
    const durationMs = Math.max(2400, Math.min(6500, result.seconds * 100));
    const startedAt = performance.now();
    state.experiment.status = "running";
    state.experiment.progress = 0;
    state.experiment.elapsed = 0;
    state.experiment.result = result;
    renderExperiment();
    state.experiment.timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      state.experiment.progress = progress;
      state.experiment.elapsed = Number((result.seconds * progress).toFixed(1));
      if (progress >= 1) {
        completeExperiment(result);
      } else {
        renderExperiment();
      }
    }, 70);
  }

  function completeExperiment(result) {
    clearExperimentTimer();
    state.experiment.status = "complete";
    state.experiment.progress = 1;
    state.experiment.elapsed = result.seconds;
    state.experiment.result = result;
    state.experiment.records.unshift({
      id: Date.now(),
      ...result
    });
    state.experiment.records = state.experiment.records.slice(0, 8);
    renderExperiment();
    showToast(`观察完成：模拟用时 ${formatExperimentSeconds(result.seconds)}`);
  }

  function clearExperimentTimer() {
    if (!state.experiment.timer) return;
    clearInterval(state.experiment.timer);
    state.experiment.timer = null;
  }

  function resetExperiment() {
    clearExperimentTimer();
    state.experiment.status = "idle";
    state.experiment.progress = 0;
    state.experiment.elapsed = 0;
    state.experiment.result = null;
    renderExperiment();
  }

  function clearExperimentRecords() {
    state.experiment.records = [];
    renderExperiment();
    showToast("观察记录已清空");
  }

  function formatExperimentSeconds(seconds) {
    return Number.isFinite(Number(seconds)) ? `${Number(seconds).toFixed(1)} s` : "—";
  }

  function buildExperimentInference() {
    const records = state.experiment.records;
    if (!records.length) return "先完成一次模拟，再根据记录写出你的结论。";
    if (records.length === 1) return "已有一条记录。再只改变一个条件做一次，才能比较它对溶解快慢的影响。";
    const latest = records[0];
    const previous = records[1];
    const changed = [];
    if (latest.temperature !== previous.temperature) changed.push("水温");
    if (latest.stirring !== previous.stirring) changed.push("搅拌方式");
    if (latest.particle !== previous.particle) changed.push("颗粒大小");
    if (changed.length !== 1) return "这两次同时改变了多个条件，暂时不能把差异归因给某一个因素。";
    const direction = latest.seconds < previous.seconds ? "缩短" : latest.seconds > previous.seconds ? "延长" : "没有明显改变";
    return `只改变${changed[0]}时，模拟用时由 ${formatExperimentSeconds(previous.seconds)} 变为 ${formatExperimentSeconds(latest.seconds)}，${direction}。还可以重复实验，检查结果是否稳定。`;
  }

  function renderExperimentRecords() {
    if (!els.experimentRecords) return;
    if (!state.experiment.records.length) {
      els.experimentRecords.innerHTML = '<div class="experiment-record-empty">完成一次模拟后，结果会出现在这里。你可以改变一个条件再做一次。</div>';
      return;
    }
    const rows = state.experiment.records.map((record, index) => `
      <div class="experiment-record-row">
        <span class="record-index">${String(state.experiment.records.length - index).padStart(2, "0")}</span>
        <span><strong>${record.temperature}°C</strong><small>水温</small></span>
        <span><strong>${record.stirring === "yes" ? "玻璃棒搅拌" : "不搅拌"}</strong><small>操作</small></span>
        <span><strong>${escapeHtml(record.particleLabel)}</strong><small>颗粒</small></span>
        <span class="record-time"><strong>${formatExperimentSeconds(record.seconds)}</strong><small>模拟用时</small></span>
      </div>
    `).join("");
    els.experimentRecords.innerHTML = rows;
  }

  function renderExperimentSolute(experiment) {
    const progress = experiment.status === "complete"
      ? 1
      : experiment.status === "running"
        ? Math.max(0, Math.min(1, experiment.progress))
        : 0;
    const moving = experiment.status === "running";
    const stirring = moving && experiment.stirring === "yes";
    const motion = Math.sin(Math.PI * progress);
    $$(".solute-particles i", els.experimentBench).forEach((particle, index) => {
      // Each visible solid shrinks with the same progress used by the timer.
      // Slightly different rates prevent all pieces from disappearing at once.
      const dissolved = Math.min(1, progress * (1 + (index % 4) * 0.06));
      const remaining = Math.max(0, 1 - dissolved);
      const scale = Math.pow(remaining, 0.65);
      const angle = progress * Math.PI * 8 + index * 0.8;
      const x = stirring ? Math.sin(angle) * (7 + index % 3 * 3) * motion : 0;
      const y = stirring ? -(5 + Math.cos(angle) * 5) * motion : 0;
      const rotation = stirring ? Math.sin(angle) * 24 * motion : 0;
      particle.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      particle.style.opacity = String(Math.min(1, remaining * 5));
    });
  }

  function renderExperiment() {
    if (!els.experimentModal) return;
    const experiment = state.experiment;
    const result = experiment.result;
    const statusLabels = {
      idle: "准备开始",
      loaded: "已加入白糖",
      running: "正在观察",
      complete: "观察完成"
    };
    els.experimentTemperature.value = String(experiment.temperature);
    els.experimentTemperatureValue.textContent = `${experiment.temperature}°C`;
    $$('[data-stirring]', els.experimentStirring).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.stirring === experiment.stirring);
      button.disabled = experiment.status === "running";
    });
    $$('[data-particle]', els.experimentParticle).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.particle === experiment.particle);
      button.disabled = experiment.status === "running";
    });
    els.experimentTemperature.disabled = experiment.status === "running";
    els.experimentStatus.textContent = statusLabels[experiment.status] || statusLabels.idle;
    els.experimentBench.dataset.status = experiment.status;
    els.experimentBench.dataset.particle = experiment.particle;
    els.experimentBench.dataset.stirring = experiment.stirring;
    renderExperimentSolute(experiment);
    els.experimentProgressText.textContent = `${Math.round(experiment.progress * 100)}%`;
    els.experimentProgressBar.style.width = `${Math.round(experiment.progress * 100)}%`;
    els.experimentTimer.textContent = experiment.status === "complete"
      ? formatExperimentSeconds(result?.seconds)
      : experiment.status === "running"
        ? formatExperimentSeconds(experiment.elapsed)
        : "—";
    const observations = {
      idle: "先加入白糖，再开始观察",
      loaded: "白糖已加入，准备观察",
      running: experiment.stirring === "yes" ? "玻璃棒正在搅拌，糖块逐渐变小、溶解…" : "静置观察：糖块正在逐渐溶解…",
      complete: "白糖已完全溶解，看不到固体糖块"
    };
    els.experimentObservation.textContent = observations[experiment.status] || observations.idle;
    els.experimentLoad.disabled = experiment.status === "running";
    els.experimentLoad.querySelector("span").textContent = experiment.status === "complete" ? "重新加入" : experiment.status === "loaded" ? "已加入" : "加入白糖";
    els.experimentRun.disabled = experiment.status !== "loaded";
    els.experimentRun.querySelector("span").textContent = experiment.status === "complete" ? "再次观察" : "开始观察";
    if (experiment.status === "complete" && result) {
      els.experimentResultNote.textContent = `白糖完全溶解的模拟用时为 ${formatExperimentSeconds(result.seconds)}。白糖仍在水中，只是看不到固体糖块了。`;
    } else if (experiment.status === "loaded") {
      els.experimentResultNote.textContent = "条件已经设定。点击“开始观察”，记录白糖达到均匀状态的时间。";
    } else {
      els.experimentResultNote.textContent = "建议每次只改变一个条件，这样才能把差异归因给该因素。";
    }
    els.experimentInference.textContent = buildExperimentInference();
    els.sendExperimentConclusion.disabled = experiment.records.length === 0;
    renderExperimentRecords();
  }

  function sendExperimentConclusion() {
    if (!state.experiment.records.length) {
      showToast("至少完成一次模拟后，再带回实验记录。", "warn");
      return;
    }
    const summary = state.experiment.records.slice(0, 5).reverse().map((record, index) =>
      `第${index + 1}次：${record.temperature}°C，${record.stirring === "yes" ? "玻璃棒搅拌" : "不搅拌"}，${record.particleLabel}，用时${formatExperimentSeconds(record.seconds)}`
    ).join("；");
    const prompt = `我完成了“溶解快慢”模拟实验。保持水量100mL、白糖10g和容器不变，观察记录是：${summary}。请根据这些记录帮我判断结论是否合理，并指出还需要控制哪些变量。`;
    closeExperiment();
    setMode("inquiry", { silent: true });
    fillComposer(prompt);
    showToast("实验记录已带回追问区");
  }

  const FOLLOWUP_MODE_RULES = [
    {
      mode: "inquiry",
      strong: [/怎样探究|如何探究|探究实验|设计实验|控制变量|公平实验|记录证据/u],
      words: ["探究", "实验", "假设", "变量", "材料", "步骤", "测量", "验证", "改进"]
    },
    {
      mode: "causal",
      strong: [/为什么|如何导致|怎么产生|因果关系|发生机制/u],
      words: ["原因", "条件", "过程", "结果", "影响", "机制", "导致"]
    },
    {
      mode: "compare",
      strong: [/比较.*区别|对比.*异同|有什么不同|哪个更/u],
      words: ["比较", "对比", "区别", "不同", "异同", "差异", "相同"]
    },
    {
      mode: "project",
      strong: [/工程方案|跨学科项目|解决实际问题|设计.*作品|制作.*装置/u],
      words: ["项目", "工程", "方案", "作品", "制作", "建造", "改造"]
    },
    {
      mode: "assessment",
      strong: [/测评|小测|测试一下|给我出题|出[^。！？\n]{0,8}题|检测[^。！？\n]{0,8}理解|评价我的作答/u],
      words: ["练习", "题目", "测试", "评估", "打分", "作答", "错题", "检测", "出题"]
    },
    {
      mode: "graph",
      strong: [/知识图谱|关系图|上下游关系|展开节点|知识网络/u],
      words: ["图谱", "节点", "关系", "连接", "结构图"]
    }
  ];

  function inferFollowupMode(question, fallbackMode = state.mode) {
    const text = String(question || "").replace(/\s+/g, "");
    if (!text) return fallbackMode;
    const ranked = FOLLOWUP_MODE_RULES.map((rule, index) => {
      const strongScore = rule.strong.reduce((score, pattern) => score + (pattern.test(text) ? 3 : 0), 0);
      const wordScore = rule.words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
      return { mode: rule.mode, score: strongScore + wordScore, index };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 2) return MODE_META[fallbackMode] ? fallbackMode : "explain";
    if (second && best.score === second.score && MODE_META[fallbackMode] && best.mode !== fallbackMode) {
      return fallbackMode;
    }
    return best.mode;
  }

  function fillFollowupQuestion(question, fallbackMode = state.mode) {
    const inferredMode = inferFollowupMode(question, fallbackMode);
    if (inferredMode && inferredMode !== state.mode) {
      setMode(inferredMode, { silent: true });
      showToast(`已自动切换到「${MODE_META[inferredMode].name}」`);
    }
    fillComposer(question);
  }

  function buildFollowups(assistant) {
    const questions = extractQuestions(assistant.content);
    if (!questions.length) return;
    assistant.followups.innerHTML = '<span>接着追问</span>';
    questions.slice(0, 3).forEach((question) => {
      const inferredMode = inferFollowupMode(question, assistant.mode);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "followup-chip";
      button.innerHTML = `<span class="followup-question">${escapeHtml(question)}</span><small>${escapeHtml(MODE_META[inferredMode]?.name || "概念讲解")}</small>`;
      button.title = `${question}\n发送时自动使用「${MODE_META[inferredMode]?.name || "概念讲解"}」模式`;
      button.addEventListener("click", () => fillFollowupQuestion(question, assistant.mode));
      assistant.followups.appendChild(button);
    });
    assistant.followups.classList.remove("is-hidden");
  }

  function extractQuestions(markdown) {
    const section = markdown.split(/递进探究问题/).pop() || "";
    const questions = [];
    section.split("\n").forEach((line) => {
      const match = line.match(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)$/) || line.match(/^\s*\d+[.、]\s*(.+)$/);
      if (match) {
        const clean = stripMarkdown(match[1]).replace(/（资料[^）]*）/g, "").trim();
        if (clean.length >= 4 && !questions.includes(clean)) questions.push(clean);
      }
    });
    return questions;
  }

  function stripMarkdown(text) {
    return String(text)
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/#+\s*/g, "")
      .trim();
  }

  /* ========================================================
     Assessment feedback loop
     ======================================================== */

  function buildAssessmentCard(assistant, existingAssessment = null, existingAnswer = "") {
    if (!assistant || !assistant.root || assistant.root.querySelector(".assessment-card")) return;
    const card = document.createElement("section");
    card.className = "assessment-card";
    const head = document.createElement("div");
    head.className = "assessment-head";
    head.innerHTML = `
      <span class="assessment-title"><svg><use href="#i-target"/></svg>素养测评 · 作答区</span>
      <span class="assessment-badge">4 项核心素养</span>
    `;
    const desc = document.createElement("p");
    desc.className = "assessment-desc";
    desc.textContent = "把你的推理过程写下来。格物会根据当前学段和课标证据，给出分项诊断与下一步建议。";
    const form = document.createElement("div");
    form.className = "assessment-form";
    const textarea = document.createElement("textarea");
    textarea.className = "assessment-input";
    textarea.maxLength = 6000;
    textarea.placeholder = "例如：我会先……再比较……证据是……";
    textarea.value = existingAnswer || "";
    const actions = document.createElement("div");
    actions.className = "assessment-actions";
    const hint = document.createElement("span");
    hint.className = "assessment-hint";
    hint.textContent = "不确定也可以写“我的猜想是……”，反馈会指出证据缺口。";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "assess-submit";
    submit.textContent = "提交并获取反馈";
    actions.append(hint, submit);
    form.append(textarea, actions);
    const result = document.createElement("div");
    result.className = "assessment-result is-hidden";
    card.append(head, desc, form, result);
    assistant.body.appendChild(card);

    submit.addEventListener("click", () => submitAssessment(assistant, card, textarea, submit, result));
    if (existingAssessment) {
      renderAssessmentResult(card, {
        assessment: existingAssessment,
        answer: existingAnswer,
        sources: assistant.sessionRecord?.assessmentSources || assistant.sourceData || []
      });
    }
  }

  async function submitAssessment(assistant, card, textarea, submit, result) {
    const answer = textarea.value.trim();
    if (!answer) {
      textarea.focus();
      showToast("先写下你的思考，再提交评估。", "warn");
      return;
    }
    submit.disabled = true;
    submit.textContent = "正在评估…";
    result.classList.remove("is-hidden");
    result.innerHTML = `<div class="assessment-loading"><i></i><i></i><i></i><span>正在对照课标证据诊断…</span></div>`;
    try {
      const questions = extractQuestions(assistant.content);
      const questionText = questions.length
        ? questions.join("\n")
        : assistant.content.slice(0, 2000);
      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          stage: assistant.stage || state.stage,
          concept: assistant.concept || state.concept,
          question: questionText,
          answer,
          context: assistant.content.slice(0, 10000)
        })
      });
      if (!response.ok) {
        let detail = "评估服务暂时不可用";
        try {
          const data = await response.json();
          detail = data.error || data.detail || detail;
        } catch (error) { /* no-op */ }
        throw new Error(detail);
      }
      const data = await response.json();
      const record = {
        assessment: data.assessment,
        answer,
        sources: data.sources || [],
        at: Date.now()
      };
      const sessionRecord = assistant.sessionRecord;
      if (sessionRecord) {
        sessionRecord.assessment = data.assessment;
        sessionRecord.answer = answer;
        sessionRecord.assessmentSources = data.sources || [];
        persistCurrentSession();
      }
      renderAssessmentResult(card, record);
      showToast("评估完成，已保存到学习档案");
    } catch (error) {
      console.error(error);
      result.innerHTML = `<div class="message-error">${escapeHtml(error.message || "评估失败，请重试。")}</div>`;
      submit.disabled = false;
      submit.textContent = "重新提交";
    }
  }

  function renderAssessmentResult(card, record) {
    const assessment = record.assessment;
    if (!assessment) return;
    card.classList.add("is-complete");
    const form = card.querySelector(".assessment-form");
    if (form) form.classList.add("is-hidden");
    const result = card.querySelector(".assessment-result");
    if (!result) return;
    result.classList.remove("is-hidden");
    result.innerHTML = "";

    const verdictClass = assessment.verdict === "掌握"
      ? "is-mastered"
      : assessment.verdict === "需要复习"
        ? "is-review"
        : "is-partial";
    const scoreColor = assessment.verdict === "掌握"
      ? "#0f766e"
      : assessment.verdict === "需要复习"
        ? "#be123c"
        : "#b45309";

    const top = document.createElement("div");
    top.className = "assess-top";
    const score = document.createElement("div");
    score.className = "assess-score";
    score.style.setProperty("--score", assessment.score);
    score.style.setProperty("--score-color", scoreColor);
    score.innerHTML = `<strong>${Number(assessment.score) || 0}</strong><span>综合得分</span>`;
    const verdictWrap = document.createElement("div");
    verdictWrap.className = "assess-verdict-wrap";
    const verdict = document.createElement("span");
    verdict.className = `assess-verdict ${verdictClass}`;
    verdict.textContent = assessment.verdict;
    const verdictNote = document.createElement("p");
    verdictNote.textContent = "依据当前学段学业要求与作答中的证据给出，不是标准化考试分数。";
    verdictWrap.append(verdict, verdictNote);
    top.append(score, verdictWrap);

    const bars = document.createElement("div");
    bars.className = "literacy-bars";
    Object.entries(LITERACY_COLORS).forEach(([name, color]) => {
      const value = Math.max(0, Math.min(100, Number(assessment.literacy?.[name]) || 0));
      const row = document.createElement("div");
      row.className = "literacy-row";
      row.innerHTML = `<span>${name}</span><div class="literacy-bar"><i style="--bar-color:${color}"></i></div><strong>${value}</strong>`;
      bars.appendChild(row);
      requestAnimationFrame(() => {
        const fill = row.querySelector(".literacy-bar i");
        if (fill) fill.style.width = `${value}%`;
      });
    });

    const points = document.createElement("div");
    points.className = "assess-points";
    [["做得好的", assessment.strengths], ["可以改进", assessment.gaps]].forEach(([label, items]) => {
      const block = document.createElement("div");
      block.className = "assess-point";
      const title = document.createElement("strong");
      title.textContent = label;
      const list = document.createElement("ul");
      const values = Array.isArray(items) && items.length ? items : ["暂无具体条目"];
      values.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      block.append(title, list);
      points.appendChild(block);
    });

    const feedback = document.createElement("p");
    feedback.className = "assess-feedback";
    feedback.textContent = assessment.feedback;

    const next = document.createElement("div");
    next.className = "assess-next";
    const nextLabel = document.createElement("span");
    nextLabel.textContent = "NEXT";
    const nextText = document.createElement("p");
    nextText.textContent = assessment.next_step || "回到图谱，选一个节点继续追问。";
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.textContent = "接着问 →";
    nextButton.addEventListener("click", () => fillComposer(assessment.next_step || "我想继续探究这个节点"));
    next.append(nextLabel, nextText, nextButton);

    result.append(top, bars, points, feedback, next);

    if (record.sources?.length) {
      const sourceRow = document.createElement("div");
      sourceRow.className = "assess-sources";
      record.sources.slice(0, 3).forEach((source, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `资料${index + 1} · ${source.pages || ""}`;
        button.title = source.title || "";
        button.addEventListener("click", () => openLibraryById(source.id, source.title || ""));
        sourceRow.appendChild(button);
      });
      result.appendChild(sourceRow);
    }
    requestAnimationFrame(() => scrollToBottom(true));
  }

  function setStreaming(value) {
    state.streaming = value;
    const composer = els.composerForm;
    composer.classList.toggle("is-streaming", value);
    els.sendBtn.title = value ? "停止生成" : "发送问题";
    els.modelChip.classList.toggle("is-busy", value);
    if (value) {
      setAssistantLive(state.currentAssistant, "正在构建图谱…");
    }
  }

  function stopStreaming() {
    if (!state.streaming || !state.controller) return;
    state.controller.abort();
  }

  function setModelStatus(configured) {
    if (!els.modelChip) return;
    els.modelChip.classList.toggle("is-offline", !configured);
    if (configured) {
      els.modelName.textContent = prettyModelName(state.config?.model || "qwen3.8-27b");
      els.modelChip.title = "模型服务已配置 · 阿里云百炼";
    } else {
      els.modelName.textContent = "模型未连接";
      els.modelChip.title = "未配置 DASHSCOPE_API_KEY";
      showToast("未检测到模型 API Key，请检查 .env 配置。", "warn");
    }
  }

  function isNearBottom() {
    const el = els.chatScroll;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 180;
  }

  function scrollToBottom(force = false) {
    if (!force && !isNearBottom()) return;
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
  }

  function addSystemNote(text) {
    hideWelcome();
    const div = document.createElement("div");
    div.className = "system-note";
    div.textContent = text;
    els.conversation.appendChild(div);
    scrollToBottom(true);
  }

  /* ========================================================
     Markdown
     ======================================================== */

  function renderMarkdown(source) {
    let text = String(source || "").replace(/\r\n/g, "\n");
    text = text.replace(/<graph>[\s\S]*$/i, "").replace(/<\/?graph>/gi, "");
    const lines = text.split("\n");
    const out = [];
    let i = 0;
    let nodeSeen = false;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }

      if (/^\s*```/.test(line)) {
        const language = line.trim().replace(/^```/, "").trim();
        const code = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        out.push(`<pre><code${language ? ` class="language-${escapeAttr(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = Math.max(1, Math.min(4, heading[1].length));
        const content = heading[2].trim();
        const cls = content.includes("科学知识图谱")
          ? ' class="graph-heading"'
          : content.includes("递进探究问题")
            ? ' class="question-heading"'
            : "";
        out.push(`<h${level}${cls}>${inline(content)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        out.push("<hr>");
        i += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        out.push(`<blockquote>${quote.map((part) => `<p>${inline(part)}</p>`).join("")}</blockquote>`);
        continue;
      }

      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
        const header = splitTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        out.push(
          `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
        );
        continue;
      }

      if (/^【[^】]+】[：:]/.test(line.trim())) {
        const meta = [];
        while (i < lines.length && /^【[^】]+】[：:]/.test(lines[i].trim())) {
          const match = lines[i].trim().match(/^【([^】]+)】[：:]\s*(.*)$/);
          if (match) {
            meta.push(`<div class="graph-meta-line"><span>${inline(match[1])}</span><span>${inline(match[2])}</span></div>`);
          }
          i += 1;
        }
        out.push(`<div class="graph-meta">${meta.join("")}</div>`);
        continue;
      }

      if (/^\s*↳/.test(line)) {
        out.push(renderBranchLine(line));
        i += 1;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line) && (line.includes("｜") || line.includes(" | "))) {
        const isRoot = /学科核心概念/.test(line) && !nodeSeen;
        if (isRoot) nodeSeen = true;
        out.push(renderNodeLine(line, isRoot));
        i += 1;
        continue;
      }

      if (/^\s*[①②③④⑤⑥⑦⑧⑨⑩]/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[①②③④⑤⑥⑦⑧⑨⑩]/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*/, ""));
          i += 1;
        }
        out.push(`<ol class="question-list">${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
        continue;
      }

      if (/^\s*\d+[.、]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.、]\s+/, ""));
          i += 1;
        }
        out.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
          i += 1;
        }
        out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
        continue;
      }

      const paragraph = [line];
      i += 1;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4})\s+/.test(lines[i]) &&
        !/^\s*(```|>|↳|[-*]\s+|\d+[.、]\s+|[①②③④⑤⑥⑦⑧⑨⑩])/.test(lines[i]) &&
        !/^【[^】]+】[：:]/.test(lines[i].trim()) &&
        !/^\s*(---+|\*\*\*+|___+)\s*$/.test(lines[i])
      ) {
        paragraph.push(lines[i]);
        i += 1;
      }
      const joined = paragraph.join("\n");
      if (/^本轮依据|^依据[：:]/m.test(joined.trim())) {
        out.push(`<p class="source-note">${inline(joined.trim())}</p>`);
      } else {
        out.push(`<p>${inline(joined).replace(/\n/g, "<br>")}</p>`);
      }
    }

    return out.join("");
  }

  function splitTableRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);
    return value.split("|").map((cell) => cell.trim());
  }

  function renderNodeLine(line, isRoot) {
    const content = line.replace(/^\s*[-*]\s+/, "").trim();
    const parts = content.split(/｜|\s\|\s/).map((part) => part.trim()).filter(Boolean);
    const name = parts[0] || content;
    const type = parts[1] || "子概念";
    const stage = parts[2] || "";
    const literacy = parts[3] || "";
    const classes = ["node-row"];
    if (isRoot || /学科核心概念/.test(type)) classes.push("root-row");
    return `<div class="${classes.join(" ")}">
      <span class="node-name">${inline(name)}</span>
      <span class="node-sep">◆</span>
      <span class="node-tag">${inline(type)}</span>
      ${stage ? `<span class="node-tag stage">${inline(stage)}</span>` : ""}
      ${literacy ? `<span class="node-tag literacy">${inline(literacy)}</span>` : ""}
    </div>`;
  }

  function renderBranchLine(line) {
    const content = line.replace(/^\s*↳\s*/, "");
    const relationMatch = content.match(/【关系[：:]\s*([^】]+)】/);
    const relation = relationMatch ? relationMatch[1] : "关联";
    const after = content.replace(/【关系[：:][^】]+】/, "").replace(/^[→\s]+/, "");
    const parts = after.split(/｜|\s\|\s/).map((part) => part.trim()).filter(Boolean);
    const name = parts[0] || after;
    const tags = parts.slice(1).filter(Boolean).join(" · ");
    return `<div class="node-branch">
      <span class="relation">${inline(relation)}</span>
      <span><span class="branch-name">${inline(name)}</span>${tags ? `<span class="branch-tags">${inline(tags)}</span>` : ""}</span>
    </div>`;
  }

  function inline(value) {
    const codeTokens = [];
    let text = escapeHtml(String(value));
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      const token = `CODE${codeTokens.length}`;
      codeTokens.push(`<code>${code}</code>`);
      return token;
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    text = text.replace(/\[资料(\d+)([^\]]*)\]/g, '<button type="button" class="cite" data-cite-index="$1" title="查看资料$1原文">资料$1$2</button>');
    text = text.replace(/（资料\s*(\d+)([^）]*)）/g, '<button type="button" class="cite" data-cite-index="$1" title="查看资料$1原文">（资料$1$2）</button>');
    codeTokens.forEach((html, index) => {
      text = text.replace(`CODE${index}`, html);
    });
    return text;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\s+/g, "");
  }

  /* ========================================================
     Graph data
     ======================================================== */

  function buildOverviewGraph() {
    const nodes = [{
      id: "root",
      label: "科学",
      type: "学科核心概念",
      stage: "1–9年级",
      literacy: "科学观念",
      root: true,
      note: "以课标十三个学科核心概念为骨架，向外连接四大领域与四条跨学科视角。"
    }];
    const edges = [];

    state.curriculum.domains.forEach((domain) => {
      const conceptNames = domain.concepts
        .map((id) => state.curriculum.concepts.find((item) => item.id === id)?.name)
        .filter(Boolean);
      nodes.push({
        id: `domain-${domain.id}`,
        label: domain.name,
        type: "学科核心概念",
        stage: "1–9年级",
        literacy: "科学观念",
        color: domain.color,
        note: `包含 ${conceptNames.length} 个核心概念：${conceptNames.slice(0, 3).join("、")}${conceptNames.length > 3 ? "等" : ""}。`,
        meta: { kind: "domain", domainId: domain.id }
      });
      edges.push({ from: "root", to: `domain-${domain.id}`, relation: "包含" });
    });

    state.curriculum.crosscutting.forEach((item) => {
      nodes.push({
        id: `cross-${item.id}`,
        label: item.name,
        type: "跨学科项目",
        stage: "1–9年级",
        literacy: "科学思维",
        color: item.color,
        note: item.summary,
        meta: { kind: "crosscutting", crossId: item.id }
      });
      edges.push({ from: "root", to: `cross-${item.id}`, relation: "跨学科视角", cross: true });
    });

    return {
      title: "课程总览",
      stage: "1–9年级",
      concept: "义务教育科学课程",
      nodes,
      edges,
      overview: true
    };
  }

  function buildConceptPreview(concept) {
    const stageFocus = concept.stage_focus?.[state.stage];
    const stageName = state.curriculum.stages.find((item) => item.id === state.stage)?.name || state.stage;
    const coverage = conceptCoverage(concept.id);
    const note = coverage?.level === "detail"
      ? (stageFocus
        ? `${stageFocus.focus} 本学段任务：${stageFocus.task}`
        : concept.summary)
      : `${stageFocus?.focus || concept.summary} 当前资料库提供${coverage?.label || "框架摘要"}和学段活动索引；逐条内容要求仍需以原 PDF 核对。`;
    const nodes = [{
      id: "root",
      label: concept.name,
      type: "学科核心概念",
      stage: stageName,
      literacy: "科学观念",
      root: true,
      note
    }];
    const edges = [];
    const literacies = ["科学观念", "科学思维", "探究实践", "态度责任"];
    (concept.tags || []).forEach((tag, index) => {
      nodes.push({
        id: `tag-${index}`,
        label: tag,
        type: "子概念",
        stage: stageName,
        literacy: literacies[index % literacies.length],
        note: stageFocus ? `本学段侧重：${stageFocus.focus}` : `「${concept.name}」下的关键学习线索，可在对话中继续展开。`,
        meta: { conceptId: concept.id }
      });
      edges.push({ from: "root", to: `tag-${index}`, relation: "包含" });
    });
    return {
      title: concept.name,
      stage: stageName,
      concept: concept.name,
      nodes,
      edges,
      provisional: true,
      sourcePages: concept.pages
    };
  }

  function expandDomain(domainId) {
    const domain = state.curriculum.domains.find((item) => item.id === domainId);
    if (!domain) return;
    const concepts = domain.concepts
      .map((id) => state.curriculum.concepts.find((item) => item.id === id))
      .filter(Boolean);
    const nodes = [{
      id: "root",
      label: domain.name,
      type: "学科核心概念",
      stage: "1–9年级",
      literacy: "科学观念",
      root: true,
      color: domain.color,
      note: `包含 ${concepts.length} 个核心概念。点击概念节点，可把它设为当前学习主题。`
    }];
    const edges = [];
    concepts.forEach((concept) => {
      nodes.push({
        id: `concept-${concept.id}`,
        label: concept.name,
        type: "学科核心概念",
        stage: "1–9年级",
        literacy: "科学观念",
        color: domain.color,
        note: concept.summary,
        meta: { conceptId: concept.id, kind: "concept" }
      });
      edges.push({ from: "root", to: `concept-${concept.id}`, relation: "包含" });
    });
    setGraph({ title: domain.name, stage: "1–9年级", concept: domain.name, nodes, edges }, { badge: "领域展开 · 点击概念" });
    els.graphBadge.textContent = "领域展开 · 点击概念";
    els.graphBadge.classList.add("is-ready");
  }

  function normalizeGraph(graph) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
    if (graph.nodes.length < 2) return null;
    const nodes = graph.nodes.map((node, index) => ({
      id: String(node.id || `n${index + 1}`),
      label: String(node.label || "未命名节点"),
      type: String(node.type || "子概念"),
      stage: String(node.stage || graph.stage || ""),
      literacy: LITERACY_COLORS[node.literacy] ? node.literacy : "科学观念",
      note: String(node.note || ""),
      root: Boolean(node.root),
      meta: node.meta || null
    }));
    if (!nodes.some((node) => node.root)) nodes[0].root = true;
    const ids = new Set(nodes.map((node) => node.id));
    const edges = graph.edges
      .filter((edge) => ids.has(String(edge.from)) && ids.has(String(edge.to)))
      .map((edge) => ({
        from: String(edge.from),
        to: String(edge.to),
        relation: String(edge.relation || "包含"),
        label: String(edge.label || edge.relation || "包含")
      }));
    if (!edges.length) return null;
    return {
      title: String(graph.title || "科学知识图谱"),
      stage: String(graph.stage || ""),
      concept: String(graph.concept || ""),
      nodes,
      edges,
      fromModel: true
    };
  }

  function setGraph(graph, options = {}) {
    if (!graph) return;
    state.graph = graph;
    state.graphZoom = 1;
    state.selectedNodeId = graph.nodes.find((node) => node.root)?.id || graph.nodes[0].id;
    state.focusNodeId = state.selectedNodeId;
    state.focusTrail = [];
    els.graphTitle.textContent = graph.fromModel ? (graph.title || "关系探索") : "关系探索";
    els.graphCount.textContent = `${graph.nodes.length} 节点 · ${graph.edges.length} 关系`;
    els.graphBadge.textContent = options.badge || (options.fromModel ? "本轮图谱 · 已可视化" : "图谱已就绪");
    els.graphBadge.classList.toggle("is-ready", Boolean(options.fromModel || options.badge));
    els.graphStage.dataset.view = state.graphView;
    renderGraph();
    renderRelations();
    updateNodeDetailForId(state.selectedNodeId);
  }

  function setGraphView(view) {
    const nextView = view === "graph" ? "graph" : "relations";
    state.graphView = nextView;
    els.graphStage.dataset.view = nextView;
    $$('button[data-graph-view]', els.graphViewSwitch).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.graphView === nextView);
    });
    if (nextView === "relations") {
      renderRelations();
    } else {
      renderGraph();
    }
  }

  function renderRelations() {
    const graph = state.graph;
    if (!graph) {
      els.focusCard.classList.add("is-empty");
      els.focusCard.innerHTML = `
        <div class="focus-empty">
          <strong>从左侧开始探索</strong>
          <p>选择一个核心概念，关系节点会在这里展开。</p>
        </div>
      `;
      els.relationGroups.innerHTML = '<div class="relation-empty">图谱数据正在准备中…</div>';
      els.relationPath.textContent = "课程总览";
      els.relationBack.disabled = true;
      return;
    }

    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const fallback = graph.nodes.find((node) => node.root) || graph.nodes[0];
    const focus = nodesById.get(state.focusNodeId)
      || nodesById.get(state.selectedNodeId)
      || fallback;
    if (!focus) return;
    state.focusNodeId = focus.id;

    const pathLabels = [...state.focusTrail, focus.id]
      .map((id) => nodesById.get(id)?.label)
      .filter(Boolean);
    els.relationPath.textContent = pathLabels.slice(-3).join(" · ") || graph.title || "课程总览";
    els.relationBack.disabled = state.focusTrail.length === 0;

    const accent = focus.color || LITERACY_COLORS[focus.literacy] || "#0f766e";
    const note = focus.root
      ? (graph.overview
        ? "从领域或跨学科视角开始探索，点击下方节点进入下一层。"
        : "从下面的关系节点继续探索，必要时再回到对话中提问。")
      : (focus.note || `这是一个「${focus.literacy || "科学观念"}」取向的${focus.type || "学习节点"}，可沿关系继续探索。`);
    const focusType = focus.root
      ? (graph.overview ? "课程总览" : "当前主题")
      : (focus.type || "学习节点");
    els.focusCard.classList.remove("is-empty");
    els.focusCard.innerHTML = `
      <div class="focus-card-top">
        <span class="focus-card-dot" style="--accent:${escapeAttr(accent)}"></span>
        <span class="focus-card-type">${escapeHtml(focusType)}</span>
        <span class="focus-card-stage">${escapeHtml(focus.stage || graph.stage || "")}</span>
      </div>
      <h3>${escapeHtml(focus.label || "未命名节点")}</h3>
      <p>${escapeHtml(note)}</p>
    `;

    const groups = [];
    const groupMap = new Map();
    graph.edges.forEach((edge) => {
      let targetId = null;
      let incoming = false;
      if (edge.from === focus.id) {
        targetId = edge.to;
      } else if (edge.to === focus.id) {
        targetId = edge.from;
        incoming = true;
      }
      if (!targetId || !nodesById.has(targetId)) return;
      const relation = edge.label || edge.relation || "关联";
      const key = `${incoming ? "in" : "out"}:${relation}`;
      if (!groupMap.has(key)) {
        const group = { relation, incoming, targets: [] };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).targets.push(nodesById.get(targetId));
    });

    if (!groups.length) {
      els.relationGroups.innerHTML = '<div class="relation-empty">这个节点暂时没有可展开的直接关系。可以回到上一级，或在下方继续提问。</div>';
      return;
    }

    els.relationGroups.innerHTML = groups.map((group) => `
      <section class="relation-group">
        <div class="relation-group-head">
          <span class="relation-name${group.incoming ? " is-incoming" : ""}">${escapeHtml(group.relation)}</span>
          <span class="relation-count">${group.targets.length} 个节点</span>
        </div>
        ${group.targets.map((target) => {
          const targetColor = target.color || LITERACY_COLORS[target.literacy] || "#0f766e";
          const targetMeta = [target.type, target.stage].filter(Boolean).join(" · ");
          return `
            <button type="button" class="relation-target" data-focus-node="${escapeAttr(target.id)}" title="查看 ${escapeAttr(target.label)}">
              <span class="target-dot" style="--node-color:${escapeAttr(targetColor)}"></span>
              <span class="target-main">
                <strong>${escapeHtml(target.label || "未命名节点")}</strong>
                <small>${escapeHtml(targetMeta)}</small>
              </span>
              <span class="target-arrow">→</span>
            </button>
          `;
        }).join("")}
      </section>
    `).join("") + '<p class="relation-hint">点击节点可继续沿着知识关系探索</p>';
  }

  function focusRelationNode(nodeId) {
    const graph = state.graph;
    const target = graph?.nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const currentId = state.focusNodeId || state.selectedNodeId;
    if (currentId && currentId !== nodeId) state.focusTrail.push(currentId);
    state.focusNodeId = nodeId;
    state.selectedNodeId = nodeId;
    renderRelations();
    updateNodeDetail(target);
  }

  function relationBack() {
    const previousId = state.focusTrail.pop();
    if (!previousId || !state.graph?.nodes.some((node) => node.id === previousId)) {
      state.focusTrail = [];
      return renderRelations();
    }
    state.focusNodeId = previousId;
    state.selectedNodeId = previousId;
    renderRelations();
    updateNodeDetailForId(previousId);
  }

  function setGraphZoom(value) {
    state.graphZoom = Math.min(1.8, Math.max(0.7, Number(value) || 1));
    applyGraphZoom();
  }

  function applyGraphZoom() {
    const viewport = $(".graph-viewport", els.graphSvg);
    if (!viewport) return;
    viewport.setAttribute(
      "transform",
      `translate(200 200) scale(${state.graphZoom}) translate(-200 -200)`
    );
  }

  function renderGraph() {
    const graph = state.graph;
    els.graphSvg.innerHTML = "";
    if (!graph) return;

    const SVG_NS = "http://www.w3.org/2000/svg";
    const make = (tag, attributes = {}) => {
      const element = document.createElementNS(SVG_NS, tag);
      Object.entries(attributes).forEach(([key, value]) => {
        if (value !== undefined && value !== null) element.setAttribute(key, String(value));
      });
      return element;
    };

    const defs = make("defs");
    const marker = make("marker", {
      id: "graph-arrow",
      viewBox: "0 0 8 8",
      refX: "7",
      refY: "4",
      markerWidth: "4.5",
      markerHeight: "4.5",
      orient: "auto-start-reverse"
    });
    const arrowPath = make("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: "rgba(23,36,33,.23)" });
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    els.graphSvg.appendChild(defs);

    const viewport = make("g", { class: "graph-viewport" });
    els.graphSvg.appendChild(viewport);

    const nodes = graph.nodes;
    const root = nodes.find((node) => node.root) || nodes[0];
    const ids = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
    edges.forEach((edge) => {
      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    });

    const positions = layoutGraphNodes(nodes, edges, root);

    const selected = state.selectedNodeId;
    const connected = new Set([selected]);
    if (selected) {
      adjacency.get(selected)?.forEach((id) => connected.add(id));
    }

    const ringGroup = make("g", { opacity: "0.9" });
    const maxRing = Math.max(...nodes.map((node) => {
      const pos = positions.get(node.id);
      return pos ? Math.hypot(pos.x - 200, pos.y - 194) : 0;
    }));
    if (maxRing > 60) {
      ringGroup.appendChild(make("circle", {
        class: "graph-ring", cx: 200, cy: 194, r: maxRing
      }));
    }
    viewport.appendChild(ringGroup);

    const edgeGroup = make("g");
    edges.forEach((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const bend = Math.min(18, length * 0.11);
      const normalX = -dy / length;
      const normalY = dx / length;
      const controlX = midX + normalX * bend;
      const controlY = midY + normalY * bend;
      const isConnected = selected ? (edge.from === selected || edge.to === selected) : false;
      const isDimmed = selected ? !isConnected : false;
      const path = make("path", {
        class: `graph-edge${edge.cross ? " cross" : ""}${isConnected ? " is-highlighted" : ""}${isDimmed ? " is-dimmed" : ""}`,
        d: `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`,
        "marker-end": "url(#graph-arrow)"
      });
      edgeGroup.appendChild(path);

      if (graph.fromModel && edges.length <= 9 && edge.relation && edge.relation !== "包含") {
        const labelX = 0.25 * from.x + 0.5 * controlX + 0.25 * to.x;
        const labelY = 0.25 * from.y + 0.5 * controlY + 0.25 * to.y;
        const label = make("text", {
          x: labelX.toFixed(2),
          y: (labelY - 3).toFixed(2),
          class: "graph-edge-label",
          "text-anchor": "middle"
        });
        label.textContent = edge.label || edge.relation;
        edgeGroup.appendChild(label);
      }
    });
    viewport.appendChild(edgeGroup);

    const nodeGroup = make("g");
    nodes.forEach((node, index) => {
      const pos = positions.get(node.id);
      if (!pos) return;
      const isRoot = node.id === root.id;
      const isSelected = state.selectedNodeId === node.id;
      const isDimmed = selected ? !connected.has(node.id) : false;
      const color = node.color || LITERACY_COLORS[node.literacy] || "#0f766e";
      const radius = isRoot ? 38 : node.type === "学科核心概念" ? 25 : 19;
      const group = make("g", {
        class: `graph-node${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""} is-entering`,
        transform: `translate(${pos.x} ${pos.y})`,
        tabindex: "0",
        role: "button",
        "aria-label": `${node.label}，${node.type}，${node.literacy}`,
        "data-node-id": node.id
      });
      group.style.animationDelay = `${Math.min(index * 28, 220)}ms`;

      const title = make("title");
      title.textContent = `${node.label} · ${node.type} · ${node.literacy}`;
      group.appendChild(title);

      if (isRoot) {
        group.appendChild(make("circle", { class: "node-shape", r: radius + 8, fill: "none", stroke: color, "stroke-opacity": ".16", "stroke-dasharray": "2 4" }));
        group.appendChild(make("circle", { class: "node-shape", r: radius, fill: "#172421", stroke: "#172421" }));
        group.appendChild(make("circle", { r: 4, fill: "#14b8a6" }));
        const label = make("text", { class: "node-label root-label", y: "4" });
        label.textContent = node.label.length > 8 ? node.label.slice(0, 8) : node.label;
        group.appendChild(label);
      } else {
        const shape = makeNodeShape(make, node, radius, color);
        group.appendChild(shape);
        group.appendChild(make("circle", { r: 2.3, fill: color, "fill-opacity": ".9" }));
        const lines = splitLabel(node.label, 6);
        const below = pos.y > 322;
        const baseY = below ? -radius - 7 - (lines.length - 1) * 10 : radius + 12;
        lines.forEach((lineText, lineIndex) => {
          const label = make("text", {
            class: "node-label",
            y: (baseY + lineIndex * 10).toFixed(1)
          });
          label.textContent = lineText;
          group.appendChild(label);
        });
        if (node.type && nodes.length <= 8) {
          const sub = make("text", { class: "node-sub", y: (below ? baseY - 12 : baseY + lines.length * 9).toFixed(1) });
          sub.textContent = node.literacy;
          group.appendChild(sub);
        }
      }

      group.addEventListener("click", (event) => {
        event.stopPropagation();
        selectGraphNode(node.id);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectGraphNode(node.id);
        }
      });
      nodeGroup.appendChild(group);
    });
    viewport.appendChild(nodeGroup);

    applyGraphZoom();
  }

  function makeNodeShape(make, node, radius, color) {
    const type = node.type || "";
    if (/实验|探究|工程任务|实践活动/.test(type)) {
      return make("rect", {
        class: "node-shape",
        x: -radius,
        y: -radius * 0.82,
        width: radius * 2,
        height: radius * 1.64,
        rx: 7,
        fill: color,
        "fill-opacity": ".12",
        stroke: color,
        "stroke-opacity": ".58"
      });
    }
    if (/模型|科学史实/.test(type)) {
      const d = `M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`;
      return make("path", {
        class: "node-shape",
        d,
        fill: color,
        "fill-opacity": ".11",
        stroke: color,
        "stroke-opacity": ".58"
      });
    }
    return make("circle", {
      class: "node-shape",
      r: radius,
      fill: color,
      "fill-opacity": ".12",
      stroke: color,
      "stroke-opacity": ".58"
    });
  }

  function splitLabel(label, maxChars) {
    const text = String(label || "");
    if (text.length <= maxChars) return [text];
    const first = text.slice(0, maxChars);
    const second = text.slice(maxChars, maxChars * 2 + 1);
    return second ? [first, second] : [first];
  }

  function layoutGraphNodes(nodes, edges, root) {
    const positions = new Map();
    const adjacency = new Map(nodes.map((node) => [node.id, []]));
    edges.forEach((edge) => {
      adjacency.get(edge.from)?.push(edge.to);
      adjacency.get(edge.to)?.push(edge.from);
    });

    const depth = new Map([[root.id, 0]]);
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) || []) {
        if (!depth.has(next)) {
          depth.set(next, (depth.get(current) || 0) + 1);
          queue.push(next);
        }
      }
    }

    const centerX = 200;
    const centerY = 194;
    positions.set(root.id, { x: centerX, y: centerY });

    const layer1 = [];
    const layer2 = [];
    nodes.forEach((node) => {
      if (node.id === root.id) return;
      const nodeDepth = depth.get(node.id) ?? 1;
      if (nodeDepth <= 1) layer1.push(node);
      else layer2.push(node);
    });

    while (layer1.length > 10) {
      layer2.push(layer1.pop());
    }

    const ring1 = layer1.length <= 4 ? 108 : layer1.length <= 6 ? 118 : layer1.length <= 9 ? 130 : 138;
    const ring2 = 158;
    const start = -Math.PI / 2;
    const angleStep1 = (Math.PI * 2) / Math.max(layer1.length, 1);
    layer1.forEach((node, index) => {
      const angle = start + angleStep1 * index + (layer1.length > 1 ? 0 : 0);
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * ring1,
        y: centerY + Math.sin(angle) * ring1
      });
    });
    const angleStep2 = (Math.PI * 2) / Math.max(layer2.length, 1);
    layer2.forEach((node, index) => {
      const angle = start + angleStep2 * index + angleStep2 / 2;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * ring2,
        y: centerY + Math.sin(angle) * ring2
      });
    });
    return positions;
  }

  function selectGraphNode(nodeId) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    state.selectedNodeId = nodeId;
    state.focusNodeId = nodeId;
    state.focusTrail = [];
    renderGraph();
    renderRelations();
    updateNodeDetail(node);
    if (state.graph?.fromModel) {
      els.graphBadge.textContent = `已选择 · ${node.label}`;
      els.graphBadge.classList.add("is-ready");
    }
  }

  function updateNodeDetailForId(nodeId) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId);
    if (node) updateNodeDetail(node);
  }

  function updateNodeDetail(node) {
    if (!node) return;
    const graph = state.graph;
    const showDetail = !node.root || Boolean(graph?.fromModel && !graph?.overview && !graph?.provisional);
    els.nodeDetail.classList.toggle("is-hidden", !showDetail);
    if (!showDetail) {
      state.nodeAction = null;
      els.nodeAction.classList.add("is-hidden");
      return;
    }
    els.nodeType.textContent = node.type || "学习节点";
    els.nodeStage.textContent = node.stage || graph?.stage || "1–9年级";
    els.nodeTitle.textContent = node.label || "未命名节点";
    let note = node.note;
    if (!note) {
      if (node.meta?.kind === "domain") note = "点击下方按钮展开该领域的核心概念。";
      else if (node.meta?.kind === "concept") note = "这是本领域的一个核心概念，点击下方按钮将它设为学习主题。";
      else if (node.meta?.kind === "crosscutting") note = "跨学科视角可以帮助你把不同领域的知识连接起来。";
      else note = `这是一个「${node.literacy}」取向的${node.type}节点，可围绕它继续追问。`;
    }
    els.nodeNote.textContent = note;

    state.nodeAction = null;
    els.nodeAction.classList.add("is-hidden");

    if (node.meta?.kind === "domain") {
      setNodeAction("展开此领域", () => expandDomain(node.meta.domainId));
    } else if (node.meta?.kind === "concept") {
      setNodeAction("以此概念提问", () => {
        const concept = state.curriculum.concepts.find((item) => item.id === node.meta.conceptId);
        if (concept) selectConcept(concept);
      });
    } else if (node.meta?.kind === "crosscutting") {
      setNodeAction("用此视角提问", () => {
        fillComposer(`用「${node.label}」跨学科视角分析一个科学现象，并生成局部图谱`);
      });
    } else if (graph?.fromModel) {
      setNodeAction("围绕此节点继续", () => {
        fillComposer(`展开「${node.label}」节点，并说明它与图中其他节点的关系`);
      });
    } else if (node.root && !graph?.overview && !graph?.provisional) {
      setNodeAction("继续展开", () => fillComposer(`展开「${node.label}」的上下游节点`));
    }
  }

  function setNodeAction(label, action) {
    els.nodeAction.classList.remove("is-hidden");
    $("span", els.nodeAction).textContent = label;
    state.nodeAction = action;
  }

  function flashGraphPanel() {
    const panel = $(".graph-stage");
    if (!panel) return;
    panel.animate(
      [
        { boxShadow: "0 0 0 0 rgba(20,184,166,0)" },
        { boxShadow: "0 0 0 4px rgba(20,184,166,.18)" },
        { boxShadow: "0 0 0 0 rgba(20,184,166,0)" }
      ],
      { duration: 900, easing: "ease-out" }
    );
  }

  /* ========================================================
     Sources
     ======================================================== */

  function renderSources(sources) {
    els.sourcesList.innerHTML = "";
    if (!sources.length) {
      const empty = document.createElement("div");
      empty.className = "sources-empty";
      empty.innerHTML = `<span class="sources-empty-icon"><svg><use href="#i-library"/></svg></span><p>提问后，这里会显示本轮检索到的课标资料片段、摘要与页码。</p>`;
      els.sourcesList.appendChild(empty);
      return;
    }
    sources.forEach((source, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "source-card";
      card.dataset.sourceId = source.id || "";
      card.dataset.sourceTitle = source.title || "";
      card.title = "打开这条资料查看全文";
      card.innerHTML = `
        <div class="source-card-top">
          <span class="source-index">${index + 1}</span>
          <span class="source-card-title">${escapeHtml(source.title || "课标资料")}</span>
          <span class="source-scope ${evidenceClass(source)}">${escapeHtml(evidenceLabel(source))}</span>
          <span class="source-page">${escapeHtml(source.pages || "")}</span>
        </div>
        <p class="source-snippet">${escapeHtml(source.snippet || "")}</p>
        <p class="source-evidence-note">${escapeHtml(source.evidence_note || "")}</p>
        <span class="source-open-hint">查看全文 ↗</span>
      `;
      els.sourcesList.appendChild(card);
    });
  }

  function updateLibraryMeta() {
    if (!state.config) return;
    const totals = state.config.knowledge_coverage?.totals;
    if (!totals) {
      els.libraryMeta.textContent = `已索引 ${state.config.knowledge_count} 个课标知识块`;
      return;
    }
    els.libraryMeta.textContent = `已索引 ${totals.knowledge_blocks} 条 · ${totals.detail_blocks} 条文整理`;
    if (els.libraryRange) {
      els.libraryRange.textContent = `证据层级：${totals.detail_blocks} 条文 · ${totals.stage_blocks} 学段整理 · ${totals.framework_blocks} 框架摘要`;
    }
  }

  /* ========================================================
     Learning archive / sessions
     ======================================================== */

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function loadSessions() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((session) => session && session.id && Array.isArray(session.messages))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, MAX_STORED_SESSIONS);
    } catch (error) {
      console.warn("Could not read learning archive", error);
      return [];
    }
  }

  function saveSessions(sessions) {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
      return true;
    } catch (error) {
      console.warn("Could not save learning archive", error);
      showToast("学习档案保存失败，可能是浏览器存储空间不足。", "warn");
      return false;
    }
  }

  function ensureCurrentSession() {
    if (state.currentSession) return state.currentSession;
    state.currentSession = {
      id: createId(),
      title: "未命名学习会话",
      stage: state.stage,
      concept: state.concept,
      mode: state.mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    return state.currentSession;
  }

  function persistCurrentSession() {
    const session = state.currentSession;
    if (!session || !session.messages.length) return;
    session.stage = state.stage;
    session.concept = state.concept;
    session.mode = state.mode;
    session.updatedAt = Date.now();
    if (!session.title || session.title === "未命名学习会话") {
      const firstQuestion = session.messages.find((item) => item.role === "user")?.content || "";
      session.title = firstQuestion.slice(0, 36) || "未命名学习会话";
    }
    const stored = {
      ...session,
      messages: session.messages.slice(-MAX_STORED_MESSAGES)
    };
    const sessions = loadSessions().filter((item) => item.id !== session.id);
    sessions.unshift(stored);
    state.sessions = sessions.slice(0, MAX_STORED_SESSIONS);
    saveSessions(state.sessions);
    updateArchiveMeta();
    if (!els.archiveModal.hidden) renderArchive();
  }

  function updateArchiveMeta() {
    if (!els.archiveCount) return;
    const count = state.sessions.length;
    els.archiveCount.textContent = String(count);
    if (count) {
      const latest = new Date(state.sessions[0].updatedAt || Date.now());
      els.archiveMeta.textContent = `${count} 个会话 · ${latest.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;
    } else {
      els.archiveMeta.textContent = "保存会话与学习小结";
    }
    if (els.archiveSummary) {
      els.archiveSummary.textContent = count
        ? `${count} 个已保存会话 · 当前会话会自动保存`
        : "还没有保存的学习会话";
    }
  }

  function openArchive() {
    state.sessions = loadSessions();
    renderArchive();
    updateArchiveMeta();
    els.archiveModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeArchive() {
    els.archiveModal.hidden = true;
    if (els.libraryModal.hidden) document.body.classList.remove("modal-open");
  }

  function renderArchive() {
    els.archiveList.innerHTML = "";
    if (!state.sessions.length) {
      els.archiveList.innerHTML = `<div class="archive-empty"><strong>还没有学习记录</strong>完成一次提问后，会话会自动保存在这个浏览器里。</div>`;
      updateArchiveMeta();
      return;
    }
    state.sessions.forEach((session) => {
      const isCurrent = state.currentSession?.id === session.id;
      const card = document.createElement("article");
      card.className = `archive-item${isCurrent ? " is-current" : ""}`;
      const main = document.createElement("div");
      main.className = "archive-item-main";
      const titleRow = document.createElement("div");
      titleRow.className = "archive-item-title";
      const title = document.createElement("strong");
      title.textContent = session.title || "未命名学习会话";
      titleRow.appendChild(title);
      if (isCurrent) {
        const tag = document.createElement("span");
        tag.className = "archive-current-tag";
        tag.textContent = "当前";
        titleRow.appendChild(tag);
      }
      const meta = document.createElement("div");
      meta.className = "archive-item-meta";
      const stageLabel = state.curriculum?.stages.find((item) => item.id === session.stage)?.name || session.stage || "未标学段";
      const updated = new Date(session.updatedAt || session.createdAt || Date.now());
      meta.textContent = `${stageLabel} · ${session.messages.length} 条记录 · ${updated.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
      const snippet = document.createElement("p");
      snippet.className = "archive-item-snippet";
      const lastContent = [...session.messages].reverse().find((item) => item.content)?.content || "暂无内容";
      snippet.textContent = stripMarkdown(lastContent).replace(/\s+/g, " ").slice(0, 90);
      main.append(titleRow, meta, snippet);

      const actions = document.createElement("div");
      actions.className = "archive-item-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "archive-open";
      open.dataset.restoreSession = session.id;
      open.textContent = "继续";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "archive-delete";
      remove.dataset.deleteSession = session.id;
      remove.title = "删除此会话";
      remove.innerHTML = `<svg><use href="#i-trash"/></svg>`;
      actions.append(open, remove);
      card.append(main, actions);
      els.archiveList.appendChild(card);
    });
    updateArchiveMeta();
  }

  function deleteSession(id) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    if (!window.confirm(`删除“${session.title || "未命名学习会话"}”？此操作不可撤销。`)) return;
    state.sessions = state.sessions.filter((item) => item.id !== id);
    saveSessions(state.sessions);
    if (state.currentSession?.id === id) {
      state.currentSession = null;
      state.history = [];
      state.sessionActive = false;
      els.conversation.innerHTML = "";
      els.welcome.style.display = "";
      state.concept = null;
      state.conceptId = null;
      updateConceptUI();
      setMode("graph", { silent: true });
      setGraph(buildOverviewGraph(), { badge: "课程总览 · 点击节点探索" });
      renderSources([]);
    }
    renderArchive();
    updateArchiveMeta();
    showToast("会话已删除");
  }

  function restoreSession(id) {
    const session = loadSessions().find((item) => item.id === id);
    if (!session) {
      showToast("找不到这个学习会话。", "warn");
      return;
    }
    interruptActiveResponse();
    persistCurrentSession();
    const restored = JSON.parse(JSON.stringify(session));
    state.currentSession = restored;
    state.stage = ["1-2", "3-4", "5-6", "7-9"].includes(restored.stage) ? restored.stage : "3-4";
    state.concept = restored.concept || null;
    const concept = state.curriculum.concepts.find((item) => item.name === state.concept);
    state.conceptId = concept?.id || null;
    state.mode = MODE_META[restored.mode] ? restored.mode : "graph";
    setStage(state.stage, { silent: true });
    setMode(state.mode, { silent: true });
    updateConceptUI();
    $$(".concept-item", els.conceptList).forEach((item) => {
      item.classList.toggle("is-active", Number(item.dataset.conceptId) === state.conceptId);
    });

    els.conversation.innerHTML = "";
    els.welcome.style.display = "none";
    state.sessionActive = true;
    state.history = [];
    state.sources = [];
    let lastGraph = null;
    let lastSources = [];
    restored.messages.forEach((message) => {
      if (message.role === "user") {
        appendUserMessage(message.content, {
          stage: message.stage || restored.stage,
          mode: message.mode || restored.mode,
          scroll: false
        });
        state.history.push({ role: "user", content: message.content });
      } else if (message.role === "assistant") {
        appendStoredAssistantMessage(message, restored);
        state.history.push({ role: "assistant", content: message.content });
        if (message.sources?.length) lastSources = message.sources;
        if (message.graph) lastGraph = message.graph;
      }
    });
    if (lastGraph) {
      const graph = normalizeGraph(lastGraph);
      if (graph) setGraph(graph, { fromModel: true, badge: "已恢复的学习图谱" });
    } else {
      setGraph(buildOverviewGraph(), { badge: "课程总览 · 点击节点探索" });
    }
    renderSources(lastSources);
    closeArchive();
    updateArchiveMeta();
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    showToast("已恢复学习会话");
  }

  function appendStoredAssistantMessage(message, session) {
    const article = document.createElement("article");
    article.className = "message assistant";
    const avatar = document.createElement("span");
    avatar.className = "assistant-avatar";
    avatar.innerHTML = `<svg><use href="#i-orbit"/></svg>`;
    const body = document.createElement("div");
    body.className = "assistant-body";
    const meta = document.createElement("div");
    meta.className = "assistant-meta";
    const stageId = message.stage || session.stage;
    const stage = state.curriculum?.stages.find((item) => item.id === stageId);
    const mode = message.mode || session.mode;
    meta.innerHTML = `
      <strong>格物 · 科学导师</strong>
      <span class="meta-divider"></span>
      <span class="meta-stage">${escapeHtml(stage?.name || stageId || "")} · ${escapeHtml(MODE_META[mode]?.hint || "")}</span>
    `;
    const sources = document.createElement("div");
    sources.className = "message-sources is-hidden";
    const md = document.createElement("div");
    md.className = "md";
    md.innerHTML = renderMarkdown(message.content || "");
    const tools = document.createElement("div");
    tools.className = "message-tools is-hidden";
    const followups = document.createElement("div");
    followups.className = "followups is-hidden";
    body.append(meta, sources, md, followups, tools);
    article.append(avatar, body);
    els.conversation.appendChild(article);

    const assistant = {
      root: article,
      body,
      meta,
      sources,
      md,
      tools,
      followups,
      content: message.content || "",
      sourceData: message.sources || [],
      sessionRecord: message,
      mode,
      stage: message.stage || session.stage,
      concept: message.concept || session.concept
    };
    if (message.sources?.length) renderMessageSources(assistant, message.sources);
    buildMessageTools(assistant);
    buildFollowups(assistant);
    if (message.assessment) buildAssessmentCard(assistant, message.assessment, message.answer || "");
    return assistant;
  }

  function buildStudySummary(session) {
    const stageName = state.curriculum?.stages.find((item) => item.id === session.stage)?.name || session.stage || "未标学段";
    const date = new Date(session.updatedAt || Date.now());
    const lines = [
      "# 格物 · 科学学习小结",
      "",
      `- 学习时间：${date.toLocaleString("zh-CN")}`,
      `- 学段：${stageName}`,
      `- 当前主题：${session.concept || "未指定"}`,
      `- 对话轮数：${session.messages.filter((item) => item.role === "user").length}`,
      `- 资料来源：《义务教育科学课程标准（2022年版）》`,
      "",
      "## 学习问答",
      ""
    ];
    session.messages.forEach((message) => {
      if (message.role === "user") {
        lines.push("### 学生", "", message.content, "");
      } else if (message.role === "assistant") {
        lines.push("### 格物", "", message.content, "");
        if (message.sources?.length) {
          lines.push("> 本轮资料：" + message.sources.map((source, index) => `资料${index + 1}《${source.title}》${source.pages || ""}`).join("；"), "");
        }
        if (message.assessment) {
          const result = message.assessment;
          lines.push(
            "#### 素养测评反馈",
            "",
            `- 判定：${result.verdict}`,
            `- 综合得分：${result.score}`,
            `- 科学观念：${result.literacy?.科学观念 ?? "-"}`,
            `- 科学思维：${result.literacy?.科学思维 ?? "-"}`,
            `- 探究实践：${result.literacy?.探究实践 ?? "-"}`,
            `- 态度责任：${result.literacy?.态度责任 ?? "-"}`,
            ...(result.strengths?.length ? [`- 优势：${result.strengths.join("；")}`] : []),
            ...(result.gaps?.length ? [`- 待改进：${result.gaps.join("；")}`] : []),
            `- 反馈：${result.feedback}`,
            `- 下一步：${result.next_step || "继续围绕图谱提问"}`,
            ""
          );
        }
      }
    });
    lines.push("---", "", "由「格物 · 科学图谱」生成。");
    return lines.join("\n");
  }

  function exportCurrentSession() {
    const session = state.currentSession;
    if (!session || !session.messages.length) {
      showToast("当前还没有可导出的学习记录。", "warn");
      return;
    }
    const markdown = buildStudySummary(session);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `格物学习小结-${stamp}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("学习小结已导出为 Markdown");
  }

  /* ========================================================
     Library
     ======================================================== */

  function showLibraryModal() {
    els.libraryModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  async function openLibrary(query = "") {
    showLibraryModal();
    state.libraryPinnedId = null;
    state.libraryFocusText = "";
    els.librarySearch.placeholder = "搜索概念、实验或课标要求，例如：溶解快慢";
    els.librarySearch.value = query;
    state.libraryTag = "";
    $$("button[data-lib-tag]", els.libraryTags).forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.libTag || "") === "");
    });
    await fetchLibrary(query);
    setTimeout(() => els.librarySearch.focus(), 80);
  }

  async function openLibraryById(id, fallbackTitle = "", focusText = "") {
    if (!id) {
      await openLibrary(fallbackTitle);
      return;
    }
    showLibraryModal();
    state.libraryPinnedId = id;
    state.libraryFocusText = focusText;
    state.libraryTag = "";
    state.libraryQuery = "";
    els.librarySearch.value = "";
    els.librarySearch.placeholder = "当前为单条资料，输入关键词可检索全部";
    $$("button[data-lib-tag]", els.libraryTags).forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.libTag || "") === "");
    });
    const requestId = ++state.libraryRequest;
    els.libraryResults.innerHTML = `<div class="library-loading">正在读取这条资料…</div>`;
    els.libraryResultMeta.textContent = "正在读取单条资料…";
    try {
      const response = await fetch(`/api/library/item/${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("未找到该条资料");
      const data = await response.json();
      if (requestId !== state.libraryRequest) return;
      state.libraryItems = data.result ? [data.result] : [];
      renderLibrary(state.libraryItems, { pinned: true, focusText });
    } catch (error) {
      if (requestId !== state.libraryRequest) return;
      console.error(error);
      els.libraryResults.innerHTML = `<div class="library-empty"><strong>这条资料暂时打不开</strong>请关闭窗口后重试。</div>`;
      els.libraryResultMeta.textContent = "读取失败";
    }
    setTimeout(() => els.librarySearch.focus(), 80);
  }

  function closeLibrary() {
    els.libraryModal.hidden = true;
    document.body.classList.remove("modal-open");
    state.libraryPinnedId = null;
    state.libraryFocusText = "";
  }

  async function fetchLibrary(query = "") {
    const requestId = ++state.libraryRequest;
    state.libraryFocusText = "";
    els.librarySearch.placeholder = "搜索概念、实验或课标要求，例如：溶解快慢";
    els.libraryResults.innerHTML = `<div class="library-loading">正在检索课标资料…</div>`;
    els.libraryResultMeta.textContent = "正在检索…";
    try {
      const params = new URLSearchParams({
        q: query,
        stage: state.stage,
        limit: "30"
      });
      const response = await fetch(`/api/library?${params.toString()}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("资料检索失败");
      const data = await response.json();
      if (requestId !== state.libraryRequest) return;
      state.libraryItems = data.results || [];
      state.libraryLoaded = true;
      state.libraryQuery = query;
      renderLibrary(state.libraryItems);
    } catch (error) {
      if (requestId !== state.libraryRequest) return;
      console.error(error);
      els.libraryResults.innerHTML = `<div class="library-empty"><strong>资料库暂时不可用</strong>请确认后端服务已启动后重试。</div>`;
      els.libraryResultMeta.textContent = "检索失败";
    }
  }

  function renderLibrary(items, options = {}) {
    const pinned = Boolean(options.pinned || state.libraryPinnedId);
    const focusText = options.focusText || state.libraryFocusText || "";
    const filtered = state.libraryTag
      ? items.filter((item) => (item.concept || "").includes(state.libraryTag) || (item.chapter || "").includes(state.libraryTag))
      : items;
    els.libraryResults.classList.toggle("is-pinned", pinned);
    els.libraryResults.innerHTML = "";
    if (!filtered.length) {
      els.libraryResults.innerHTML = `<div class="library-empty"><strong>没有找到相关条目</strong>换一个关键词试试，例如“溶解”“三态变化”“空气”。</div>`;
      els.libraryResultMeta.textContent = `0 个知识块 · ${state.curriculum.stages.find((s) => s.id === state.stage)?.name || state.stage}`;
      return;
    }
    filtered.forEach((item) => {
      const card = document.createElement("article");
      card.className = "library-result";
      card.dataset.libraryId = item.id || "";
      if (pinned) card.classList.add("is-expanded");
      const meta = document.createElement("div");
      meta.className = "library-result-meta";
      meta.innerHTML = `<span class="lib-chapter">${escapeHtml(item.chapter || "课标资料")}</span><span class="library-scope ${evidenceClass(item)}">${escapeHtml(evidenceLabel(item))}</span><span>${escapeHtml(item.pages || "")}</span>`;
      const title = document.createElement("h3");
      title.textContent = item.title || "课标资料";
      const paragraph = document.createElement("p");
      paragraph.innerHTML = pinned && focusText
        ? highlightSourceFocus(item.full_text || item.snippet || "", focusText)
        : highlightText(item.full_text || item.snippet || "", state.libraryQuery);
      const foot = document.createElement("div");
      foot.className = "library-result-foot";
      const tags = document.createElement("div");
      tags.className = "library-tags-inline";
      (item.stages || []).forEach((stage) => {
        const span = document.createElement("span");
        span.textContent = state.curriculum.stages.find((s) => s.id === stage)?.name || stage;
        tags.appendChild(span);
      });
      const evidence = document.createElement("span");
      evidence.className = "library-evidence-note";
      evidence.textContent = item.evidence_note || "";
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "lib-expand";
      expand.dataset.expandLib = "true";
      expand.textContent = pinned ? "收起" : "展开全文";
      foot.append(tags, evidence, expand);
      card.append(meta, title, paragraph, foot);
      els.libraryResults.appendChild(card);
      if (!pinned) {
        requestAnimationFrame(() => {
          if (paragraph.scrollHeight <= paragraph.clientHeight + 2) {
            expand.style.display = "none";
          }
        });
      }
    });
    els.libraryResultMeta.textContent = pinned
      ? `单条资料 · ${filtered[0].chapter || "课标资料"} ${filtered[0].pages || ""}${els.libraryResults.querySelector(".source-focus") ? " · 已定位引用片段" : ""}`
      : `${filtered.length} 个知识块 · ${state.curriculum.stages.find((s) => s.id === state.stage)?.name || state.stage}`;
    if (pinned && focusText) {
      requestAnimationFrame(() => {
        const mark = els.libraryResults.querySelector(".source-focus");
        if (mark) mark.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }

  function highlightSourceFocus(fullText, focusText) {
    const best = bestMatchingSentence(fullText, focusText);
    if (!best) return escapeHtml(fullText);
    const index = fullText.indexOf(best);
    if (index < 0) return escapeHtml(fullText);
    return `${escapeHtml(fullText.slice(0, index))}<mark class="source-focus">${escapeHtml(best)}</mark>${escapeHtml(fullText.slice(index + best.length))}`;
  }

  function bestMatchingSentence(text, query) {
    if (!text || !query) return "";
    const cleanQuery = String(query).replace(/（资料[^）]*）/g, "").replace(/[【】*#>`]/g, "").trim();
    if (cleanQuery.length < 4) return "";
    const queryBigrams = bigramSet(cleanQuery);
    if (!queryBigrams.size) return "";
    const sentences = String(text).split(/(?<=[。；！？])/u).map((s) => s.trim()).filter((s) => s.length >= 6);
    let best = "";
    let bestScore = 0;
    sentences.forEach((sentence) => {
      const grams = bigramSet(sentence);
      if (!grams.size) return;
      let overlap = 0;
      grams.forEach((gram) => { if (queryBigrams.has(gram)) overlap += 1; });
      const score = overlap / Math.sqrt(grams.size * queryBigrams.size);
      if (score > bestScore) {
        bestScore = score;
        best = sentence;
      }
    });
    return bestScore >= 0.035 ? best : "";
  }

  function bigramSet(text) {
    const clean = String(text).toLowerCase().replace(/[^一-鿿A-Za-z0-9]+/g, "");
    const set = new Set();
    for (let index = 0; index < clean.length - 1; index += 1) {
      set.add(clean.slice(index, index + 2));
    }
    return set;
  }

  function highlightText(text, query) {
    let safe = escapeHtml(text || "");
    const tokens = String(query || "").trim().split(/\s+/).filter((token) => token.length >= 2).slice(0, 4);
    tokens.forEach((token) => {
      const escaped = escapeHtml(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safe = safe.replace(new RegExp(escaped, "gi"), (match) => `<mark>${match}</mark>`);
    });
    return safe;
  }

  /* ========================================================
     Drawers, toast, helpers
     ======================================================== */

  function openDrawer(side) {
    if (side === "left") {
      els.leftRail.classList.add("is-open");
      els.rightRail.classList.remove("is-open");
    } else {
      els.rightRail.classList.add("is-open");
      els.leftRail.classList.remove("is-open");
    }
    els.scrim.classList.add("is-visible");
  }

  function closeDrawers() {
    els.leftRail.classList.remove("is-open");
    els.rightRail.classList.remove("is-open");
    els.scrim.classList.remove("is-visible");
  }

  function showToast(message, type = "info") {
    if (!els.toastWrap) return;
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : type === "warn" ? " is-warn" : ""}`;
    toast.textContent = message;
    els.toastWrap.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* no-op */ }
  }
})();

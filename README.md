# 格物 · 科学图谱

基于《义务教育科学课程标准（2022年版）》的交互式科学知识图谱学习助手 Demo。

前端是一个「课标资料库 + 学习教练 + 可交互图谱」三栏式学习工作台；后端使用 **FastAPI + LangChain**，通过 `langchain-openai` 的 `ChatOpenAI` 接入阿里云百炼 OpenAI 兼容接口的 `qwen3.8-27b`，以流式方式返回回答和机器可读的图谱数据。

## 已实现

- **学段切换**：1–2 / 3–4 / 5–6 / 7–9 年级，切换时保存旧会话并打开新学段的空白对话；生成中的已有内容会保留到旧会话，迟到的回答不会进入新会话。回答与资料检索按学段加权。
- **课标资料库**：原始资料整理为 87 个可检索知识块：27 个条文整理、16 个框架摘要、44 个按学段展开的框架整理；每条资料都带有证据层级、印刷页码、来源文件和证据说明，支持关键词检索、章节筛选、展开/收起和页码出处。
- **课标约束 RAG**：LangChain 自定义 `CurriculumRetriever` + 轻量中文 BM25 检索，资料不足时提示“资料库暂未收录详细条文”，避免伪造课标原文。
- **LangChain 编排**：`ChatPromptTemplate | ChatOpenAI` 组成可流式运行的 LCEL 链；课标资料以 `Document` 进入检索器，系统提示、历史对话和本轮资料通过链输入组装。
- **流式对话**：Qwen3.8-27B 流式输出，支持停止生成、失败提示、复制回答。
- **智能接着追问**：追问按钮会根据问题意图自动识别为探究实践、因果链、对比学习、项目、测评或图谱模式，并在发送前显示预测模式；用户仍可手动覆盖。
- **可视化实验模拟**：首页第四个入口直接打开“溶解快慢”模拟实验，调整水温、颗粒大小和玻璃棒搅拌；糖块随观察进度逐渐缩小，完全溶解后不再显示固体，并可记录结果、带回追问区。模拟结果由固定规则生成并明确标注，不代替真实实验。
- **文本 + 可视化双图谱**：回答中保留课标要求的文本知识图谱；模型额外返回 `<graph>` JSON，右侧渲染可缩放、可点选、可高亮的 SVG 图谱。
- **引用定位**：回答中的“资料 2，p.29”可点击，打开对应知识块并自动高亮匹配的原文句子；界面明确区分“条文整理”“框架学段整理”和“框架摘要”。
- **素养测评闭环**：测评模式回答后可直接作答，LangChain 评估链输出判定、总分、四项核心素养分项、优势、待改进与下一步建议。
- **学习档案**：会话自动保存到浏览器 localStorage，可继续上次学习、删除记录、导出 Markdown 学习小结。
- **课程导航**：四个领域以可展开、收起的目录行呈现，下属 13 个核心概念缩进为单行子目录；保留资料证据标记，悬停可查看当前学段的侧重和建议任务。选择或恢复概念时会自动展开对应领域。
- **响应式界面**：桌面三栏、平板/手机抽屉式导航，支持移动端对话。
- **安全边界**：API Key 只存在服务端 `.env`，不会下发到浏览器。

## 快速启动

```bash
cd C:\other\新建文件夹\sincetic
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

浏览器打开 <http://127.0.0.1:8000>。

Windows 也可以直接双击 `start.bat`。

`.env` 已配置为：

```env
DASHSCOPE_API_KEY=...
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.8-27b
```

如更换密钥，修改 `.env` 后重启服务。不要把真实密钥提交到版本库。

## 知识库范围

`data/knowledge_base.json` 与 `data/knowledge_extension.json` 原始收录 43 个知识块，运行时会根据 `data/curriculum.json` 额外生成 44 个按学段展开的框架整理，共 87 个可检索知识块。来源为：

- 第一章 课程性质（p.1）
- 第二章 课程理念（p.2–3）
- 第四章 课程内容 · 核心概念（一）物质的结构与性质（p.19–28）
- 第四章 课程内容 · 核心概念（二）物质的变化与化学反应（p.28–34）
- 第四章 课程内容 · 核心概念（三）至（十三）（p.35–117，框架摘要）
- 附录4 学生必做探究实践活动（p.182–186，按学段索引）

其中核心概念（一）（二）保留较细的条文整理；核心概念（三）至（十三）以课标框架摘要和学段重点进入检索，页面会明确提示摘要/学段整理与逐条原文的边界。`data/source_manifest.json` 记录了原 PDF 的版本、页数、提取状态和证据使用规则。

## 目录

```text
app.py                     FastAPI、LangChain 链、RAG、流式接口、图谱解析
prompt.txt                 原始角色与课标约束提示词
data/curriculum.json       13 个核心概念 × 4 学段侧重、4 个跨学科概念、核心素养
data/knowledge_base.json   27 个较细的课标知识块
data/knowledge_extension.json 16 个核心概念框架与附录活动知识块
data/source_manifest.json  原 PDF 版本与证据分层规则
tests/test_knowledge_integrity.py  知识覆盖、证据元数据和检索校验
static/index.html          页面结构
static/styles.css          视觉系统与响应式布局
static/app.js              流式对话、Markdown、SVG 图谱、引用定位、测评、学习档案
.env                       本地模型密钥（不提交）
requirements.txt
start.bat
```

## LangChain 结构

```python
# 1. 课标检索器：继承 LangChain BaseRetriever，返回 Document
retriever = CurriculumRetriever(
    stage="5-6",
    concept="物质的变化与化学反应",
    mode="compare",
    k=5,
    strict_stage=True,
)
documents = retriever.invoke("对比物理变化与化学变化")

# 2. 提示词模板：系统角色 + 课标运行约束 + 本轮资料 + 历史 + 问题
CHAT_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "{base_system_prompt}"),
    ("system", "{runtime_protocol}"),
    ("system", "{runtime}"),
    MessagesPlaceholder("history"),
    ("human", "{question}"),
])

# 3. LCEL 链：提示词 → Qwen3.8-27B
CHAT_CHAIN = CHAT_PROMPT | ChatOpenAI(
    model="qwen3.8-27b",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    streaming=True,
    extra_body={"enable_thinking": False},
)

# 4. FastAPI 将链输出转成 SSE，并解析末尾的 <graph> JSON
for chunk in CHAT_CHAIN.stream(chain_input):
    ...

# 5. 测评链：同一模型、低温度、结构化 JSON 评估
ASSESS_CHAIN = ASSESS_PROMPT | LLM.bind(temperature=0.2) | StrOutputParser()
```

检索结果以 `Document` 传递，`page_content` 是知识块正文，`metadata` 保留资料 id、章节、页码、学段、关键词和检索分数，因此回答里的“资料1、p.19”与右侧资料出处可以一一对应。

## API

- `GET /api/config`：前端初始化配置、课程框架、模型状态。
- `GET /api/health`：服务健康检查。
- `GET /api/knowledge`：课程框架、证据分层与资料库统计。
- `GET /api/knowledge/coverage`：13 个核心概念的覆盖矩阵与原 PDF 来源信息。
- `GET /api/library?q=溶解快慢&stage=3-4`：资料库检索。
- `GET /api/library/item/{doc_id}`：精确读取单条知识块，供资料出处和引用定位使用。
- `POST /api/chat`：SSE 流式对话，返回 `meta`、`delta`、`graph`、`done`、`error` 事件。
- `POST /api/assess`：提交学生作答，返回素养测评 JSON 与依据资料。

请求示例：

```json
{
  "message": "对比物理变化与化学变化",
  "stage": "5-6",
  "concept": "物质的变化与化学反应",
  "mode": "compare",
  "history": []
}
```

## 基础校验

```bash
python -m unittest discover -s tests -v
```

校验会检查 13 个核心概念是否都有明确覆盖级别、所有资料是否有页码与证据说明、学段整理是否能追溯到对应框架摘要，以及检索是否优先返回当前学段资料。

本地服务运行时，已安装 Playwright 和 Chromium 的开发环境还可运行 `python tests/check_experiment_visual.py --all`，在真实浏览器中校验糖块逐渐缩小、完成无残留、搅拌/静置、重新加入、重置和手机布局，并将过程截图保存到 `work/experiment-visual-check/`。

`python tests/check_navigation_sessions.py` 检查目录的鼠标/键盘折叠、学段切换时的新旧会话隔离、生成中切换、档案恢复和手机导航。对话回答在测试内模拟，不调用模型；截图保存到 `work/navigation-session-check/`。

## Demo 边界

- 无数据库、无账号体系；学习档案保存在当前浏览器的 localStorage 中，换浏览器或清除站点数据后会丢失。
- RAG 使用 BM25 风格字词检索，不是向量检索；适合演示，不追求大规模语料性能。
- 13 个核心概念均有课标框架摘要；核心概念（三）至（十三）已经补充按学段的可检索整理，但仍未逐页拆分全部内容要求、学业要求和教学提示。框架摘要/学段整理不能替代逐条原文，在资料范围之外的问题，助手会明确降级为“框架性说明”。
- 模型回答仍可能不完美，页面中的资料出处和文本图谱就是给学生核对证据用的，不宜直接当作权威答案。

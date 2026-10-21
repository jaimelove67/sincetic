from __future__ import annotations

import json
import logging
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Iterable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.retrievers import BaseRetriever
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, SecretStr

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
PROMPT_PATH = BASE_DIR / "prompt.txt"
ENV_PATH = BASE_DIR / ".env"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("science-atlas")


def load_env(path: Path) -> None:
    """Small .env loader so the app has no extra runtime dependency."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


load_env(ENV_PATH)

API_KEY = os.getenv("DASHSCOPE_API_KEY", "").strip()
BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
).strip()
MODEL = os.getenv("QWEN_MODEL", "qwen3.8-27b").strip()
APP_NAME = "格物 · 科学图谱"

CURRICULUM: dict[str, Any] = json.loads(
    (DATA_DIR / "curriculum.json").read_text(encoding="utf-8")
)
SOURCE_MANIFEST_PATH = DATA_DIR / "source_manifest.json"
if SOURCE_MANIFEST_PATH.exists():
    SOURCE_MANIFEST: dict[str, Any] = json.loads(
        SOURCE_MANIFEST_PATH.read_text(encoding="utf-8")
    )
else:
    SOURCE_MANIFEST = {
        "document_title": "义务教育科学课程标准（2022年版）",
        "edition": "2022年版",
        "source_file": "科学(1).pdf",
        "pdf_pages": 193,
        "printed_pages": "1–186",
        "extraction_status": "image_pdf",
    }
KB: list[dict[str, Any]] = json.loads(
    (DATA_DIR / "knowledge_base.json").read_text(encoding="utf-8")
)
KB_EXTENSION_PATH = DATA_DIR / "knowledge_extension.json"
if KB_EXTENSION_PATH.exists():
    KB.extend(json.loads(KB_EXTENSION_PATH.read_text(encoding="utf-8")))

VALID_STAGES = {"1-2", "3-4", "5-6", "7-9"}
STAGE_LABEL = {
    "1-2": "1–2年级",
    "3-4": "3–4年级",
    "5-6": "5–6年级",
    "7-9": "7–9年级",
}


def _build_stage_framework_notes() -> list[dict[str, Any]]:
    """Expand framework summaries into stage-focused, clearly labelled notes.

    These notes are intentionally not called detailed clauses. They reuse the
    curriculum's existing stage focus/task fields to make concepts 3–13
    searchable at the selected grade band without pretending that the image
    PDF has already been transcribed clause by clause.
    """
    framework_by_concept = {
        item.get("concept"): item
        for item in KB
        if item.get("scope") == "framework" and item.get("id", "").startswith("kb-c")
    }
    notes: list[dict[str, Any]] = []
    for concept in CURRICULUM.get("concepts", []):
        concept_id = concept.get("id")
        if not isinstance(concept_id, int) or concept_id < 3 or concept.get("indexed"):
            continue
        framework = framework_by_concept.get(concept.get("name"))
        if not framework:
            continue
        for stage_id, focus in (concept.get("stage_focus") or {}).items():
            if stage_id not in STAGE_LABEL or not isinstance(focus, dict):
                continue
            note_id = f"kb-c{concept_id}-stage-{stage_id}"
            notes.append(
                {
                    "id": note_id,
                    "title": f"{concept.get('name')}：{STAGE_LABEL[stage_id]}学习重点",
                    "chapter": framework.get("chapter"),
                    "concept": concept.get("name"),
                    "stages": [stage_id],
                    "pages": framework.get("pages") or concept.get("pages") or "",
                    "source": framework.get("source")
                    or SOURCE_MANIFEST.get("document_title", "义务教育科学课程标准（2022年版）"),
                    "scope": "framework_stage",
                    "evidence_parent_id": framework.get("id"),
                    "keywords": list(
                        dict.fromkeys(
                            (concept.get("tags") or [])
                            + (framework.get("keywords") or [])
                            + [concept.get("name", ""), STAGE_LABEL[stage_id]]
                        )
                    )[:28],
                    "text": (
                        f"课标框架学段整理（非逐条原文）：{STAGE_LABEL[stage_id]}侧重"
                        f"{focus.get('focus', '').strip()}"
                        f"建议学习任务：{focus.get('task', '').strip()}"
                    ),
                }
            )
    return notes


def _annotate_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    """Attach stable evidence labels to every indexed knowledge block."""
    item = dict(chunk)
    scope = item.get("scope") or "detail"
    if scope == "detail":
        evidence_level = "detail"
        evidence_label = "课标条文整理"
        evidence_note = "按印刷页码整理，可作为本轮课标事实依据。"
    elif scope == "framework_stage":
        evidence_level = "framework_stage"
        evidence_label = "框架学段整理"
        evidence_note = "由课标框架摘要和学段重点整理，不等同于逐条课标原文。"
    else:
        evidence_level = "framework"
        evidence_label = "课标框架摘要"
        evidence_note = "仅用于概念范围、学段重点和活动方向，不等同于逐条课标原文。"
    item["scope"] = scope
    item["evidence_level"] = evidence_level
    item["evidence_label"] = evidence_label
    item["evidence_note"] = evidence_note
    item["source_document"] = SOURCE_MANIFEST.get(
        "document_title", "义务教育科学课程标准（2022年版）"
    )
    item["source_file"] = SOURCE_MANIFEST.get("source_file", "科学(1).pdf")
    item["source_pages"] = item.get("pages") or ""
    return item


KB.extend(_build_stage_framework_notes())
KB = [_annotate_chunk(chunk) for chunk in KB]


def _coverage_summary() -> dict[str, Any]:
    """Return an honest coverage matrix for the 13 core concepts."""
    concept_chunks: dict[str, list[dict[str, Any]]] = {}
    for chunk in KB:
        concept = chunk.get("concept")
        if concept:
            concept_chunks.setdefault(str(concept), []).append(chunk)

    concepts: list[dict[str, Any]] = []
    for concept in CURRICULUM.get("concepts", []):
        name = concept.get("name")
        chunks = concept_chunks.get(str(name), [])
        detail_count = sum(item.get("evidence_level") == "detail" for item in chunks)
        framework_count = sum(item.get("evidence_level") == "framework" for item in chunks)
        stage_count = sum(item.get("evidence_level") == "framework_stage" for item in chunks)
        if detail_count:
            level = "detail"
            label = "条文整理"
        elif stage_count:
            level = "framework_stage"
            label = "框架 + 学段整理"
        elif framework_count:
            level = "framework"
            label = "框架摘要"
        else:
            level = "missing"
            label = "待补充"
        concepts.append(
            {
                "id": concept.get("id"),
                "name": name,
                "pages": concept.get("pages")
                or next((item.get("pages") for item in chunks if item.get("pages")), ""),
                "level": level,
                "label": label,
                "detail_blocks": detail_count,
                "framework_blocks": framework_count,
                "stage_blocks": stage_count,
                "total_blocks": len(chunks),
                "is_detailed": bool(detail_count),
            }
        )

    return {
        "concepts": concepts,
        "totals": {
            "knowledge_blocks": len(KB),
            "detail_blocks": sum(item.get("evidence_level") == "detail" for item in KB),
            "framework_blocks": sum(item.get("evidence_level") == "framework" for item in KB),
            "stage_blocks": sum(item.get("evidence_level") == "framework_stage" for item in KB),
            "detailed_concepts": sum(item["is_detailed"] for item in concepts),
            "framework_concepts": sum(item["level"] != "detail" for item in concepts),
        },
    }


KNOWLEDGE_COVERAGE = _coverage_summary()


def _coverage_prompt() -> str:
    totals = KNOWLEDGE_COVERAGE["totals"]
    detailed = [
        item["name"]
        for item in KNOWLEDGE_COVERAGE["concepts"]
        if item["level"] == "detail"
    ]
    framework = [
        item["name"]
        for item in KNOWLEDGE_COVERAGE["concepts"]
        if item["level"] != "detail"
    ]
    return (
        f"共索引{totals['knowledge_blocks']}个知识块；{totals['detail_blocks']}个为条文整理，"
        f"{totals['stage_blocks']}个为框架学段整理，{totals['framework_blocks']}个为框架摘要。"
        f"条文整理概念：{'、'.join(detailed) or '暂无'}；"
        f"其余概念：{'、'.join(framework) or '暂无'}。"
        "框架摘要和框架学段整理不是逐条课标原文，回答时必须保留这一证据边界。"
    )


STAGE_GUIDE = {item["id"]: item for item in CURRICULUM["stages"]}
MODE_GUIDE = {
    "graph": {
        "name": "知识图谱",
        "instruction": "围绕当前主题展开局部知识图谱。先给图谱节点和关系，再解释结构，最后用问题链引导学生沿图谱继续探索。",
    },
    "causal": {
        "name": "因果链",
        "instruction": "生成条件→过程→现象→结果→影响的完整因果链条。明确区分相关与因果，标出可观察证据和可控制变量。",
    },
    "compare": {
        "name": "对比学习",
        "instruction": "建立两个科学实体的对比图谱，对比结构、性质、条件、现象、证据与易混点。对比表应精炼，不能只罗列结论。",
    },
    "inquiry": {
        "name": "探究实践",
        "instruction": "从课标必做探究实践活动中提取对应任务，输出问题、假设、材料、变量、步骤、证据记录方式、检验标准、安全事项和改进方向。不要直接给出预知结论。",
    },
    "project": {
        "name": "跨学科项目",
        "instruction": "生成一个贴合当前主题的跨学科项目。按明确问题→约束条件→设计方案→实施计划→检验作品→改进完善→发布成果组织，并关联至少一个其他学科。",
    },
    "assessment": {
        "name": "素养测评",
        "instruction": "设计情境化、素养导向的测评。覆盖低、中、高认知水平，标注对应核心素养，但不要直接给出答案；邀请学生先作答，再根据证据反馈。",
    },
    "explain": {
        "name": "概念讲解",
        "instruction": "用问题链引导理解概念，先激活前概念，再借助观察、类比或模型建立解释，最后让学生用证据表达自己的理解。",
    },
}

DEFAULT_MODE = "explain"
GRAPH_OPEN = "<graph>"
GRAPH_CLOSE = "</graph>"
MAX_HISTORY_MESSAGES = 12
MAX_MESSAGE_CHARS = 4000
MAX_SOURCE_COUNT = 5

if PROMPT_PATH.exists():
    BASE_SYSTEM_PROMPT = PROMPT_PATH.read_text(encoding="utf-8").strip()
else:
    BASE_SYSTEM_PROMPT = "你是义务教育科学知识图谱学习助手，严格依据《义务教育科学课程标准（2022年版）》回答问题。"

RUNTIME_PROTOCOL = """
# 本次运行的附加约束（优先遵守）
1. 你是可交互的科学学习智能体。学生使用中文交流，你也始终使用简体中文。
2. 你的课标事实性依据只能来自本轮【检索资料】。可基于检索资料做拆分、归纳、类比和提问，但不得编造课标条目、页码、实验现象或数据。
3. 引用资料时使用“资料编号 + 页码”，例如“（资料2，p.3）”。每段最多引用两次，不要整段照抄资料原文。
4. 若问题超出【检索资料】覆盖范围，先给出简短的“课程框架性说明”，并明确说明“资料库暂未收录该部分的详细条文”，再提供安全的引导问题；绝不可伪造课标原文。资料标记为“课标框架摘要”时，只能把它作为概念、学段重点和活动方向的依据，不得假装它是逐条条文。
5. 前一轮对话中学生的回答若出现错误概念，要用问题、证据或反例引导其自行修正；不要直接甩出标准答案。
6. 图谱必须和当前学段匹配。超出学段的内容要提示：“该知识点是X–X年级学习内容，是否切换学段继续？”
7. 不要输出图片，不要使用外部链接。所有学习结论都围绕图谱节点展开。
8. 你是学习教练而非答案机器：讲解后必须留下2–3个递进探究问题，等待学生作答。

# 回答结构（除非学生只做寒暄或提出非常小的澄清）
先写一个不超过45字的“定位句”，说明本问题落在哪个核心概念、当前学段及学习重点。
接着输出固定格式的文本知识图谱：

## 🧪科学知识图谱
【适用学段】：...
【顶层模块】：...
**节点列表：**
- 节点名称｜节点类型｜学段标签｜素养标签
    ↳【关系：关系名称】→子节点｜节点类型｜学段标签｜素养标签
- ...

然后写“学习引导”：用2–4个短段落或小标题解释图谱中的关键关系，优先用问题链、证据和模型，而不是长篇讲义。
最后输出：

## 📝递进探究问题
① ...
② ...
③ ...

结尾用一行注明资料范围，例如：“本轮依据：资料1、资料3；课标第一章、第二章。”

# 可视化图谱数据（必须在回答最末尾、仅输出一次）
在完成全部可见回答后，输出一个机器可读块：
<graph>
{"title":"...","stage":"3–4年级","concept":"...","nodes":[{"id":"n1","label":"...","type":"科学概念","stage":"3–4年级","literacy":"科学观念","note":"一句话"}],"edges":[{"from":"n1","to":"n2","relation":"包含","label":"包含"}]}
</graph>
要求：
- 6–12个节点、6–14条关系；必须有一个根节点，所有节点可从根节点到达；id 使用 n1、n2……，edges 的 from/to 必须存在。
- node.type 只能取：学科核心概念、子概念、自然现象、物质/材料、生物、天体、仪器工具、科学实验、工程任务、模型、科学史实、变量、条件、产物、探究实践活动、跨学科项目。
- node.literacy 只能取：科学观念、科学思维、探究实践、态度责任。
- relation 只能取：包含、因果、条件、结构—功能、原理—现象、影响因素、变化演化、对比异同、输入—输出、模型—原型、能量转化、物质转化、实验—证据。
- label 尽量不超过16个字，note 不超过40个字。JSON 必须合法，不要使用 Markdown 代码围栏，不要在块后面再写任何文字。
""".strip()


# ---------------------------------------------------------------------------
# LangChain composition
# ---------------------------------------------------------------------------

CHAT_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "{base_system_prompt}"),
        ("system", "{runtime_protocol}"),
        ("system", "{runtime}"),
        MessagesPlaceholder("history"),
        ("human", "{question}"),
    ]
)

if API_KEY:
    LLM = ChatOpenAI(
        model=MODEL,
        api_key=SecretStr(API_KEY),
        base_url=BASE_URL,
        temperature=0.55,
        top_p=0.85,
        max_tokens=2800,
        streaming=True,
        timeout=150,
        max_retries=1,
        extra_body={"enable_thinking": False},
    )
    CHAT_CHAIN = CHAT_PROMPT | LLM
else:
    LLM = None
    CHAT_CHAIN = None


ASSESSMENT_SYSTEM = """
你是一位面向义务教育学生的科学素养测评教练。请根据当前学段、课标资料、测评任务和学生的真实作答，给出诊断性反馈。

评分原则：
1. 以当前学段的学业要求为尺度，不拔高、不降低标准。
2. 优先判断学生是否使用了证据、是否控制变量、是否能区分现象与本质，而不是只看术语是否漂亮。
3. 反馈要具体指向学生作答中的某句话或某个思路；先肯定有效证据，再指出一个最值得改进的地方。
4. 不直接替学生重写整份答案；如需示范，只给一句简短的改进示例。
5. 资料不足时明确说明“资料库暂未覆盖”，不要把超出资料的内容伪装成课标原文。
6. 只输出合法 JSON，不要输出 Markdown 代码围栏，不要输出 JSON 之外的文字。

JSON 结构：
{
  "verdict": "掌握 | 部分掌握 | 需要复习",
  "score": 0到100的整数,
  "literacy": {
    "科学观念": 0到100的整数,
    "科学思维": 0到100的整数,
    "探究实践": 0到100的整数,
    "态度责任": 0到100的整数
  },
  "strengths": ["具体优势，最多2条"],
  "gaps": ["具体待改进点，最多2条"],
  "feedback": "2到4句诊断性反馈",
  "next_step": "一个可立即执行的下一步学习建议"
}
""".strip()

ASSESS_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "{assessment_system}"),
        ("system", "【本轮课标资料】\n{context}"),
        (
            "human",
            "【学段】{stage}\n【主题】{concept}\n【测评任务】\n{question}\n\n【学生作答】\n{answer}\n\n请严格按 JSON 结构返回评估结果。",
        ),
    ]
)

if LLM is not None:
    ASSESS_CHAIN = ASSESS_PROMPT | LLM.bind(temperature=0.2) | StrOutputParser()
else:
    ASSESS_CHAIN = None



def _normalize(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", (text or "").lower(), flags=re.UNICODE)


def _tokens(text: str) -> list[str]:
    text = (text or "").lower()
    tokens: list[str] = []
    for seq in re.findall(r"[一-鿿]+", text):
        tokens.extend(seq)
        tokens.extend(seq[i : i + 2] for i in range(len(seq) - 1))
    tokens.extend(re.findall(r"[a-z0-9]+", text))
    return tokens


def _doc_tokens(chunk: dict[str, Any]) -> list[str]:
    parts = [
        chunk.get("title", ""),
        chunk.get("chapter", ""),
        chunk.get("concept", ""),
        chunk.get("text", ""),
        " ".join(chunk.get("keywords", [])),
    ]
    return _tokens(" ".join(parts))


DOC_TOKENS = [_doc_tokens(chunk) for chunk in KB]
DOC_LENGTHS = [max(1, len(tokens)) for tokens in DOC_TOKENS]
AVG_DOC_LENGTH = sum(DOC_LENGTHS) / max(1, len(DOC_LENGTHS))
DF: dict[str, int] = {}
for tokens in DOC_TOKENS:
    for token in set(tokens):
        DF[token] = DF.get(token, 0) + 1
TOTAL_DOCS = max(1, len(KB))


def _idf(token: str) -> float:
    return math.log(1 + (TOTAL_DOCS - DF.get(token, 0) + 0.5) / (DF.get(token, 0) + 0.5))


def retrieve(
    query: str,
    stage: str = "3-4",
    concept: str | None = None,
    mode: str = "explain",
    limit: int = MAX_SOURCE_COUNT,
    strict_stage: bool = True,
) -> list[dict[str, Any]]:
    """Compact Chinese BM25-style retrieval with curriculum-aware boosts."""
    query = (query or "").strip()
    if not query:
        return KB[:limit]

    normalized_query = _normalize(query)
    query_tokens = _tokens(query + " " + MODE_GUIDE.get(mode, {}).get("name", ""))
    query_token_set = set(query_tokens)
    scores: list[float] = []
    k1, b = 1.35, 0.72

    for index, chunk in enumerate(KB):
        tokens = DOC_TOKENS[index]
        tf: dict[str, int] = {}
        for token in tokens:
            tf[token] = tf.get(token, 0) + 1
        score = 0.0
        for token in query_token_set:
            freq = tf.get(token, 0)
            if not freq:
                continue
            denom = freq + k1 * (1 - b + b * DOC_LENGTHS[index] / AVG_DOC_LENGTH)
            score += _idf(token) * freq * (k1 + 1) / denom

        # Curriculum phrase matches carry more signal than noisy single characters.
        for keyword in chunk.get("keywords", []):
            keyword_norm = _normalize(keyword)
            if len(keyword_norm) >= 2 and keyword_norm in normalized_query:
                score += 2.0 + min(len(keyword_norm), 8) * 0.22

        title_norm = _normalize(chunk.get("title", ""))
        if any(len(token) >= 2 and token in title_norm for token in query_token_set):
            score += 0.6

        chunk_stages = set(chunk.get("stages", []))
        if chunk_stages == {stage}:
            score += 2.4
        elif stage in chunk_stages:
            score += 1.6
        elif len(chunk_stages) >= 4:
            score += 0.5
        else:
            # A 7–9-only chunk should not dominate a 3–4 question just because
            # it repeats the same keyword.
            score -= 1.8

        if concept and chunk.get("concept") == concept:
            score += 2.8
        elif concept and concept in chunk.get("text", ""):
            score += 0.9

        if mode in {"inquiry", "project"} and ("活动" in chunk.get("title", "") or "教学" in chunk.get("title", "")):
            score += 0.6
        if mode == "assessment" and "学业要求" in chunk.get("title", ""):
            score += 0.9
        if mode == "causal" and ("变化" in chunk.get("title", "") or "变化" in query):
            score += 0.25

        scores.append(score)

    ranked = sorted(range(len(KB)), key=lambda i: scores[i], reverse=True)
    compatible: list[dict[str, Any]] = []
    incompatible: list[dict[str, Any]] = []
    for i in ranked:
        if scores[i] <= 0 and (compatible or incompatible):
            break
        item = dict(KB[i])
        item["score"] = round(float(scores[i]), 3)
        chunk_stages = set(item.get("stages", []))
        is_compatible = stage in chunk_stages or len(chunk_stages) >= 4
        if not strict_stage or is_compatible:
            compatible.append(item)
        else:
            incompatible.append(item)
        if len(compatible) >= limit and (not strict_stage or len(compatible) >= limit):
            break

    if strict_stage:
        results = compatible[:limit]
        if len(results) < limit:
            results.extend(incompatible[: limit - len(results)])
    else:
        results = compatible[:limit]

    if not results:
        stage_chunks = [dict(c) for c in KB if stage in c.get("stages", [])]
        for item in stage_chunks[:limit]:
            item["score"] = 0.0
            results.append(item)
    return results


def _chunk_to_document(chunk: dict[str, Any]) -> Document:
    return Document(
        page_content=chunk.get("text", ""),
        metadata={
            "id": chunk.get("id"),
            "title": chunk.get("title"),
            "chapter": chunk.get("chapter"),
            "concept": chunk.get("concept"),
            "pages": chunk.get("pages"),
            "source": chunk.get("source") or "《义务教育科学课程标准（2022年版）》",
            "stages": chunk.get("stages", []),
            "keywords": chunk.get("keywords", []),
            "score": chunk.get("score", 0),
            "scope": chunk.get("scope", "detail"),
            "evidence_level": chunk.get("evidence_level", "detail"),
            "evidence_label": chunk.get("evidence_label", "课标条文整理"),
            "evidence_note": chunk.get("evidence_note", ""),
            "evidence_parent_id": chunk.get("evidence_parent_id"),
            "source_document": chunk.get("source_document"),
            "source_file": chunk.get("source_file"),
            "source_pages": chunk.get("source_pages") or chunk.get("pages"),
        },
    )


class CurriculumRetriever(BaseRetriever):
    """LangChain retriever backed by the curriculum-aware BM25 scorer.

    The knowledge corpus is deliberately small (a demo knowledge base), so a
    deterministic local scorer is more predictable than an embedding service
    and keeps every retrieved passage traceable to a printed page.
    """

    stage: str = "3-4"
    concept: str | None = None
    mode: str = "explain"
    k: int = MAX_SOURCE_COUNT
    strict_stage: bool = True

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun,
    ) -> list[Document]:
        chunks = retrieve(
            query,
            stage=self.stage,
            concept=self.concept,
            mode=self.mode,
            limit=self.k,
            strict_stage=self.strict_stage,
        )
        return [_chunk_to_document(chunk) for chunk in chunks]


def _public_source(document: Document) -> dict[str, Any]:
    metadata = document.metadata
    text = document.page_content
    snippet = text[:220].rstrip() + ("…" if len(text) > 220 else "")
    return {
        "id": metadata.get("id"),
        "title": metadata.get("title"),
        "chapter": metadata.get("chapter"),
        "concept": metadata.get("concept"),
        "pages": metadata.get("pages"),
        "source": metadata.get("source"),
        "snippet": snippet,
        "score": metadata.get("score", 0),
        "scope": metadata.get("scope", "detail"),
        "evidence_level": metadata.get("evidence_level", "detail"),
        "evidence_label": metadata.get("evidence_label", "课标条文整理"),
        "evidence_note": metadata.get("evidence_note", ""),
        "evidence_parent_id": metadata.get("evidence_parent_id"),
        "source_document": metadata.get("source_document"),
        "source_file": metadata.get("source_file"),
        "source_pages": metadata.get("source_pages") or metadata.get("pages"),
    }


def _build_context(sources: list[Document]) -> str:
    blocks = []
    for index, source in enumerate(sources, 1):
        metadata = source.metadata
        blocks.append(
            f"[资料{index}] {metadata.get('title')}"
            f"（{metadata.get('chapter')}，{metadata.get('pages')}，"
            f"{metadata.get('evidence_label', '课标条文整理')}）\n"
            f"证据说明：{metadata.get('evidence_note', '')}\n{source.page_content}"
        )
    return "\n\n".join(blocks) if blocks else "本轮没有检索到直接相关的课标资料。"


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    stage: str = "3-4"
    concept: str | None = None
    mode: str = DEFAULT_MODE
    history: list[ChatMessage] = Field(default_factory=list)


class AssessRequest(BaseModel):
    stage: str = "3-4"
    concept: str | None = None
    question: str = Field(min_length=1, max_length=8000)
    answer: str = Field(min_length=1, max_length=6000)
    context: str = Field(default="", max_length=12000)


def _parse_assessment(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    candidate = raw.strip()
    candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
    candidate = re.sub(r"\s*```$", "", candidate)
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end <= start:
        return None
    candidate = candidate[start : end + 1]
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        logger.warning("Assessment JSON could not be parsed: %s", candidate[:300])
        return None
    if not isinstance(data, dict):
        return None

    def score(value: Any, fallback: int = 0) -> int:
        try:
            return max(0, min(100, int(round(float(value)))))
        except (TypeError, ValueError):
            return fallback

    overall = score(data.get("score"), 60)
    verdict = str(data.get("verdict") or "").strip()
    if verdict not in {"掌握", "部分掌握", "需要复习"}:
        verdict = "部分掌握"
    raw_literacy = data.get("literacy") if isinstance(data.get("literacy"), dict) else {}
    literacy = {
        key: score(raw_literacy.get(key), overall)
        for key in ["科学观念", "科学思维", "探究实践", "态度责任"]
    }

    def string_list(value: Any, limit: int = 2) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip()[:260] for item in value if str(item).strip()][:limit]

    feedback = str(data.get("feedback") or "").strip()[:1200]
    next_step = str(data.get("next_step") or "").strip()[:300]
    if not feedback:
        return None
    return {
        "verdict": verdict,
        "score": overall,
        "literacy": literacy,
        "strengths": string_list(data.get("strengths")),
        "gaps": string_list(data.get("gaps")),
        "feedback": feedback,
        "next_step": next_step,
    }


def _build_chain_input(req: ChatRequest, sources: list[Document]) -> dict[str, Any]:
    stage = req.stage if req.stage in VALID_STAGES else "3-4"
    mode = req.mode if req.mode in MODE_GUIDE else DEFAULT_MODE
    guide = STAGE_GUIDE[stage]
    mode_data = MODE_GUIDE[mode]

    runtime = f"""
【本轮学习参数】
- 当前学段：{STAGE_LABEL[stage]}
- 学段特征：{guide['description']}
- 学段回答约束：{guide['promptHint']}
- 当前主题：{req.concept or '由学生问题自动定位'}
- 交互模式：{mode_data['name']}
- 模式任务：{mode_data['instruction']}
- 课程覆盖：13个学科核心概念、4个跨学科概念和附录4必做探究实践活动。当前证据分层：{_coverage_prompt()}

【本轮检索资料】
{_build_context(sources)}

请严格依照系统角色、回答结构与图谱 JSON 协议作答。只允许使用上述检索资料作为课标事实证据；资料不足时明确说明。
""".strip()

    history: list[BaseMessage] = []
    for item in req.history[-MAX_HISTORY_MESSAGES:]:
        content = item.content.strip()
        if not content:
            continue
        if item.role == "user":
            history.append(HumanMessage(content=content[:6000]))
        else:
            history.append(AIMessage(content=content[:6000]))

    return {
        "base_system_prompt": BASE_SYSTEM_PROMPT,
        "runtime_protocol": RUNTIME_PROTOCOL,
        "runtime": runtime,
        "history": history,
        "question": req.message.strip(),
    }


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _extract_graph(raw: str) -> dict[str, Any] | None:
    """Parse and sanitize the graph block; ignore malformed visual data."""
    if not raw:
        return None
    start = raw.find(GRAPH_OPEN)
    if start != -1:
        start += len(GRAPH_OPEN)
        end = raw.find(GRAPH_CLOSE, start)
        candidate = raw[start:end] if end != -1 else raw[start:]
    else:
        # The streaming parser passes the text after <graph> directly.
        # Accept a bare JSON object as well as a fenced JSON block.
        match = re.search(r"```(?:json)?\s*(\{.*?\"nodes\".*?\})\s*```", raw, re.S)
        candidate = match.group(1) if match else raw

    candidate = candidate.strip()
    candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
    candidate = re.sub(r"\s*```$", "", candidate)
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end <= start:
        return None
    candidate = candidate[start : end + 1]
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        logger.warning("Graph JSON could not be parsed: %s", candidate[:300])
        return None

    raw_nodes = data.get("nodes")
    raw_edges = data.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        return None

    nodes: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    valid_types = {
        "学科核心概念", "子概念", "自然现象", "物质/材料", "生物", "天体",
        "仪器工具", "科学实验", "工程任务", "模型", "科学史实", "变量",
        "条件", "产物", "探究实践活动", "跨学科项目",
    }
    valid_literacies = {"科学观念", "科学思维", "探究实践", "态度责任"}
    for index, node in enumerate(raw_nodes[:16]):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or f"n{index + 1}")[:24]
        if node_id in seen_ids:
            continue
        label = str(node.get("label") or "").strip()[:36]
        if not label:
            continue
        node_type = str(node.get("type") or "子概念").strip()
        if node_type not in valid_types:
            node_type = "子概念"
        literacy = str(node.get("literacy") or "科学观念").strip()
        if literacy not in valid_literacies:
            literacy = "科学观念"
        seen_ids.add(node_id)
        nodes.append(
            {
                "id": node_id,
                "label": label,
                "type": node_type,
                "stage": str(node.get("stage") or data.get("stage") or "")[:20],
                "literacy": literacy,
                "note": str(node.get("note") or "")[:80],
                "root": bool(node.get("root")) and len(nodes) == 0,
            }
        )

    if len(nodes) < 2:
        return None

    if not any(node["root"] for node in nodes):
        nodes[0]["root"] = True

    valid_relations = {
        "包含", "因果", "条件", "结构—功能", "结构-功能", "原理—现象", "原理-现象",
        "影响因素", "变化演化", "对比异同", "输入—输出", "输入-输出", "模型—原型",
        "模型-原型", "能量转化", "物质转化", "实验—证据", "实验-证据",
    }
    edges: list[dict[str, str]] = []
    seen_edges: set[tuple[str, str, str]] = set()
    for edge in raw_edges[:24]:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("from") or "")
        target = str(edge.get("to") or "")
        if source not in seen_ids or target not in seen_ids or source == target:
            continue
        relation = str(edge.get("relation") or "包含").strip()
        if relation not in valid_relations:
            relation = "包含"
        label = str(edge.get("label") or relation)[:24]
        key = (source, target, relation)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        edges.append({"from": source, "to": target, "relation": relation, "label": label})

    if not edges:
        return None

    return {
        "title": str(data.get("title") or "科学知识图谱")[:50],
        "stage": str(data.get("stage") or "")[:20],
        "concept": str(data.get("concept") or "")[:40],
        "nodes": nodes,
        "edges": edges,
    }


app = FastAPI(title=APP_NAME, version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
def config() -> dict[str, Any]:
    return {
        "app_name": APP_NAME,
        "framework": "LangChain",
        "chain": "ChatPromptTemplate | ChatOpenAI",
        "model": MODEL,
        "configured": bool(API_KEY),
        "curriculum": CURRICULUM,
        "knowledge_count": len(KB),
        "knowledge_coverage": KNOWLEDGE_COVERAGE,
        "source_manifest": SOURCE_MANIFEST,
        "chat_modes": [
            {"id": key, "name": value["name"]}
            for key, value in MODE_GUIDE.items()
        ],
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "framework": "LangChain",
        "model": MODEL,
        "configured": bool(API_KEY),
        "knowledge_count": len(KB),
        "knowledge_coverage": KNOWLEDGE_COVERAGE["totals"],
    }


@app.get("/api/library/item/{doc_id}")
def library_item(doc_id: str) -> dict[str, Any]:
    """Return exactly one knowledge chunk.

    The evidence panel uses this endpoint so clicking “资料 3” opens that
    specific page chunk rather than running a fuzzy title search.
    """
    chunk = next((item for item in KB if item.get("id") == doc_id), None)
    if chunk is None:
        raise HTTPException(status_code=404, detail="未找到该资料条目。")
    document = _chunk_to_document(chunk)
    return {
        "result": {
            **_public_source(document),
            "full_text": document.page_content,
            "stages": document.metadata.get("stages", []),
        }
    }


@app.get("/api/library")
def library(
    q: str = Query(default="", max_length=200),
    stage: str = Query(default="3-4"),
    limit: int = Query(default=12, ge=1, le=30),
) -> dict[str, Any]:
    stage = stage if stage in VALID_STAGES else "3-4"
    if q.strip():
        retriever = CurriculumRetriever(
            stage=stage,
            k=limit,
            strict_stage=False,
        )
        documents = retriever.invoke(q)
    else:
        documents = [
            _chunk_to_document(dict(chunk, score=0))
            for chunk in KB[:limit]
        ]
    return {
        "query": q,
        "stage": STAGE_LABEL[stage],
        "total": len(KB),
        "knowledge_coverage": KNOWLEDGE_COVERAGE,
        "results": [
            {
                **_public_source(document),
                "full_text": document.page_content,
                "stages": document.metadata.get("stages", []),
            }
            for document in documents
        ],
    }


@app.get("/api/knowledge")
def knowledge() -> dict[str, Any]:
    return {
        "curriculum": CURRICULUM,
        "knowledge_count": len(KB),
        "indexed_chapters": CURRICULUM.get("source", {}).get("indexed_chapters", []),
        "knowledge_coverage": KNOWLEDGE_COVERAGE,
        "source_manifest": SOURCE_MANIFEST,
    }


@app.get("/api/knowledge/coverage")
def knowledge_coverage() -> dict[str, Any]:
    """Return the evidence-level coverage matrix used by the UI and tests."""
    return {
        "coverage": KNOWLEDGE_COVERAGE,
        "source": SOURCE_MANIFEST,
    }


def _message_text(chunk: Any) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return ""


def _stream_completion(
    chain_input: dict[str, Any],
    sources: list[Document],
    request_id: str,
) -> Iterable[str]:
    yield _sse(
        "meta",
        {
            "request_id": request_id,
            "model": MODEL,
            "sources": [_public_source(document) for document in sources],
        },
    )

    if not API_KEY or CHAT_CHAIN is None:
        yield _sse(
            "error",
            {
                "message": "服务端尚未配置 DASHSCOPE_API_KEY。请在 .env 中填入密钥后重启。",
                "code": "missing_api_key",
            },
        )
        return

    stream = None
    raw_buffer = ""
    sent_until = 0
    in_graph = False
    graph_text = ""

    try:
        stream = CHAT_CHAIN.stream(chain_input)

        for chunk in stream:
            delta = _message_text(chunk)
            if not delta:
                continue

            if in_graph:
                graph_text += delta
                continue

            raw_buffer += delta
            open_index = raw_buffer.find(GRAPH_OPEN)
            if open_index != -1:
                visible = raw_buffer[:open_index]
                if len(visible) > sent_until:
                    yield _sse("delta", {"text": visible[sent_until:]})
                    sent_until = len(visible)
                in_graph = True
                graph_text = raw_buffer[open_index + len(GRAPH_OPEN) :]
                continue

            holdback = 0
            max_hold = min(len(GRAPH_OPEN) - 1, len(raw_buffer))
            for size in range(max_hold, 0, -1):
                if raw_buffer.endswith(GRAPH_OPEN[:size]):
                    holdback = size
                    break
            safe_until = len(raw_buffer) - holdback
            if safe_until > sent_until:
                yield _sse("delta", {"text": raw_buffer[sent_until:safe_until]})
                sent_until = safe_until

        if not in_graph and len(raw_buffer) > sent_until:
            yield _sse("delta", {"text": raw_buffer[sent_until:]})
            sent_until = len(raw_buffer)

        graph = _extract_graph(graph_text if in_graph else raw_buffer)
        if graph:
            yield _sse("graph", graph)
        yield _sse("done", {"request_id": request_id})

    except Exception as exc:  # API/auth/network errors should not leak sensitive details
        logger.exception("Chat completion failed [%s]", request_id)
        message = "模型服务暂时不可用，请稍后再试。"
        status = getattr(exc, "status_code", None)
        if status in {401, 403}:
            message = "模型鉴权失败，请检查 DASHSCOPE_API_KEY 是否有效。"
        elif status == 429:
            message = "模型调用频率或额度受限，请稍后重试。"
        elif isinstance(exc, TimeoutError):
            message = "模型响应超时，请重试。"
        yield _sse("error", {"message": message, "code": "model_error"})
    finally:
        if stream is not None and hasattr(stream, "close"):
            try:
                stream.close()
            except Exception:
                pass


@app.post("/api/chat")
def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    stage = req.stage if req.stage in VALID_STAGES else "3-4"
    mode = req.mode if req.mode in MODE_GUIDE else DEFAULT_MODE
    concept = (req.concept or "").strip() or None
    query = req.message.strip()
    if not query:
        raise HTTPException(status_code=400, detail="请输入学习问题。")

    search_query = " ".join(
        part for part in [query, concept or "", MODE_GUIDE[mode]["name"]] if part
    )
    retriever = CurriculumRetriever(
        stage=stage,
        concept=concept,
        mode=mode,
        k=MAX_SOURCE_COUNT,
        strict_stage=True,
    )
    sources = retriever.invoke(search_query)
    chain_input = _build_chain_input(req, sources)
    request_id = uuid.uuid4().hex[:12]

    logger.info(
        "chat request=%s stage=%s mode=%s concept=%s sources=%s",
        request_id,
        stage,
        mode,
        concept,
        [document.metadata.get("id") for document in sources],
    )

    return StreamingResponse(
        _stream_completion(chain_input, sources, request_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/assess")
def assess(req: AssessRequest) -> dict[str, Any]:
    stage = req.stage if req.stage in VALID_STAGES else "3-4"
    concept = (req.concept or "").strip() or None
    if not ASSESS_CHAIN:
        raise HTTPException(status_code=503, detail="模型服务尚未配置。")

    query = " ".join(
        part for part in [concept or "", req.question[:800], req.answer[:500]] if part
    )
    retriever = CurriculumRetriever(
        stage=stage,
        concept=concept,
        mode="assessment",
        k=4,
        strict_stage=True,
    )
    sources = retriever.invoke(query)
    try:
        raw = ASSESS_CHAIN.invoke(
            {
                "assessment_system": ASSESSMENT_SYSTEM,
                "context": _build_context(sources),
                "stage": STAGE_LABEL[stage],
                "concept": concept or "由学生问题自动定位",
                "question": (req.context + "\n\n" + req.question)[:8000],
                "answer": req.answer[:6000],
            }
        )
    except Exception:
        logger.exception("Assessment request failed")
        raise HTTPException(status_code=502, detail="评估服务暂时不可用，请稍后重试。")

    assessment = _parse_assessment(raw)
    if not assessment:
        raise HTTPException(status_code=502, detail="评估结果格式异常，请重试。")
    return {
        "stage": STAGE_LABEL[stage],
        "concept": concept,
        "assessment": assessment,
        "sources": [_public_source(document) for document in sources],
    }


@app.exception_handler(HTTPException)
def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )

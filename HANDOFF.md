# AI Learning Lab 交接文档

> 面向后续接手本项目的 AI 助手。开发前先阅读本文，并以代码和正式文档为准核对当前状态。

## 1. 项目定位与边界

`ai-learning-lab` 是本地单用户的 AI 辅助学习系统，用于完成学习材料导入、阅读提问、掌握度评估和复习安排。

- 本地 Web 站点，不考虑公网部署、多用户、鉴权、HTTPS、云备份或多租户。
- 保持本地单体架构；不要引入 Celery、Redis、消息队列、复杂 Docker Compose 或分布式部署。
- 长耗时 LLM 调用通过持久化任务和后台 worker 执行，不能重新改回阻塞 HTTP 请求。

## 2. 关键文档

接手时按以下顺序阅读：

1. [HANDOFF.md](file:///Users/meiao/ai_workspace/ai-learning-lab/HANDOFF.md)
2. [DEV.md](file:///Users/meiao/ai_workspace/ai-learning-lab/DEV.md)
3. [docs/V1-ALPHA.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/V1-ALPHA.md)
4. [docs/PRD.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/PRD.md)
5. [docs/MVP.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/MVP.md)
6. [requirements.txt](file:///Users/meiao/ai_workspace/ai-learning-lab/requirements.txt)
7. [pyproject.toml](file:///Users/meiao/ai_workspace/ai-learning-lab/pyproject.toml)

`docs/V1-ALPHA.md` 是当前产品和分阶段开发范围的准绳。若文档与代码冲突，以当前可运行
代码、迁移和 `DEV.md` 的环境基线为准，再修正文档。

## 3. 技术栈与环境

后端：

- Python 3.12
- Django 4.2 + Django REST Framework
- SQLite
- APScheduler 3.x
- OpenAI-compatible SDK，可切换到本地 Ollama

前端：

- React + TypeScript + Vite
- Ant Design
- Axios

本机已验证环境：

- Python 3.12.13，虚拟环境为项目根目录 `.venv`
- Node.js v20.20.2，npm 10.8.2
- 本地 Ollama

Node.js 通过 nvm 管理，默认版本为 v20.20.2。`~/.zshenv` 已将其 bin 目录置于
`PATH` 首位，因此 Trae Agent 的交互和非交互 zsh 都会自动使用 Node 20。

根目录 `.env` 是实际运行配置，后端 [api/ai_gateway.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/ai_gateway.py) 会固定从项目根目录加载。当前默认配置为：

```env
LLM_PROVIDER_TYPE=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3.6:35b-a3b
LLM_API_KEY=ollama
```

不要提交 `.env`。模板位于 `.env.example`。

## 4. 当前已完成功能

- 主题管理：`Topic` 的创建、列表和详情；支持学习型 / 讨论型分类、搜索与筛选。
- 材料导入：网页抓取或纯文本粘贴、清洗及 `MaterialChunk` 自动分段；材料标记人工添加
  或 AI 推荐来源。
- 阅读页：`UniversalReader` HTML 外壳、暗色模式、来源入口、任务状态可见性、划词提问和
  AI 侧边助手；选中文本菜单支持概念、问答和高亮。
- 概念卡片：`Concept` 草稿由 `AITask` 异步补全定义、原理、易错点与适用场景；用户编辑确认
  后保存。`ConceptAnchor` 和 `Highlight` 均以材料 `clean_text` offset 保存可回跳来源。
- 问答沉淀：划词问答同样保存来源 offset；回答完成后可沉淀为材料问答记录或关联到概念卡片。
  高亮侧栏支持查看原文和删除。
- Assessment 闭环：迁移性题目生成、作答、AI 阅卷、掌握度更新和首次复习记录。
- Django Admin：所有核心模型均已注册。
- LLM 网关：支持 OpenAI-compatible Provider 与本地 Ollama。
- 异步 AI 交互：阅读前导、问答、出题和阅卷都通过 `AITask` 后台执行。
- 结构化笔记：基于已处理材料异步生成 Markdown 草稿，用户确认后保存为 `Note`；
  支持编辑、删除和携带用户要求的再次生成。
- 复习工作流：复习计划页按待复习、后续计划和已完成展示 `ReviewRecord`；用户可进入
  主题回顾后标记完成，并异步生成可持久化的 Markdown 复习提示。

## 5. 异步任务架构

核心文件：

- [api/models.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/models.py)：`AITask`、`Concept`、
  `ConceptAnchor`、`Highlight`、`Note`、`Exam`、`ExamQuestion`、`ReviewRecord`。
- [api/task_service.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/task_service.py)：入队、去重、任务执行、三次重试和结果写回。
- [api/note_service.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/note_service.py)：笔记材料上下文和内容指纹计算。
- [api/scheduler.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/scheduler.py)：APScheduler 单 worker 调度器。
- [api/apps.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/apps.py)：仅在 `runserver` 子进程启动 scheduler，避免 autoreloader 双启动。
- [frontend/src/hooks/useAITaskPolling.ts](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/hooks/useAITaskPolling.ts)：前端每 2 秒轮询任务。

任务状态：

```text
pending -> running -> succeeded
                   -> pending (自动重试)
                   -> failed
```

- 每个任务最多尝试 3 次，重试退避为 5、15、45 秒。
- 同一关联对象的同类型 `pending/running` 任务会复用。
- 服务重启时，未完成的 `running` 任务会恢复为 `pending`。
- 单 worker 串行执行，避免本地大模型并发争用。

任务 API：

| 场景 | 发起接口 | 响应 | 查询接口 |
| --- | --- | --- | --- |
| 阅读前导 | 材料导入成功后自动入队 | 材料 CRUD 响应 | `GET /api/ai-tasks/?material={id}` |
| 划词问答 | `POST /api/questions/` | `202`，`{question, task}` | `GET /api/ai-tasks/{id}/` |
| 概念草稿 | `POST /api/topics/{id}/concepts/` | `202`，`{concept, task}` | `GET /api/ai-tasks/{id}/` |
| 笔记草稿 | `POST /api/topics/{id}/note-drafts/` | `202`，`{task}` | `GET /api/ai-tasks/{id}/` |
| 考试生成 | `POST /api/exams/` | `202`，`{task}` | `GET /api/ai-tasks/{id}/` |
| 阅卷 | `POST /api/exams/{id}/submit/` | `202`，`{task}` | `GET /api/ai-tasks/{id}/` |
| 复习提示 | `POST /api/reviews/{id}/prompt/` | `202`，`{task}` | `GET /api/ai-tasks/{id}/` |
| 失败重试 | `POST /api/ai-tasks/{id}/retry/` | `202`，任务重置为 `pending` | - |

不要让前端等待 LLM 的完成响应。页面应先显示任务提交状态，再通过轮询展示成功、失败或重试入口。

复习 API：

- `GET /api/reviews/`：按应复习时间返回记录，可传 `result=pending|completed` 过滤。
- `POST /api/reviews/{id}/complete/`：将待复习记录标记为完成并写入 `completed_at`。
- `POST /api/reviews/{id}/prompt/`：基于处理成功的材料、结构化笔记及最近测验反馈创建
  `review_prompt` 任务；同一记录的 `pending/running` 任务会复用。

## 6. 结构化笔记

- `Note` 保存用户确认后的标题、Markdown 内容、来源任务与材料指纹；已应用
  `api.0006_note` 和 `api.0007_note_material_fingerprint` 迁移。
- 笔记草稿任务只读取 `import_status=success` 的材料。服务端基于材料 ID、标题和
  清洗文本生成 SHA-256 指纹。
- 若同一主题存在相同指纹的笔记，未携带 `instructions` 的草稿请求返回 `409`，避免
  无材料变化时重复调用 LLM。
- 用户可在前端编辑或删除正式笔记；若要在材料未变化时重新生成，必须填写
  `instructions`，该要求会传入笔记 Prompt。
- `NoteViewSet` 提供 `/api/notes/` CRUD；创建时只允许关联已成功的同主题
  `note_draft` 任务。
- 复习提示已应用 `api.0008_review_prompt_task` 和
  `api.0009_alter_aitask_task_type` 迁移：`ReviewRecord` 保存提示正文与生成时间，
  `AITask` 通过 `review` 外键关联复习记录，并新增 `review_prompt` 任务类型。

## 7. 数据模型与业务状态

- `Topic`：学习主题和 `mastery_level`。
- `Material` / `MaterialChunk`：材料原文、清洗文本和分段。
- `Question` / `AIResponse`：用户问题及回答、阅读前导。
- `Note`：用户确认的结构化笔记、来源任务和材料指纹。
- `Exam` / `ExamQuestion`：主题综合测验、作答和评分。
- `ReviewRecord`：Assessment 后的首次复习时间、完成状态、可持久化的 AI 复习提示及其
  生成时间。
- `AITask`：所有长耗时 AI 工作的状态、输入摘要、结构化结果、错误和重试信息。

掌握度规则：

| 平均分 | `mastery_level` | 首次复习 |
| --- | --- | --- |
| >= 85 | `strong` | 7 天后 |
| >= 60 | `pass` | 3 天后 |
| < 60 | `weak` | 1 天后 |

## 8. 启动与验证

启动后端：

```bash
cd /Users/meiao/ai_workspace/ai-learning-lab/backend
source ../.venv/bin/activate
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

启动前端：

```bash
cd /Users/meiao/ai_workspace/ai-learning-lab/frontend
npm run dev
```

提交前最低验证：

```bash
cd /Users/meiao/ai_workspace/ai-learning-lab
.venv/bin/python -m ruff format --check backend
.venv/bin/python -m ruff check backend
(cd backend && ../.venv/bin/python manage.py test api)
(cd backend && ../.venv/bin/python manage.py check)
(cd frontend && npm run build)
```

当前已通过 Ruff、Django API 测试（15 项）、Django check、TypeScript `tsc -b` 与
Node v20.20.2 下的 `npm run build`。Vite 会报告主 JavaScript bundle 超过 500 kB，
后续可通过代码分割优化。

## 9. 代码规范

- 后端 Python 必须遵循 PEP 8，使用 Ruff/Black 兼容的 88 字符行宽。
- Ruff 规则见 [pyproject.toml](file:///Users/meiao/ai_workspace/ai-learning-lab/pyproject.toml)；配置和使用命令见 [DEV.md](file:///Users/meiao/ai_workspace/ai-learning-lab/DEV.md)。
- 新增后端依赖必须更新 `requirements.txt`；新增前端依赖必须更新 `package.json` 和 lockfile。
- 修改业务逻辑后至少运行相关 Django 测试和 `manage.py check`。

## 10. 后续优先级

当前进入 V1-alpha 的阶段化开发。完整范围、原型和验收标准见
[docs/V1-ALPHA.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/V1-ALPHA.md)。

阶段 1 至阶段 3 已完成：

1. `api.0010_material_source_type_topic_type` 已应用，`Topic.type` 和
   `Material.source_type` 已贯穿 API 与 Django Admin。
2. 主页已支持搜索、全部 / 学习 / 讨论筛选，以及带可选 URL 或粘贴文本初始材料的新建话题。
3. `frontend/src/components/UniversalReader/` 已提供 HTML 正文阅读外壳和暗色模式；PDF、
   音视频和文件上传仍未实现，不能在 UI 中伪支持。
4. `api.0011_concept_highlight_conceptanchor_aitask_concept_and_more` 和
   `api.0012_alter_aitask_task_type` 已应用。阅读选区按 `MaterialChunk` 的 offset 持久化；
   用户可发起概念草稿、编辑并确认概念卡片，或创建不调用 AI 的高亮。
5. `api.0013_question_concept_question_end_offset_and_more` 已应用。问答保留来源锚点，并可
   沉淀到材料问答记录或当前 Topic 的概念卡片；高亮侧栏支持原文定位和删除。

下一步实施阶段 4：建立概念关系、Topic 主思维导图和学习产出展示。讨论型 AI 对话和阶段总结
按 V1-alpha 后续阶段推进。所有长耗时 AI 能力继续走
`AITask` 异步任务和前端轮询，不能退回为阻塞请求。

## 11. 接手原则

1. 修改前先确认当前文件状态，避免覆盖现有改动。
2. 优先复用既有 Django、DRF、Ant Design、任务服务和 AI Gateway 模式。
3. 保持本地个人工具的复杂度边界，不擅自引入企业级基础设施。
4. 交付前运行必要校验，并如实说明结果和剩余风险。

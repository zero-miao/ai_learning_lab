# AI Learning Lab 交接文档

> 面向后续接手本项目的 AI 助手。本文记录当前工作区代码的真实状态；产品方案中的未实现设想不应视为既有能力。

## 1. 项目边界

`ai-learning-lab` 是本地单用户的 AI 辅助学习系统，覆盖材料导入、阅读理解、概念沉淀、掌握度评估和复习安排。

- 保持本地单体架构；不引入 Celery、Redis、消息队列、复杂 Docker Compose 或多用户鉴权。
- 所有长耗时 LLM 调用必须经持久化 `AITask` 和后台 worker 执行，前端以轮询获取结果。
- 不支持公网部署、HTTPS、云备份、多租户或同步协作。

## 2. 关键文档

接手时按以下顺序阅读：

1. [HANDOFF.md](HANDOFF.md)
2. [DEV.md](DEV.md)
3. [docs/V1-ALPHA.md](docs/V1-ALPHA.md)
4. [docs/PRD.md](docs/PRD.md)
5. [requirements.txt](requirements.txt) 和 [pyproject.toml](pyproject.toml)
6. 相关模型、迁移、API 和前端页面

[docs/V1-ALPHA.md](docs/V1-ALPHA.md) 是产品方向和验收设想，其中部分内容尚未实现。若与当前行为冲突，以模型、迁移、测试及 [DEV.md](DEV.md) 为准。

## 3. 技术栈与环境

后端采用 Python 3.12、Django 4.2、Django REST Framework、SQLite、APScheduler 和 OpenAI-compatible SDK；前端采用 React、TypeScript、Vite、Ant Design 和 Axios。

已验证的本机环境：

- Python 3.12.13，虚拟环境为根目录 `.venv`
- Node.js v20.20.2，npm 10.8.2
- 可选本地 Ollama

根目录 `.env` 是实际运行配置，[backend/api/ai_gateway.py](backend/api/ai_gateway.py) 固定从项目根目录加载。不要提交 `.env`；模板见 [.env.example](.env.example)。

```env
LLM_PROVIDER_TYPE=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3.6:35b-a3b
```

可用 `LLM_MODEL_<TASK_TYPE>` 为某类任务覆盖模型，未配置时回退 `LLM_MODEL`。任务入队时持久化实际选用模型，后续重试继续使用该模型。

## 4. 当前已完成

- 话题：支持创建学习型或讨论型 `Topic`，列表支持关键词搜索、类型筛选和创建时间倒序；创建时可附加 URL 或纯文本初始材料。
- 材料：支持网页 URL 抓取和纯文本导入，服务端清洗正文并切分 `MaterialChunk`；展示人工添加或 AI 推荐来源。
- 阅读：`UniversalReader` 按清洗文本和分段渲染 HTML 正文，支持来源链接、系统主题跟随及手动深浅色切换。阅读前导支持标题、列表、加粗、行内代码和表格，默认折叠。
- 阅读锚点：选中文本可创建概念、问答或高亮。服务端基于 `clean_text` offset 校验与保存锚点；三类标记可重叠，并支持精确回跳。
- 概念：概念草稿异步生成定义、原理、易错点和适用场景；同话题同名概念复用并追加锚点。概念可编辑、确认、删除，删除时级联处理锚点和关系。
- 问答与高亮：划词问答异步生成回答，可沉淀到材料记录或关联概念；高亮不触发 AI，可添加、编辑备注、删除和回跳。
- 学习助手：阅读页提供问答、问答历史、概念和高亮侧栏。点击正文标记定位对应条目；普通正文点击会清除选中状态并关闭侧栏。
- 思维导图：每个话题维护一张 `ConceptRelation` 图，支持概念详情、关系创建、编辑和删除。拖拽节点可建立关系；已有任一方向的关系会打开编辑，避免重复创建。
- 讨论：讨论型话题异步生成 AI 开场，支持材料快速评估、持续对话和学习路线。转换为学习型后保留材料、消息和判断依据，且仍可继续讨论。
- Assessment 与复习：可基于成功导入的材料异步出题；完成作答后异步阅卷、更新掌握度并创建首次复习。复习页支持生成提示、提交复盘、异步反馈和下一轮排程。
- 考试草稿：待作答考试恢复服务端答案；输入停止约 800 ms 自动保存，每 10 秒静默保存，支持 Ctrl/Cmd+S 并显示保存状态。
- 管理与任务：核心模型已注册 Django Admin。所有现有长耗时 AI 能力均由 `AITask` 执行，支持单 worker、三次重试和前端轮询。

已移除：

- `Note` 模型、`note_draft` 任务、笔记草稿生成和 `/api/notes/` CRUD。
- 复习提示与复盘评分的上下文仅来自成功导入的材料、概念和已沉淀问答。

## 5. 异步任务与 API

任务状态：

```text
pending -> running -> succeeded
                   -> pending (自动重试)
                   -> failed
```

- 每个任务最多尝试 3 次，退避 5、15、45 秒。
- 同一关联对象的同类型 `pending/running` 任务复用。
- 服务重启时未完成的 `running` 任务恢复为 `pending`。
- APScheduler 以单 worker 串行执行，避免本地模型并发争用。
- 前端通过 [frontend/src/hooks/useAITaskPolling.ts](frontend/src/hooks/useAITaskPolling.ts) 每 2 秒轮询。

| 场景 | 发起接口 | 响应 |
| --- | --- | --- |
| 阅读前导 | 材料导入成功后自动入队 | 材料 CRUD 响应 |
| 划词问答 | `POST /api/questions/` | `202`，`{question, task}` |
| 概念草稿 | `POST /api/topics/{id}/concepts/` | `202`，`{concept, task}` |
| 讨论开场 | 创建讨论型 Topic 后自动入队 | Topic CRUD 响应 |
| 讨论评估 | `POST /api/topics/{id}/discussion-assessment/` | `202`，`{task}` |
| 讨论追问 | `POST /api/topics/{id}/discussion-messages/` | `202`，`{message, task}` |
| 学习路线 | `POST /api/topics/{id}/learning-path/` | `202`，`{task}` |
| 考试生成 | `POST /api/exams/` | `202`，`{task}` |
| 阅卷 | `POST /api/exams/{id}/submit/` | `202`，`{task}` |
| 复习提示 | `POST /api/reviews/{id}/prompt/` | `202`，`{task}` |
| 复盘提交 | `POST /api/reviews/{id}/submit/` | `202`，`{task}` |
| 保存答题草稿 | `POST /api/exams/{id}/save/` | `200`，考试及已保存答案 |
| 失败重试 | `POST /api/ai-tasks/{id}/retry/` | `202`，任务重置为 `pending` |

任务查询使用 `GET /api/ai-tasks/{id}/` 或以关联对象筛选 `GET /api/ai-tasks/?topic={id}`。不要让前端等待 LLM 完成后才返回请求。

## 6. 数据模型与业务规则

- `Topic`：学习或讨论主题、状态和掌握度。
- `Material` / `MaterialChunk`：材料原文、清洗文本和位置分段。
- `Question` / `AIResponse`：阅读问题、回答和阅读前导。
- `Concept` / `ConceptAnchor` / `ConceptRelation`：概念卡片、来源锚点和单话题关系图。
- `Highlight`：阅读高亮、可选用户备注和位置锚点。
- `DiscussionMessage`：讨论消息及其来源任务。
- `Exam` / `ExamQuestion`：主题综合测验、用户答案和评分。
- `ReviewRecord`：首次与后续复习、提示、回答、反馈和排程。
- `AITask`：异步任务状态、输入、结果、错误、重试信息和实际模型。

掌握度与首次复习：

| 平均分 | `mastery_level` | 首次复习 |
| --- | --- | --- |
| >= 85 | `strong` | 7 天后 |
| >= 60 | `pass` | 3 天后 |
| < 60 | `weak` | 1 天后 |

复盘完成后的下次复习：

| 复盘得分 | 间隔 |
| --- | --- |
| >= 85 | 14 天 |
| >= 60 | 7 天 |
| < 60 | 2 天 |

迁移序列当前到 [api.0018_alter_airesponse_task_type_alter_aitask_task_type_and_more](backend/api/migrations/0018_alter_airesponse_task_type_alter_aitask_task_type_and_more.py)：[0017](backend/api/migrations/0017_highlight_user_note.py) 新增高亮备注，`0018` 移除 `Note` 表和笔记任务类型。应用迁移会删除已有笔记数据。

## 7. 启动与验证

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
(cd backend && ../.venv/bin/python manage.py makemigrations --check --dry-run)
(cd backend && ../.venv/bin/python manage.py test api)
(cd backend && ../.venv/bin/python manage.py check)
(cd frontend && npm run build)
```

Vite 当前会报告主 JavaScript bundle 超过 500 kB；该告警尚未通过代码分割处理。

## 8. 代码规范

- 后端遵循 PEP 8，使用 [pyproject.toml](pyproject.toml) 中配置的 Ruff；格式化和检查命令见 [DEV.md](DEV.md)。
- 后端 API 与业务逻辑优先沿用 [backend/api/models.py](backend/api/models.py)、[backend/api/serializers.py](backend/api/serializers.py)、[backend/api/views.py](backend/api/views.py) 和 [backend/api/task_service.py](backend/api/task_service.py) 的既有模式。
- 前端使用 TypeScript、React 和 Ant Design；接口类型与请求封装统一维护在 [frontend/src/api/index.ts](frontend/src/api/index.ts)。
- 新增或修改模型字段必须生成迁移；新增依赖必须同步更新 [requirements.txt](requirements.txt) 或 [frontend/package.json](frontend/package.json) 及 lockfile。

## 9. 后续优先级

以下项目尚未实现，不应在 UI 或 API 中伪支持：

1. AI 概念关系推荐、阶段总结和全局总结。
2. PDF、音频、视频和本地文件上传阅读器。
3. 外部搜索、自动补充材料和 AI 推荐材料的实际导入流程。
4. 跨 Topic 概念关系与完整交互界面。
5. 多用户、鉴权、云端部署和数据同步。
6. 主 JavaScript bundle 的代码分割优化。

## 10. 接手原则

1. 先检查工作区，不能覆盖未提交变更。
2. 优先复用 Django、DRF、Ant Design、`AITask` 与 AI Gateway 现有模式。
3. 新增长耗时 AI 能力时，必须定义任务类型、持久化结果、失败重试和前端轮询状态。
4. 修改阅读锚点或阅读器时，验证概念、问答和高亮的精确回跳。
5. 交付前运行相关验证，并仅记录已验证的当前行为。

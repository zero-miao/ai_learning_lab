# AI Learning Lab 交接文档

> 本文记录当前已提交代码的真实状态。若与产品方案冲突，以运行代码、迁移和 `DEV.md` 为准；修复文档，而不是回退已验证实现。

## 项目与边界

`ai-learning-lab` 是本地单用户的 AI 辅助学习应用。技术栈为 Django 4.2、DRF、SQLite、APScheduler、React、TypeScript、Vite 和 Ant Design。

- 保持本地单体架构；不引入 Celery、Redis、消息队列、Docker 编排或多用户鉴权。
- 所有长耗时 LLM 调用必须经过持久化 `AITask` 和前端轮询，不能退回同步阻塞请求。
- 支持 OpenAI-compatible 网关和本地 Ollama。实际配置来自根目录 `.env`，不可提交。
- 已验证环境：Python 3.12.13、Node.js 20.20.2、npm 10.8.2；虚拟环境为根目录 `.venv`。

## 接手顺序

1. `HANDOFF.md`
2. `DEV.md`
3. `docs/V1-ALPHA.md`
4. `backend/api/models.py`、`backend/api/views.py`、`backend/api/task_service.py`
5. 对应前端页面及 `frontend/src/api/index.ts`

`docs/V1-ALPHA.md` 保留产品设想和验收方向，其中部分后续设想尚未实现，不应被当作当前能力清单。

## 已完成功能

### 话题与材料

- 主题列表支持搜索和全部 / 学习类 / 讨论类筛选；新建话题可附带 URL 或粘贴文本初始材料。
- 学习型 Topic 支持材料导入、网页抓取、清洗、自动 `MaterialChunk` 分段和来源类型展示。
- 讨论型 Topic 支持 AI 开场、材料快速评估、持续对话、学习路线、结论与理由沉淀，并可转为学习型 Topic 保留上下文。

### 阅读与知识产出

- `UniversalReader` 渲染 HTML 清洗文本；阅读模式默认跟随系统深浅色并支持手动切换，支持阅读前导和文本选区菜单。
- 选区可创建概念、发起问答或高亮，均保存 `clean_text` offset；概念、问答、高亮允许重叠。
- 概念草稿异步生成定义、原理、易错点和适用场景；概念可编辑、确认、删除，并保留一个或多个来源锚点。
- 问答任务会向模型传入用户选中的原文；问答可沉淀、删除、查看历史和精确跳回原文。
- 高亮可查看、删除并跳回原文。
- 正文中概念以蓝色或绿色文字区分确认 / 草稿，高亮用背景色，问答带问号；点击后正文显示紫色选中描边。
- 阅读前导为独立、默认折叠的基础 Markdown 视图，支持标题、列表、行内加粗 / 代码和表格。
- 学习助手只有一个浮动入口，包含问答、问答历史、概念和高亮 Tab；点击 Drawer 外区域会关闭它。列表条目的操作位于标题行，以带 Tooltip 的图标呈现，正文可完整显示。

### 学习产出与思维导图

- 学习型 Topic 的“学习产出”使用问答、概念、高亮 Tab，标题以 `类别 (数量)` 显示；每项都可以跳回原文。
- 思维导图为单 Topic 的 `ConceptRelation` 图；可编辑 / 删除关系，编辑概念，删除概念及其关联关系。
- 将节点拖拽到另一节点可创建关系；拖到已有关系会打开该关系编辑，避免重复关联。

### 评估与复习

- AI 异步生成迁移性考试题，阅卷后更新 Topic 掌握度并创建首次复习记录。
- 待作答考试自动保存：输入停止后保存，且每 10 秒尝试保存；支持 Ctrl/Cmd+S，并显示保存中、已保存、未保存、失败状态。
- 复习页支持生成复习提示、提交复盘回答、异步获得反馈和评分；完成后按分数创建下一条复习记录：`>=85` 分 14 天、`>=60` 分 7 天，其余 2 天。

### 兼容能力

- `Note`、笔记草稿任务和相关 API / 数据仍存在，以兼容旧数据与复习上下文；学习型 Topic UI 已不再提供结构化笔记入口。
- Django Admin 已注册核心业务模型。

## 异步任务

`backend/api/task_service.py` 统一调度 AI 任务；`backend/api/scheduler.py` 以单 worker 执行。

- 状态流转：`pending -> running -> succeeded | pending(重试) | failed`。
- 每个任务最多 3 次，退避为 5、15、45 秒；同一关联对象的同类型待执行任务复用。
- 服务重启会将未完成的 `running` 任务恢复为 `pending`。
- 前端使用 `frontend/src/hooks/useAITaskPolling.ts` 每 2 秒轮询。

当前任务类型包括：阅读前导、问答、概念草稿、讨论开场 / 评估 / 追问、学习路线、笔记草稿、出题、阅卷、复习提示和复盘评分。

## 重要模型与迁移

- `Topic`、`Material`、`MaterialChunk`
- `Concept`、`ConceptAnchor`、`ConceptRelation`、`Highlight`
- `Question`、`AIResponse`
- `DiscussionMessage`、`Exam`、`ExamQuestion`、`ReviewRecord`
- `AITask`、`Note`

迁移已到 `api.0016_reviewrecord_feedback_reviewrecord_graded_at_and_more`。模型字段变更后必须生成并应用迁移。

## 当前明确未实现

- PDF、音频、视频和本地文件上传阅读器。
- AI 自动推荐概念关系、阶段 / 全局总结。
- 跨 Topic 概念关系和完整 UI。
- 外部搜索、自动补充材料、AI 推荐材料的实际导入流程。
- 多用户、鉴权、云端部署和数据同步。

## 验证命令

```bash
cd /Users/meiao/ai_workspace/ai-learning-lab
.venv/bin/python -m ruff format --check backend
.venv/bin/python -m ruff check backend
(cd backend && ../.venv/bin/python manage.py makemigrations --check --dry-run)
(cd backend && ../.venv/bin/python manage.py test api)
(cd backend && ../.venv/bin/python manage.py check)
(cd frontend && npm run build)
```

当前基线：20 项 API 测试、Ruff、迁移检查、Django check 和前端构建通过。Vite 仍会报告主 JavaScript bundle 超过 500 kB，尚未做代码分割。

## 接手原则

1. 先检查工作区状态，不能覆盖用户的未提交改动。
2. 优先沿用 Django / DRF、Ant Design、`AITask` 和 API 现有模式。
3. 新增长耗时 AI 能力时，必须定义任务类型、持久化结果、失败重试和前端轮询状态。
4. 修改锚点或阅读器时，验证概念、问答和高亮的精确回跳。
5. 交付前运行相关验证，并同步更新本文件，只描述当前真实行为。

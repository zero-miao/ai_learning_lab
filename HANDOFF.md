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
3. [docs/PRD.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/PRD.md)
4. [docs/TECH.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/TECH.md)
5. [requirements.txt](file:///Users/meiao/ai_workspace/ai-learning-lab/requirements.txt)
6. [pyproject.toml](file:///Users/meiao/ai_workspace/ai-learning-lab/pyproject.toml)

若文档与代码冲突，以当前可运行代码、迁移和 `DEV.md` 的环境基线为准，再修正文档。

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

根目录 `.env` 是实际运行配置，后端 [api/ai_gateway.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/ai_gateway.py) 会固定从项目根目录加载。当前默认配置为：

```env
LLM_PROVIDER_TYPE=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3.6:35b-a3b
LLM_API_KEY=ollama
```

不要提交 `.env`。模板位于 `.env.example`。

## 4. 当前已完成功能

- 主题管理：`Topic` 的创建、列表和详情。
- 材料导入：网页抓取或纯文本粘贴、清洗及 `MaterialChunk` 自动分段。
- 阅读页：沉浸式阅读、划词提问和 AI 侧边助手。
- Assessment 闭环：迁移性题目生成、作答、AI 阅卷、掌握度更新和首次复习记录。
- Django Admin：所有核心模型均已注册。
- LLM 网关：支持 OpenAI-compatible Provider 与本地 Ollama。
- 异步 AI 交互：阅读前导、问答、出题和阅卷都通过 `AITask` 后台执行。

## 5. 异步任务架构

核心文件：

- [api/models.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/models.py)：`AITask`、`Exam`、`ExamQuestion`、`ReviewRecord`。
- [api/task_service.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/task_service.py)：入队、去重、任务执行、三次重试和结果写回。
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
| 考试生成 | `POST /api/exams/` | `202`，`{task}` | `GET /api/ai-tasks/{id}/` |
| 阅卷 | `POST /api/exams/{id}/submit/` | `202`，`{task}` | `GET /api/ai-tasks/{id}/` |
| 失败重试 | `POST /api/ai-tasks/{id}/retry/` | `202`，任务重置为 `pending` | - |

不要让前端等待 LLM 的完成响应。页面应先显示任务提交状态，再通过轮询展示成功、失败或重试入口。

## 6. 数据模型与业务状态

- `Topic`：学习主题和 `mastery_level`。
- `Material` / `MaterialChunk`：材料原文、清洗文本和分段。
- `Question` / `AIResponse`：用户问题及回答、阅读前导。
- `Exam` / `ExamQuestion`：主题综合测验、作答和评分。
- `ReviewRecord`：Assessment 后的首次复习时间。
- `AITask`：所有长耗时 AI 工作的状态、输入摘要、结构化结果、错误和重试信息。

掌握度规则：

| 平均分 | `mastery_level` | 首次复习 |
| --- | --- | --- |
| >= 85 | `strong` | 7 天后 |
| >= 60 | `pass` | 3 天后 |
| < 60 | `weak` | 1 天后 |

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
nvm use 20
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

## 8. 代码规范

- 后端 Python 必须遵循 PEP 8，使用 Ruff/Black 兼容的 88 字符行宽。
- Ruff 规则见 [pyproject.toml](file:///Users/meiao/ai_workspace/ai-learning-lab/pyproject.toml)；配置和使用命令见 [DEV.md](file:///Users/meiao/ai_workspace/ai-learning-lab/DEV.md)。
- 新增后端依赖必须更新 `requirements.txt`；新增前端依赖必须更新 `package.json` 和 lockfile。
- 修改业务逻辑后至少运行相关 Django 测试和 `manage.py check`。

## 9. 后续优先级

1. 结构化笔记：从材料和 AI 对话生成草稿，并要求用户确认后保存。
2. 复习工作流：展示待复习记录，并生成复习题或提示。
3. 阅读体验：继续优化长文排版和任务状态的可见性。
4. Assessment 质量：迭代 Prompt、输出校验与题目/评分质量。

## 10. 接手原则

1. 修改前先确认当前文件状态，避免覆盖现有改动。
2. 优先复用既有 Django、DRF、Ant Design、任务服务和 AI Gateway 模式。
3. 保持本地个人工具的复杂度边界，不擅自引入企业级基础设施。
4. 交付前运行必要校验，并如实说明结果和剩余风险。

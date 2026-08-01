# 异步 LLM 交互改造计划

## 摘要

将当前所有在 HTTP 请求内同步等待 LLM 的操作改为统一的异步任务交互：

1. 前端发起操作后立即得到 `task_id`，不再等待模型完成。
2. Django 内嵌 APScheduler 周期扫描 SQLite 中的待执行任务，并在后台线程中执行。
3. 前端默认停留在当前页显示生成/评分状态，同时允许用户离开；返回关联页面后继续轮询任务状态并自动展示结果。
4. 同一对象的同类未完成任务复用，失败任务最多自动重试 3 次，最终失败后展示原因与“重新尝试”入口。

本次覆盖：

- 材料阅读前导生成
- 划词问答
- 主题考试生成
- 考试阅卷

不在本次实现笔记草稿功能，但任务模型为其预留 `note_draft` 类型，不提供 UI 或业务入口。

## 当前状态分析

- [backend/api/services.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/services.py) 的 `MaterialService.process_material` 在材料导入请求内同步生成 `briefing`。
- [backend/api/views.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/views.py) 的 `QuestionViewSet.perform_create` 同步调用 `AIGateway.ask_question`；`ExamViewSet.create` 和 `submit` 分别同步生成考试与阅卷。
- [backend/api/ai_gateway.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/ai_gateway.py) 是现有唯一的 LLM 调用边界，继续复用其 Prompt 和 JSON 解析。
- [frontend/src/pages/MaterialReader/index.tsx](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/pages/MaterialReader/index.tsx) 当前等待问答 HTTP 响应；[frontend/src/pages/Exam/index.tsx](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/pages/Exam/index.tsx) 当前等待出题和阅卷 HTTP 响应。
- [docs/TECH.md](file:///Users/meiao/ai_workspace/ai-learning-lab/docs/TECH.md) 已规定长期接口形态为 `task_id + GET /ai-tasks/{task_id}`，并允许 MVP 使用数据库任务表与轻量 worker。

## 已确认决策

- 使用 SQLite 持久化任务状态，保持本地单体架构；不引入 Celery、Redis、消息队列或 SSE。
- 使用内嵌 APScheduler worker 扫描并执行任务。
- 页面采用“默认停留并显示状态，但允许离开”的轮询体验。
- 同一关联对象（材料、问题或考试）的同一任务类型若已有 `pending` 或 `running` 任务，发起接口复用该任务并返回原 `task_id`。
- 失败任务最多自动尝试 3 次。退避为 5 秒、15 秒、45 秒；第三次失败后标记为 `failed`，保留错误信息。
- 任务取消不进入本次 MVP 的用户入口；任务模型保留 `cancelled` 状态，供后续扩展。
- 后端重启遗留的 `running` 任务在调度器启动时恢复为可执行状态，避免永久卡住；已超过最大尝试次数的任务标记失败。

## 数据模型与状态

在 [backend/api/models.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/models.py) 新增 `AITask`：

| 字段 | 设计 |
| --- | --- |
| `task_type` | `briefing`、`answer_question`、`generate_exam`、`grade_exam`、预留 `note_draft` |
| `status` | `pending`、`running`、`succeeded`、`failed`、`cancelled` |
| 关联对象 | 可选外键 `material`、`question`、`exam`；每种任务只使用其对应关联对象 |
| `input_json` | 创建任务时冻结的最小输入上下文，保证后台运行不依赖前端请求对象 |
| `result_json` | 结构化结果：回答响应 ID、考试 ID 或评分完成标记等 |
| `error_message` | 最终可展示的归一化错误信息 |
| `attempt_count` / `max_attempts` | 任务尝试次数，默认最大 3 次 |
| `next_run_at` | 调度器下一次可运行时间，建立索引 |
| `started_at` / `finished_at` / `created_at` / `updated_at` | 生命周期与耗时诊断 |
| `model` / `prompt_version` | 记录实际模型和任务 Prompt 版本 |

新增迁移，并在 [backend/api/admin.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/admin.py) 注册任务后台，按类型、状态和创建时间过滤。

## 后端改造

### 1. 任务服务与 worker

新增 [backend/api/task_service.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/task_service.py)：

- `enqueue_or_reuse(...)`：在事务内查询同一关联对象、同一类型的 `pending/running` 任务，存在则返回它；否则创建任务。
- `run_due_tasks()`：领取 `next_run_at <= now` 的 `pending` 任务，将其原子标记为 `running` 后在线程池执行，避免 APScheduler tick 重叠重复执行。
- `execute_task(task_id)`：根据 `task_type` 分派到现有 `AIGateway`，验证模型输出并落库。
- 出题任务完成时创建 `Exam` 与 `ExamQuestion`，将主题改为 `exam_ready`，并在 `result_json` 写入 `exam_id`。
- 阅卷任务完成时按现有逻辑写回题目反馈、总分、`Topic.mastery_level`、`ReviewRecord`，并在 `result_json` 写入 `exam_id`。
- 前导任务完成时创建 `AIResponse(task_type='briefing')`；问答任务完成时创建 `AIResponse(task_type='answer_question')`。
- 异常时依据 `attempt_count` 设置下一次执行时间或最终 `failed`，不吞掉底层异常；返回给前端的 `error_message` 使用安全、可理解的中文消息。
- 启动恢复：将遗留 `running` 任务转为 `pending` 并可立即再次领取；超过最大尝试次数的记录直接失败。

新增 [backend/api/scheduler.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/scheduler.py)：

- 单例 APScheduler `BackgroundScheduler`，以 1 秒间隔调用 `run_due_tasks`。
- 使用固定大小 `ThreadPoolExecutor`（单 worker）顺序执行 LLM，避免本机 Ollama 同时处理多个大模型请求导致严重争用。
- 使用 Django `RUN_MAIN` 保护避免 `runserver` autoreloader 启动两个 scheduler。

修改 [backend/api/apps.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/apps.py)：

- 在 `ApiConfig.ready()` 启动 scheduler。
- 保持导入无副作用，测试运行与 migration 命令不应启动后台调度器。

### 2. API 契约

修改 [backend/api/serializers.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/serializers.py)：

- 新增 `AITaskSerializer`，返回 `id`、类型、状态、尝试次数、关联 ID、结果、错误、时间字段。
- `QuestionSerializer` 保留已有字段，并加入最新关联任务摘要或由前端单独读取任务。
- `ExamSerializer` 保持已完成考试的兼容响应；生成任务未完成时由 `AITask.result_json.exam_id` 指向最终考试。

修改 [backend/api/views.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/views.py)：

- `MaterialViewSet.perform_create` 只同步抓取、清洗、分段；成功后入队 `briefing`，不再等待 LLM。
- `QuestionViewSet.create` 保存问题并入队 `answer_question`，响应 `202 Accepted`，格式为 `{ question, task }`。
- `ExamViewSet.create` 改为创建或复用 `generate_exam` 任务，返回 `202 Accepted` 与任务；不再同步创建考试题。
- `ExamViewSet.submit` 仍先同步校验并保存用户答案，再创建或复用 `grade_exam` 任务，返回 `202 Accepted` 与任务；不再等待分数。
- 新增只读 `AITaskViewSet`：`GET /api/ai-tasks/{id}/` 查询状态；列表接口可通过 `material`、`question`、`exam`、`topic` 查询关联任务。
- 新增重试 action：`POST /api/ai-tasks/{id}/retry/` 仅允许 `failed/cancelled` 任务；重置为 `pending`，清空错误与计数后重新排队。

修改 [backend/api/urls.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/urls.py) 注册 `ai-tasks`。

### 3. AI Gateway 与材料服务

修改 [backend/api/services.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/services.py)：

- 删除材料导入时的直接 `generate_briefing` 调用，成功导入后仅创建 `briefing` 任务。

修改 [backend/api/ai_gateway.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/ai_gateway.py)：

- 保持现有同步 OpenAI-compatible 客户端及现有 JSON Schema 校验，不在本次把 Provider 重写为 `asyncio/httpx`。
- 增加统一任务 Prompt 版本常量与可诊断异常包装，供 worker 写入任务字段。
- 原因：本次先解除 HTTP/UI 阻塞；将模型 I/O 置于后台 worker 已满足交互目标，避免扩大到 Provider 重写风险。

## 前端改造

### 1. 统一任务轮询

修改 [frontend/src/api/index.ts](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/api/index.ts)：

- 新增 `AITask`、任务状态及响应 DTO。
- `createMaterial` 响应继续使用材料；新增按关联对象查询任务 API。
- `createQuestion`、`createExam`、`submitExam` 的返回类型改为 `202` 的任务响应。
- 新增 `getAITask(id)`、`listAITasks(params)`、`retryAITask(id)`。
- 恢复普通 CRUD 请求默认 10 秒超时；LLM 任务发起与轮询接口本身应快速返回，不再需要 120 秒等待。

新增 [frontend/src/hooks/useAITaskPolling.ts](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/hooks/useAITaskPolling.ts)：

- 每 2 秒读取任务直到终态。
- 页面卸载时清理 interval；重新进入页面可按关联对象查找最新未完成任务继续轮询。
- 在任务成功、失败时回调，由页面刷新主题/材料数据并显示成功或错误提示。
- 支持失败任务点击重试后接管新一轮轮询。

### 2. 材料导入与阅读页

修改 [frontend/src/pages/TopicDetail/index.tsx](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/pages/TopicDetail/index.tsx)：

- 材料导入成功后立即关闭弹窗并刷新列表。
- 对正在生成阅读前导的材料显示“AI 前导生成中”标签；用户可立即进入阅读。

修改 [frontend/src/pages/MaterialReader/index.tsx](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/pages/MaterialReader/index.tsx)：

- 进入页面时查询材料关联的未完成 `briefing` 任务并轮询；前导完成后自动刷新材料并追加聊天历史。
- 发送问题后立即将用户消息与“AI 正在思考”占位消息写入聊天记录；API 返回任务后轮询。
- 问答任务成功后从刷新后的问题/AIResponse 追加真实回答并替换占位。
- 失败时将占位改为失败卡片，展示错误信息和“重试”按钮；用户可继续阅读或离开。

### 3. 考试页

修改 [frontend/src/pages/Exam/index.tsx](file:///Users/meiao/ai_workspace/ai-learning-lab/frontend/src/pages/Exam/index.tsx)：

- 点击“生成考试”后立即显示“正在依据材料设计迁移题，可返回主题继续学习”的状态卡片，而不是禁用页面等待长响应。
- 轮询出题任务成功后读取 `result_json.exam_id`、请求考试详情并渲染题目；失败时展示原因与重试按钮。
- 进入考试页时按 topic 查询最新未完成或最近成功的生成任务，恢复中断前的状态。
- 提交答案后立即显示“正在根据评分标准阅卷”的状态卡片，允许返回主题；轮询评分任务完成后刷新考试和主题，展示得分、反馈与首次复习时间。
- 评分失败提供任务重试，不要求用户重新输入答案。

## 兼容与边界

- 已创建的 `draft/graded/failed` 考试不迁移、不删除；新异步任务只影响后续动作。
- 旧的失败考试记录继续保留 Admin 可追溯性。
- `Exam.status='submitted'` 在评分任务排队/运行中使用，以保持考试实体和任务状态一致。
- 任务成功写库必须使用事务；失败不得部分写入题目或掌握度。
- APScheduler 内嵌的局限是 Django 进程关闭时任务不执行；任务记录保留，重启后恢复扫描。应用只面向本地单用户，符合 MVP 约束。
- 不实现 token 流式传输、跨进程队列、系统通知或全局任务中心；页面轮询和关联状态标签为本次完成标准。

## 测试与验收

扩展 [backend/api/tests.py](file:///Users/meiao/ai_workspace/ai-learning-lab/backend/api/tests.py) 或按现有模块拆分新测试文件，覆盖：

1. 材料导入、问答、出题、阅卷接口均在不调用 LLM 的情况下快速返回 `202` 与任务 ID。
2. 同一对象重复请求复用 `pending/running` 任务。
3. Worker 在 mock 的 AIGateway 成功结果下，正确创建 AIResponse、Exam/ExamQuestion，或正确回写阅卷、掌握度与复习记录。
4. Worker 第 1、2 次异常写入下一次运行时间；第 3 次异常最终为 `failed` 并保留错误。
5. `failed` 任务重试 action 重置状态后可再次执行。
6. 启动恢复将孤立 `running` 任务重新加入队列。
7. Django Admin、迁移一致性、`manage.py check` 均通过。

前端验收：

1. 材料导入、提问、出题、阅卷的 UI 不再等待模型 HTTP 响应。
2. 页面停留时每 2 秒刷新状态；离开再返回后仍能看见进行中或已完成结果。
3. 生成或评分失败后展示错误且可重试；重试不丢失阅卷答案。
4. `npm run build` 使用 Node 20 完成。

运行验证：

1. `python manage.py migrate`
2. `python manage.py test api`
3. `python manage.py check`
4. 启动 Django 后端与 Vite 前端，使用本机 Ollama 走通“导入 -> 前导 -> 提问 -> 考试生成 -> 阅卷”的完整异步链路。

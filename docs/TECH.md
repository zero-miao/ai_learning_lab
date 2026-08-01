# AI 辅助学习系统 MVP 技术方案

<callout emoji="💡">
**方案结论：**MVP 建议采用本地单体 Web 应用：前端使用 React + TypeScript + Vite，后端使用 Python Django，SQLite 作为本地持久化存储，AI 接入通过可插拔 LLM Provider 封装。与 LLM 交互的能力应尽量采用异步逻辑：短任务优先 async view + `httpx.AsyncClient`，长耗时任务返回 `task_id` 后由前端轮询或 SSE 获取结果，避免同步请求长期占用 Web worker。
</callout>

## 异步 LLM 交互设计补充

与 LLM 交互的地方默认不设计成长时间同步阻塞接口。MVP 中的阅读前导、选中提问、笔记草稿、考试生成、考试评分等能力都可能受到模型延迟、网络波动和输出重试影响，因此后端应把“发起任务”和“获取结果”拆开：前端提交请求后，后端创建 AI 任务记录并返回 `task_id`；任务执行完成后，前端通过轮询 `GET /ai-tasks/{task_id}` 或 SSE 订阅获取状态与结果。只有预计耗时很短、且失败可快速返回的轻量能力，才允许在同一个请求内直接返回结果。

Django 侧推荐使用 Django 3.1+ 支持的 async view 承接异步 I/O；如果任务会持续较久，或需要重试、恢复、定时触发，则使用 Celery、APScheduler 或简化版数据库任务表承载后台执行。MVP 可以先用数据库任务状态 + 轻量后台 worker/management command 实现，不必一开始引入完整消息队列；但接口契约应先按异步任务设计，避免后续从同步 API 迁移时影响前端。

Ollama 或其他 HTTP 型 LLM Provider 推荐使用 `httpx.AsyncClient` 调用，并统一配置 timeout、重试、取消和错误归一化。支持 streaming 的模型调用应优先采用流式输出：阅读提问、解释生成、笔记草稿这类需要用户等待的场景，可以通过 SSE 把增量 token 或阶段状态推给前端；考试生成、评分等需要结构化校验的任务，可以先流式展示“生成中/校验中/已完成”等状态，最终结果仍以通过 schema 校验后的完整对象入库。

API 响应建议采用统一任务模型：`pending` 表示已创建未执行，`running` 表示调用中，`succeeded` 表示结果可用，`failed` 表示失败且包含可展示错误，`cancelled` 表示用户取消。任务结果中保存 `task_type`、模型名称、prompt 版本、输入摘要、输出内容、耗时、错误信息和重试次数，方便定位模型质量和运行问题。

## 影响范围

- AI Gateway：接口保持 `async`，Provider 调用统一走异步 HTTP 客户端。
- Learning Assistant：阅读前导、选中提问、追问解释优先支持 streaming 或任务状态轮询。
- Note Service：AI 笔记草稿作为后台任务生成，用户确认后再保存为正式笔记。
- Exam Service：考试生成和评分都按长耗时任务处理，提交接口返回任务 ID，评分完成后更新考试状态和掌握状态。
- Review Service：复习提醒本身可同步计算，但涉及 AI 复习题/提示生成时仍走异步任务。

## 关键接口建议

| 场景 | 发起接口 | 查询/订阅接口 | 说明 |
|-|-|-|-|
| 阅读前导 | `POST /materials/{id}/briefing-tasks` | `GET /ai-tasks/{task_id}` 或 SSE | 可流式展示生成进度。 |
| 选中提问 | `POST /questions` | `GET /ai-tasks/{task_id}` 或 SSE | 问题先入库，回答完成后关联 `ai_responses`。 |
| 笔记草稿 | `POST /topics/{id}/note-draft-tasks` | `GET /ai-tasks/{task_id}` | 草稿必须由用户确认后才进入正式笔记。 |
| 考试生成 | `POST /topics/{id}/exam-tasks` | `GET /ai-tasks/{task_id}` | 生成完成后创建 exam 和 exam_questions。 |
| 考试评分 | `POST /exams/{id}/grading-tasks` | `GET /ai-tasks/{task_id}` | 评分完成后更新题目反馈、考试分数和掌握状态。 |

## 实现约束

- 不把 LLM 调用散落在 DRF ViewSet 中，业务层通过 AI Gateway 发起任务。
- 不让长耗时 AI 请求阻塞普通 CRUD 接口。
- 不直接信任模型输出，异步任务完成前必须做 Pydantic/JSON Schema 校验。
- 不因为 MVP 简化就把接口设计成不可迁移的同步形态；即使后台执行先用轻量实现，前端契约也按 `task_id` 与状态查询设计。

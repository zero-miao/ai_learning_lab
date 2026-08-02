# 讨论型话题探索体验与响应速度改造计划

## Summary

将讨论型话题从固定的“是否值得学习”问答流程改为默认探索、逐步收敛的对话体验。用户可先用低信息输入表达困惑，AI 在每次回复中维护简短的会话工作记忆；当信息足够时，AI 提议进入下一阶段，只有用户确认后才切换。

讨论回复继续使用持久化 `AITask` 与失败重试，不引入流式接口。模型按讨论阶段路由：探索使用现有的 14B 快速模型，定义问题使用 30B 模型，形成决策使用 35B 模型。讨论回复在尚未开始执行的任务中获得更高调度优先级；讨论页面缩短轮询显示延迟。

## Current State Analysis

* [backend/api/ai\_gateway.py](../../backend/api/ai_gateway.py) 的讨论开场固定要求“说明价值后询问动机”，讨论回复固定要求围绕“是否应该学、为什么现在学、如何开始”。这直接造成模板化交互。

* [backend/api/models.py](../../backend/api/models.py) 的 `Topic` 和 `DiscussionMessage` 不保存讨论阶段、已确认上下文、待澄清问题或阶段建议；[backend/api/views.py](../../backend/api/views.py) 每轮仅传递最近 10 条原始消息，因此无法形成稳定的探索脉络。

* [backend/api/scheduler.py](../../backend/api/scheduler.py) 使用单线程 worker；[backend/api/task\_service.py](../../backend/api/task_service.py) 按 `next_run_at, id` 领取任务。讨论回复会与材料前导、概念草稿、阅卷等任务排同一个 FIFO 队列。

* 讨论回复默认回退到 `LLM_MODEL=qwen3.6:35b-a3b`；[.env.example](../../.env.example) 尚未提供按讨论阶段的模型覆盖。

* [frontend/src/hooks/useAITaskPolling.ts](../../frontend/src/hooks/useAITaskPolling.ts) 固定每 2 秒轮询，讨论任务成功后才刷新对话列表，进一步增加可见延迟。

* 本机为 Apple M5 Pro、48 GB 统一内存、18 核 CPU，磁盘可用空间约 510 GiB。已安装 `qwen2.5:14b`（9 GB）、`qwen3:30b-a3b`（18 GB）、`qwen3.6:35b-a3b`（23 GB），当前没有模型驻留。现有模型已覆盖速度、平衡和高质量三档，无需新增下载。

## Assumptions & Decisions

* 讨论的默认目标为“先探索，后收敛”。最终仍支持材料评估、是否学习的决策和学习路线。

* 初始界面使用引导卡片和自由输入，不再自动生成泛化的 AI 开场消息。已存在的历史开场消息与任务记录保持可读、可重试，兼容旧数据。

* 讨论阶段为 `explore`（探索）、`frame`（定义问题）、`decide`（形成决策）。新 Topic 默认 `explore`。

* AI 只能建议从当前阶段进入下一阶段；阶段改变必须由用户确认。用户可随时手动回到 `explore`。

* 讨论回复的模型按阶段选择，并在入队时写入 `AITask.model`，保证重试继续使用同一模型：

  * `explore`：`qwen2.5:14b`。用于接住碎片化表达、举例与单点追问，优先降低响应时间。

  * `frame`：`qwen3:30b-a3b`。用于归纳上下文、识别约束并提炼可检验的问题，平衡速度与推理质量。

  * `decide`：`qwen3.6:35b-a3b`。用于比较学习投入、前置条件与后续路径，优先质量。

* 材料快速评估和学习路线维持默认 `LLM_MODEL`，即 `qwen3.6:35b-a3b`。

* 48 GB 统一内存可稳定运行任一单模型，但不应让 30B 与 35B 同时长期驻留。保持单 worker；通过适中的 Ollama `keep_alive` 减少当前阶段的冷启动，而不是增加并发或常驻多个大模型。

* 排队优先级仅影响尚未执行的任务；单 worker 不能安全抢占正在运行的 Ollama 请求。该限制会通过任务状态文案清楚说明。

* 本次不实现 WebSocket、SSE、并发多 worker、云端模型、外部搜索或自动导入材料。

## Proposed Changes

### 1. 持久化讨论阶段、工作记忆与阶段建议

修改 [backend/api/models.py](../../backend/api/models.py)：

* 为 `Topic` 增加 `discussion_stage` 字段，choices 为 `explore`、`frame`、`decide`，默认 `explore`。

* 为 `Topic` 增加 `discussion_context` JSON 字段，默认结构为空对象。其内容仅保存：

  * `confirmed_context`：用户已经确认的背景或目标；

  * `open_questions`：尚未澄清的关键问题；

  * `working_hypotheses`：待验证的假设；

  * `next_focus`：下一步最值得推进的方向。

* 为 `DiscussionMessage` 增加可空的 `suggested_stage` 和 `stage_suggestion_reason`。仅 AI 回复可写入，供前端展示可确认的阶段建议。

* 为 `AITask` 增加 `priority` 整数字段，默认 `0`，并为排队查询建立必要索引。讨论回复使用较高值；其他任务保留默认值。

* 新增 Django migration，为已有 Topic 设置默认探索阶段和空工作记忆，不改写现有讨论记录与任务。

修改 [backend/api/serializers.py](../../backend/api/serializers.py)：

* 在 `TopicSerializer` 返回 `discussion_stage` 和 `discussion_context`，将其设为只读，避免通用 PATCH 绕过阶段切换规则。

* 在 `DiscussionMessageSerializer` 返回阶段建议字段。

* 在 `AITaskSerializer` 返回 `priority`，便于前端区分交互任务的等待状态。

### 2. 将讨论回复改为“阶段驱动 + 结构化工作记忆”

修改 [backend/api/ai\_gateway.py](../../backend/api/ai_gateway.py)：

* 用 `DISCUSSION_PROMPT_VERSION` 或整体 `PROMPT_VERSION` 的新版本标记本次 Prompt 升级。

* 新增内部的结构化讨论回复解析逻辑，要求模型仅返回 JSON：

  * `reply`：面向用户的自然语言回复；

  * `context`：受限的工作记忆对象；

  * `suggested_stage`：`null` 或下一个阶段；

  * `stage_suggestion_reason`：用户可读的简短理由。

* `reply_to_discussion` 接收当前阶段和当前工作记忆。Prompt 按阶段限定行为：

  * `explore`：接住不完整表述，区分已知与猜测，优先推动一个最有价值的下一步，不强迫形成学习决策；

  * `frame`：将探索内容收敛为可检验的问题、约束或选择；

  * `decide`：基于已有对话和材料帮助比较“现在学/暂缓/先补前置知识”等选项。

* 禁止固定标题、固定三段式、连续问题清单和无依据的用户画像。一次最多提出一个明确问题；用户已提出具体问题时先回答，再决定是否追问。

* 仅当工作记忆显示当前阶段已具备进入下一阶段的最小信息时，生成阶段建议。输出异常、缺字段或 JSON 无法解析时抛出清晰错误，走既有 `AITask` 重试；不写入部分状态。

* 删除新建话题时的开场 Prompt 依赖，不删除旧的 `generate_discussion_opening` 与任务处理分支，以保留既有记录重试兼容性。

修改 [backend/api/task\_service.py](../../backend/api/task_service.py)：

* `enqueue_or_reuse` 接收可选 `priority` 和 `model`。显式传入的模型优先于按任务类型的默认模型，并在创建任务时写入 `AITask.model`。

* `_generate_discussion_reply` 读取 Topic 的阶段与工作记忆，调用新的结构化网关方法。

* 在单个数据库事务内更新 `Topic.discussion_context` 并创建 AI `DiscussionMessage`，将阶段建议持久化到消息，同时在 `result_json` 记录消息 ID、阶段和是否生成建议。

* 所有非讨论任务继续使用原有文本生成路径和结果格式。

修改 [backend/api/views.py](../../backend/api/views.py)：

* 新建讨论 Topic 时不再自动入队 `discussion_opening`。

* 发送讨论消息时，以交互优先级入队 `discussion_reply`，并按当前 `discussion_stage` 调用 `AIGateway.get_model_for_discussion_stage(stage)` 选定模型；输入中附带当前阶段、工作记忆、材料摘要与最近对话。

* 新增 `POST /api/topics/{id}/discussion-stage/`，只接受 `stage`：

  * 接受 AI 建议或用户显式选择的 `frame`/`decide`；

  * 允许任意阶段回到 `explore`；

  * 拒绝不支持的值并返回 400；

  * 成功后返回更新后的 `Topic`。

* 保持原有讨论消息、评估、学习路线、转换学习型接口不变。

### 3. 为分阶段模型路由与交互回复设置调度优先级

修改 [.env.example](../../.env.example) 和 [DEV.md](../../DEV.md)：

* 新增以下阶段模型覆盖配置与默认值：

  ```env
  LLM_MODEL_DISCUSSION_EXPLORE=qwen2.5:14b
  LLM_MODEL_DISCUSSION_FRAME=qwen3:30b-a3b
  LLM_MODEL_DISCUSSION_DECIDE=qwen3.6:35b-a3b
  ```

* 增加 `OLLAMA_KEEP_ALIVE=10m` 示例。网关调用时传入该值，使最近使用的模型在短暂空闲时保留；不承诺不同模型同时常驻。

* 说明材料评估和学习路线继续使用 `LLM_MODEL=qwen3.6:35b-a3b`；旧 `discussion_opening` 任务重试仍遵循其原有任务类型配置或默认模型，不迁移旧任务的 `model`。

* 说明修改实际 `.env` 后必须重启 Django 服务；不提交 `.env`。

修改 [backend/api/ai\_gateway.py](../../backend/api/ai_gateway.py)：

* 新增 `get_model_for_discussion_stage(stage)`，读取 `LLM_MODEL_DISCUSSION_{STAGE}`；未配置时回退既有 `LLM_MODEL`，并拒绝未知阶段。

* 在 `OpenAIProvider.generate_response` 中读取 `OLLAMA_KEEP_ALIVE`，仅对 Ollama 请求传递 OpenAI 兼容接口支持的 `extra_body={"keep_alive": ...}`；其他 Provider 保持原行为。

* 保持 `get_model_for_task(task_type)` 用于所有既有非阶段化任务，避免改变评估、路线、阅卷和复习的模型路由。

修改 [backend/api/task\_service.py](../../backend/api/task_service.py) 和 [backend/api/scheduler.py](../../backend/api/scheduler.py)：

* 定义明确的交互优先级常量，仅赋予 `discussion_reply`。优先级来自任务创建代码而非环境变量，避免误配导致后台任务饥饿。

* `claim_due_task` 改为先按 `priority` 降序，再按 `next_run_at, id` 排序。

* 保持单 worker、重试次数与退避策略不变，防止同一台本地模型并发争抢资源。

### 4. 重构讨论页起步与阶段交互

修改 [frontend/src/api/index.ts](../../frontend/src/api/index.ts)：

* 扩展 `Topic`、`DiscussionMessage`、`AITask` 的 TypeScript 类型。

* 新增 `updateDiscussionStage(topicId, stage)` 请求封装；现有消息发送 API 不变。

修改 [frontend/src/hooks/useAITaskPolling.ts](../../frontend/src/hooks/useAITaskPolling.ts)：

* 接收可选 `intervalMs`，默认保留 2000 ms，确保既有页面无行为变化。

修改 [frontend/src/pages/DiscussionTopic/index.tsx](../../frontend/src/pages/DiscussionTopic/index.tsx)：

* 对讨论任务传入 500 ms 轮询间隔，成功后刷新消息和 Topic 工作记忆。

* 当尚无用户消息时显示 3 个可点击引导卡片：表达困惑、从具体例子开始、拆解一个模糊想法。点击后仅填入可编辑的输入草稿，不自动提交。

* 将输入框提示改为接受“一个念头、例子、顾虑或片段”，不再假定用户已有学习动机。

* 在对话区域上方显示当前阶段及简短阶段说明。

* 当最新 AI 消息带有 `suggested_stage` 时，显示理由与“进入下一阶段”按钮；确认后调用新接口并刷新 Topic。提供“继续探索”和“回到探索”操作。

* 将材料评估、学习路线和转换学习型集中为阶段合适的次级操作：探索阶段不主动催促决策，`decide` 阶段再强调这些操作。

* 任务提示区分“正在生成”和“正在等待其他本地任务完成”；不承诺不能保证的生成时延。

### 5. 测试与回归覆盖

修改 [backend/api/tests.py](../../backend/api/tests.py)：

* 覆盖新讨论 Topic 不再创建开场任务，空讨论接口仍可正常返回。

* Mock 结构化讨论回复，断言回复消息、工作记忆、阶段建议和 `AITask.result_json` 被一致持久化。

* 覆盖 JSON 格式错误进入既有失败/重试流程，且不更新 Topic 工作记忆。

* 覆盖阶段接口：接受建议的下一阶段、用户回到探索、非法阶段 400。

* 覆盖三阶段模型配置：探索使用 `LLM_MODEL_DISCUSSION_EXPLORE`，定义问题使用 `LLM_MODEL_DISCUSSION_FRAME`，决策使用 `LLM_MODEL_DISCUSSION_DECIDE`；配置缺失时回退默认模型，未知阶段拒绝入队。

* 覆盖任务在入队时持久化阶段选中的模型，并在模型配置改变后重试时保持原模型。

* 覆盖领取任务时交互回复优先于同一时刻到期的默认优先级任务。

* 保留并调整既有讨论工作流测试，使材料评估、学习路线和转换学习型仍可运行。

前端验证：

* 为讨论页新增的纯函数或可提取的阶段/引导映射添加单元测试（若现有前端测试基础设施可用）。

* 至少执行 TypeScript 构建，确保新 API 类型、组件状态与 Ant Design 交互无编译错误。

## Verification Steps

1. 运行后端格式与静态检查：

   ```bash
   .venv/bin/python -m ruff format --check backend
   .venv/bin/python -m ruff check backend
   ```

2. 确认迁移完整且没有遗漏：

   ```bash
   cd backend && ../.venv/bin/python manage.py makemigrations --check --dry-run
   ```

3. 运行 API 回归测试与 Django 健康检查：

   ```bash
   cd backend && ../.venv/bin/python manage.py test api
   cd backend && ../.venv/bin/python manage.py check
   ```

4. 执行前端构建：

   ```bash
   cd frontend && npm run build
   ```

5. 手工验收：

   * 创建没有明确目标的讨论话题，不出现自动模板开场，能用引导卡片填充并编辑第一条输入。

   * 在探索阶段输入片段式困惑，AI 先回应已有信息且最多追问一个关键问题。

   * AI 建议进入下一阶段时，阶段不在用户确认前改变；确认和回到探索均生效。

   * 排队中同时存在后台任务与讨论回复时，尚未开始的讨论回复先被领取。

   * 三个讨论阶段创建的新回复任务分别持久化 `qwen2.5:14b`、`qwen3:30b-a3b`、`qwen3.6:35b-a3b`；材料评估和学习路线仍使用默认高质量模型。

   * 同一阶段连续发送消息时确认 Ollama 可复用已加载模型；切换到 30B 或 35B 阶段后，系统保持单 worker 且不出现两个大模型并行常驻导致的内存争抢。

   * 讨论任务完成后，界面在最多约 500 ms 的下一次轮询中展示结果；若本地模型已在运行其他任务，界面明确显示等待状态。


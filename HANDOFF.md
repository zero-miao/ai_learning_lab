# AI Learning Lab 交接文档

> 本文是当前工作区的 V2-alpha 交接基线。以代码、迁移、自动化测试及本文为准；旧 V1 文档只保留产品历史参考，不可作为 API 或数据模型契约。
>
> 最近更新：2026-08-07，已纳入统一话题讨论、材料人工采纳、全站主题、持久化系统设置、Provider 模型发现、材料关联管理及讨论 Markdown 的验收结果。

## 1. 项目边界

`ai-learning-lab` 是本地单用户的 AI 辅助学习系统，覆盖材料导入、阅读理解、概念沉淀、掌握度评估、复习安排、本地视频学习和自动补料。

- 保持本地单体架构；不引入 Celery、Redis、消息队列、复杂 Docker Compose 或多用户鉴权。
- 所有长耗时 LLM、ASR、检索和抓取调用必须经持久化 `AITask` 和后台 worker 执行，前端以轮询获取结果。
- 不支持公网部署、HTTPS、云备份、多租户、同步协作或移动端适配。
- 本地 SQLite 是唯一持久化存储；用户自行控制 Django、Ollama、Docker、SearxNG 与 Crawl4AI 的启动和停止。

## 2. 关键文档

接手时按以下顺序阅读：

1. [HANDOFF.md](HANDOFF.md)
2. [docs/development_design_v2_alpha.md](docs/development_design_v2_alpha.md)
3. [docs/product_design_v2_alpha.md](docs/product_design_v2_alpha.md)
4. [docs/local_service_integration.md](docs/local_service_integration.md)
5. [DEV.md](DEV.md)
6. [docs/V1-ALPHA.md](docs/V1-ALPHA.md) 与 [docs/PRD.md](docs/PRD.md)，仅用于产品历史和能力对照
7. [requirements.txt](requirements.txt)、[pyproject.toml](pyproject.toml) 及相关模型、迁移、API、前端页面

V2 实现行为以模型、迁移、测试和本文为准。V1 文档可用于防止产品能力回退，但不得作为数据模型、字段或 API 契约。

## 3. 技术栈与环境

后端采用 Python 3.12、Django 4.2、Django REST Framework、SQLite、APScheduler、Edge TTS 和 OpenAI-compatible SDK；前端采用 React、TypeScript、Vite、Ant Design、Axios 和 Vidstack。

已验证的本机环境：

- Python 3.12.13，虚拟环境为根目录 `.venv`
- Node.js v20.20.2，npm 10.8.2
- 可选本地 Ollama；视频与补料联调额外依赖 ffmpeg、faster-whisper、Docker、SearxNG、Crawl4AI

根目录 `.env` 是实际运行配置，`backend/api/ai_gateway.py` 从项目根目录加载。不要提交 `.env`；模板见 [.env.example](.env.example)。
启动基础设施参数始终读取 `.env`；模型路由、本地服务、补料阈值和界面默认值在首次运行时由 `.env` 初始化到 `SystemConfiguration`，之后通过 `/settings` 持久化管理。

```dotenv
LLM_PROVIDER_TYPE=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3.6:35b-a3b
LLM_MODEL_TOPIC_CHAT=qwen3:30b-a3b
LLM_MODEL_SUPPLEMENT_QUERY=qwen3:30b-a3b
LLM_MODEL_SUPPLEMENT_EVALUATE=qwen3.6:35b-a3b
ASR_MODEL=small
SEARXNG_BASE_URL=http://127.0.0.1:8080
CRAWL4AI_BASE_URL=http://127.0.0.1:11235
SUPPLEMENT_RELEVANCE_THRESHOLD=0.8
```

`LLM_MODEL_<TASK_TYPE>` 可覆盖特定任务的模型；未配置时回退 `LLM_MODEL`。任务入队时会持久化实际模型，重试继续使用该模型。

## 4. 当前基线

项目已完成 V2 ER 硬切换和核心前端迁移，仍处于未提交工作区状态。V2 的原则是：

> 只移除 V1 数据兼容层，不移除既有产品功能。任何恢复或新增 UI 必须直接使用 V2 模型和 API。

当前迁移序列到 `api.0030_systemconfiguration`：

- `0021_v2_core_foundation`
- `0022_migrate_v1_data_to_v2_core`
- `0023_add_video_material_type`
- `0024_prepare_v2_er_cutover`
- `0025_remove_v1_compatibility`
- `0026_aitask_full_context`
- `0027_remove_aitask_input_json_and_more`
- `0028_alter_material_status`
- `0029_unify_topic_and_material_recommendations`
- `0030_systemconfiguration`

切换前的 SQLite 备份为 `backend/db.sqlite3.v2-er-pre-cutover-20260805-001132`，该文件已忽略且不应提交。

## 5. 技术边界

- 后端：Python 3.12、Django 4.2、DRF、SQLite、APScheduler 单 worker。
- 前端：React、TypeScript、Vite、Ant Design、Vidstack。
- 本地 AI：Ollama，经 OpenAI-compatible 接口调用。
- 不引入 Celery、Redis、消息队列、外部数据库、多用户、鉴权、云同步或公网部署。
- 长耗时操作统一经持久化 `AITask` 调度，前端轮询任务状态。

根目录 `.env` 是运行时配置，不得提交；模板见 `.env.example`。

## 6. V2 数据契约

已删除的 V1 表：

- `AIResponse`
- `ConceptAnchor`
- `DiscussionMessage`

V2 核心模型：

| 模型 | 责任 |
| --- | --- |
| `Material` | 全局资料实体，保存内容、媒体属性、状态、摘要及 Chunk。 |
| `TopicMaterial` | Topic 与 Material 的关联语境，保存类别、相关度、导入理由、移除时间。移除只影响当前 Topic。 |
| `MaterialRecommendation` | 补料候选及人工采纳状态；只有采纳后才创建或恢复 TopicMaterial。 |
| `MaterialChunk` | 文字 offset；视频/音频额外有起止时间。 |
| `MaterialTextLocator` | Concept / Highlight / Question 的统一定位器，保存 Topic、Material、Chunk、文本及时间坐标。 |
| `Concept` | Topic 内结构化概念卡片。 |
| `Highlight` | 高亮备注实体；定位完全由 Locator 承载。 |
| `Question` | 基于 Session 的问题卡片与结论。 |
| `Session` / `SessionMessage` | 阅读问答和 Topic 讨论的统一会话模型。 |
| `AITask` | 使用 `trigger_type + trigger_id` 关联业务触发方，结果写入 `result_json`。 |
| `SystemConfiguration` | 单例系统配置，持久化模型路由、本地服务、补料阈值和界面默认值。 |
| `Exam` / `ExamQuestion` / `ReviewRecord` | 掌握度评估与间隔复习。 |

禁止重新增加 V1 兼容字段、旧表或 AITask 的业务外键。前端也不得消费旧字段，例如 `materials`、`anchors`、`ai_responses`、`import_status`、`source_type`。

## 7. 已完成能力

### Topic 与材料

- Topic 统一为学习话题，不再区分学习型和讨论型；支持搜索和级联删除。
- Topic 卡片布局：强制每行 4 个卡片（桌面端），设置 `width: 100%` 确保宽度严格一致，不受内容长短影响；标题与目标超出时省略并支持悬浮查看全文。
- Topic 详情支持网页链接、粘贴文本、本地视频导入；视频上传已收敛到“添加材料”弹窗。
- Topic 标题区支持编辑标题、学习目标和学习范围，保存后立即更新当前详情。

### 阅读、定位与学习产出

- `UniversalReader` 支持文本和 Vidstack 视频阅读。
- 联动与跳转：
    - 支持从“学习产出”跳转至原文：优先按 Locator 精确滚动，视频 seek 到时间点，并对目标条目进行 3 秒临时高亮视觉反馈。
    - **双向联动**：在学习工作区点击条目可“回原文”；点击文中批注可自动弹出工作区并切换到对应 Tab。
    - **重复点击修复**：引入 nonce (时间戳) 机制，确保连续点击同一条目也能触发跳转和高亮。
- 学习工作区：
    - Tab 平铺展示：问答、概念、高亮独立平铺，减少点击层级。
    - 操作图标化：补资料、编辑、删除、回原文等操作统一使用图标并与标题同行显示，最大化内容区域。
    - 深色模式增强：修复了深色背景下摘要文字与选中条目文字的可见性；优化了 Drawer 列表项在深色模式下的 hover (对比度增强) 和 active 状态。
    - **全条目点击**：工作区列表项支持全区域点击触发“回原文”定位，不再局限于图标。
    - **连续学习体验**：阅读页新增粘性工具栏，标题栏常驻展示当前材料的概念、问答和高亮数量并提供学习工作区入口；右下角重复入口已移除。
    - **问答链路修复**：新问题输入与历史对话输入已拆分；AI 回复任务完成后自动刷新当前 Session 并滚动至最新消息。
    - **状态与防误触**：补齐加载骨架、材料不可用状态、工作区空态、材料处理中提示和 AI 任务失败重试；概念、问答和高亮删除前均需二次确认。
- 阅读器体验：
    - 视频区在宽屏双栏下保持 sticky，转录稿滚动时播放器持续可见；窄屏自动恢复普通文档流。
    - 媒体类型统一展示本地化文本；选区菜单自动避让视口边缘；文中标注支持键盘聚焦与回车打开。
    - 取消选区、滚动正文或按下 `Escape` 时，划词操作框会立即收起，不再残留失效菜单。
    - 文本与网页材料在 `briefing` 后自动进入 `edge_tts` AITask，按 `TTS_VOICES` 配置为每个音色生成并缓存 `materials/tts/{material_id}/{voice}.mp3`。正文指纹未变化时复用缓存；至少一个音色成功即可将材料标记为 `ready`，全部失败才重试并最终失败。
    - 前端不再使用 Web Speech API，直接加载 Material API 返回的 `tts_assets`。播放键作为独立主按钮，背景、音色、倍速组成下方设置组；支持播放、暂停、双击停止、音色切换及 `0.5x`～`3x` 九档倍速，并按播放进度同步高亮当前段落。
    - 全站背景支持纯白、暖黄、护眼绿、柔灰、深黑、夜蓝、炭灰、暖黑八种主题并持久化；阅读页与站点共享当前主题，暗色主题同步启用 Ant Design 深色算法。
    - 阅读正文支持系统字体、宋体、楷体、衬线字体四种选择并独立持久化；朗读音色由后端配置并显示简短标签。历史材料可通过 `python backend/manage.py backfill_tts [--force]` 批量排队生成。
    - 文本与网页正文使用 `react-markdown + remark-gfm` 渲染标题、加粗、列表、引用、链接、代码及 GFM 表格；自定义 rehype 插件将渲染节点映射回 Markdown 源码 offset，保留 Locator 划词和回跳契约。
    - 材料前置摘要已统一使用 `react-markdown + remark-gfm`，不再使用逐行正则解析，支持标题、加粗、列表、引用、代码和 GFM 表格。
    - Edge TTS 是在线服务，正文会发送至微软朗读接口；当前实现不提供 Web Speech 回退。音频接口沿用统一媒体服务并支持 `206 Partial Content`。
    - 顶部返回入口明确展示 `返回主题：《主题名》`，长主题名自动单行省略。
- 摘要默认折叠，并通过 `react-markdown + remark-gfm` 完整渲染 GFM。

### 概念、讨论、问答与复习

- 话题详情页提供右侧“学习讨论”抽屉，可随时围绕话题目标、范围、已有材料摘要和最近对话继续交流。
- 学习讨论中的用户和 AI 消息均通过 `react-markdown + remark-gfm` 渲染，支持标题、列表、引用、代码、链接及 GFM 表格。
- 话题对话使用 `qwen3:30b-a3b`，材料评估等分析任务使用 `qwen3.6:35b-a3b`；不再暴露探索/定义问题/决策阶段。
- AI 识别材料缺口后异步生成结构化候选卡片；用户必须点击“采纳”后才会关联材料并启动处理流水线。
- 概念与高亮：支持草稿生成、确认、**在线编辑**与删除。
- 问答系统升级：
    - **多轮对话**：从一问一答升级为基于 Session 的对话流模式。后端已补全 `SessionViewSet` 及路由，支持新消息触发 AI 任务。
    - **历史继承**：支持从问答列表进入历史对话并继续追问。
    - **即问即聊**：新发起的划词问答自动初始化 Session 并进入聊天界面。
- 学习产出页（TopicDetail）展示增强：
    - **三行式布局**：概念（名/定义/原文引用）、问答（问题/原文引用/结论）、高亮（原文/原文引用/备注）均采用清晰的三行结构展示。
    - **原文引用格式**：统一使用引用块样式，并标注“—— 来自《材料名》”。
    - **问答引用文字**：显式展示问题关联的原文选中文字，建立清晰语境。
- 概念图 `/topics/:id/map`：可视化思维导图，移除冗余列表，支持节点/连线交互；点击连线可编辑关系类型或直接删除。
- 掌握度评估 `/topics/:topicId/exam` 支持异步出题、作答、阅卷、查看当前结果和历史评估。
- 复习计划 `/reviews` 支持查看记录、生成复习提示、提交复盘和跳转 Topic。

### SPA 交互优化

- 统一使用 `useNavigate` 进行页面间跳转，消除浏览器刷新，保持单页应用状态连贯性。
- `BrowserRouter` 已提升至入口文件 `main.tsx`。
- **无感进入**：修复了点击“学习”按钮进入阅读器时因 URL 参数解析导致的非预期自动滚动。

### 视频与补料

- 视频上传 API：`POST /api/materials/upload-video/`，支持 `.mp4/.mov/.m4v/.webm/.avi/.mkv` 和可选 `.srt/.vtt`。
- `asr` 任务：字幕优先，`faster-whisper` 为无字幕兜底。
- **无字幕视频已真实跑通**：本机使用 `ffmpeg/ffprobe + faster-whisper` 成功完成约 99 秒 MP4 的 ASR，生成 60 个原始时间片；Hugging Face 模型下载后缓存在本机，不会每次重复下载。
- **视频随机访问**：新增支持单 Range 请求的媒体响应端点，返回 `206 Partial Content`、`Accept-Ranges` 和 `Content-Range`，Chrome 播放器可拖动进度条并执行程序化 seek。
- **清洗后时间轴对齐**：原始 ASR `segments` 持久化在 `media_meta`；`CleanTextTask` 重建 Chunk 时通过单调文本序列对齐，将 AI 合并、纠错后的段落映射回真实 ASR 起止时间，禁止再按段落序号硬配时间戳。
- **视频学习工作台**：
    - 桌面端使用最大 `1480px` 宽屏布局，视频与字幕约按 `3:2` 左右并排；小于 `1000px` 自动回落为上下布局。
    - 字幕根据播放时间自动高亮和滚动，点击字幕使用 Vidstack `remoteControl.seek()` 跳转。
    - 已补齐 Vidstack 默认视频布局 CSS，播放器只展示一套正确定位的控制栏。
    - 字幕时间戳属于展示信息，标注 offset 计算必须忽略 `data-reader-ignore-offset` 节点，否则会产生固定字符偏移。
- 候选补料：Topic、Concept、Question、Highlight 和话题对话均可触发 `supplement_search`；检索结果不会自动入库。
- 话题对话抽屉持续展示补料任务阶段、候选总数、已处理数和推荐数；首个候选出现时仍明确提示任务尚未完成。
- **关联已有材料**：添加材料弹窗新增“已有材料”选项，支持从全局材料库搜索并关联至当前 Topic，后端支持 TopicMaterial 复用逻辑。
- 补料任务阶段与候选过滤原因保存在 `AITask.result_json`。

### 任务与管理

- `/settings` 提供系统设置页面，支持持久化 LLM 服务、各任务模型、Ollama 保活、ASR、TTS、SearxNG、Crawl4AI、补料阈值、全局背景、学习字体和前端请求超时。
- 新任务优先读取数据库系统配置；数据库配置首次由 `.env` 初始化。LLM 地址、密钥或模型保存后会清理 Provider 缓存并立即对新任务生效。
- 设置页通过 Provider 的 OpenAI-compatible Models API 动态读取可用模型；默认模型和所有任务模型均使用可搜索下拉，同时保留手动输入能力。Provider 地址或密钥修改后需重新读取候选列表。

- **AITask 插件化架构**：
    - 引入了基于 `TaskRegistry` 元类的自动注册机制，彻底移除了硬编码的任务分发逻辑。
    - 任务类（如 `CleanTextTask`, `BriefingTask`）独立维护其 `verbose_name`、`run` 方法及 LLM 提示词。
    - `AITask` 模型移除了 `prompt_version`，默认使用类中最新的逻辑版本；`input_json` 重命名为 `task_data`。
- **任务可观测性**：
    - `/tasks` 任务表格优化：支持查看 LLM 完整上下文 (`full_context`)，优化了 JSON 块的视觉样式（去除了黑色背景，增加了行高）。
    - 任务类型展示：前端通过 `task_type_display` 动态展示由 TaskRegistry 定义的中文名称。

### 材料管理与流水线

- **全局材料页重构**：
    - **表格化布局**：从卡片列表改为高效的表格展示，支持行点击展开详情。
    - **处理进度可视化**：行内实时展示“原”（原文）、“清”（清洗）、“摘”（摘要）的就绪状态（对勾/红差）。
    - **朗读音频状态**：音频状态列紧邻处理进度列，按音色展示 Edge TTS 文件的就绪或失败状态，展开详情可再次核对。
    - **话题关联管理**：每行可直接关联已有话题；支持按具体话题筛选，也可单独筛选未关联任何话题的材料。重复关联会恢复此前软删除的 TopicMaterial。
    - **全局删除**：删除材料会取消其运行中任务，并同步删除主媒体、外挂字幕和 `backend/media/materials/tts/{material_id}` 下的朗读文件。
    - **交互增强**：失败状态支持 Tooltip 查看原因；网页链接简化为“原始链接”超链接；关联主题标签支持一键跳转。
- **智能导入流水线**：
    - 实现了“幂等自检”逻辑：触发重新导入时，系统按顺序检查 `Process/ASR` -> `CleanText` -> `Briefing`，若某一环节已有内容则跳过 AI 调用但继续触发下一环。
    - **状态细化**：材料状态与流水线同步，细化为：`pending` (待处理)、`importing` (导入中)、`cleaning` (清洗中)、`summarizing` (摘要中)、`generating_audio` (生成朗读音频)、`ready` (已就绪)、`failed` (失败)。
- **长文本清洗优化**：
    - **分段处理**：`CleanTextTask` 实现了基于自然段落的分段清洗，支持超长文本（无字符上限）。
    - **上下文参考窗口**：在清洗每一段时提供上文（已清洗）和下文（待处理）的参考背景，解决了分段导致的“断章取义”问题，且不产生重复内容。
    - **摘要增强**：`BriefingTask` 输入窗口扩大至 15,000 字符，确保覆盖核心要点。
- **数据流转修正**：网页导入优先生成 `raw_text` (原文)，再由 AI 清洗生成 `clean_text`；`MaterialChunk` 仅基于清洗后的正文生成。
- **视频数据例外**：视频 `raw_text` 同样是原始转录存档，最终 `MaterialChunk` 基于 `clean_text` 生成，但时间坐标必须从 `media_meta.segments` 对齐恢复。

## 8. 当前 API 与任务触发

| 能力 | API | V2 trigger |
| --- | --- | --- |
| 创建文本/网页材料 | `POST /api/materials/` | `Material`（后续 process -> clean_text -> briefing） |
| 上传视频 | `POST /api/materials/upload-video/` | `Material` / `asr` -> clean_text -> briefing |
| 创建概念 | `POST /api/topics/{id}/concepts/` | `Concept` / `concept_draft` |
| 创建高亮 | `POST /api/topics/{id}/highlights/` | 无 AI 任务 |
| 创建问题 | `POST /api/questions/` | `Question` / `answer_question` |
| 查找候选材料 | `POST /api/topics/{id}/supplement/` | Topic / Concept / Question / Highlight |
| 采纳/忽略候选 | `POST /api/material-recommendations/{id}/adopt/`、`dismiss/` | `MaterialRecommendation` |
| Topic 讨论 | `GET/POST /api/topics/{id}/discussion/` | `SessionMessage` / `discussion_reply` |
| 生成评估 | `POST /api/exams/` | `Topic` / `generate_exam` |
| 阅卷 | `POST /api/exams/{id}/submit/` | `Exam` / `grade_exam` |
| 保存评估草稿 | `POST /api/exams/{id}/save/` | 无 AI 任务 |
| 复习提示 | `POST /api/reviews/{id}/prompt/` | `ReviewRecord` / `review_prompt` |
| 复盘提交 | `POST /api/reviews/{id}/submit/` | `ReviewRecord` / `grade_review` |
| 任务查询 / 重试 | `GET /api/ai-tasks/`、`POST /api/ai-tasks/{id}/retry/` | - |
| 系统配置 | `GET/PUT /api/system-configuration/` | 单例 `SystemConfiguration` |
| Provider 模型发现 | `POST /api/system-configuration/models/` | 按当前 Provider 连接参数返回模型 ID |

## 9. 验证基线

标准回归命令：

```bash
.venv/bin/python -m ruff format --check backend
.venv/bin/python -m ruff check backend
(cd backend && ../.venv/bin/python manage.py test api --verbosity 1)
(cd backend && ../.venv/bin/python manage.py check)
(cd backend && ../.venv/bin/python manage.py makemigrations --check --dry-run)
(cd frontend && npm run build)
(cd frontend && npm run lint)
```

- 前端：`npm run build` 已通过；Vidstack 默认视频布局 CSS 已进入产物。
- 学习页体验优化后已再次通过 `npm run build` 与 `npm run lint`；主 bundle 体积告警仍存在。
- 后端：`manage.py check` 通过；媒体 Range、媒体 URL、视频合并段落时间轴对齐 3 项定向测试通过。
- HTTP 实测：带 `Range: bytes=4096-8191` 的媒体请求返回 `206 Partial Content`、正确 `Content-Range` 和 4096 字节响应体。
- Edge TTS 实测：`zh-CN-XiaoxiaoNeural` 可生成 24 kHz、48 kbps 单声道 MP3；Material API 正确返回 `tts_assets`，音频 Range 请求返回 `206 Partial Content`。
- 历史回填已完成：15 个 `edge_tts` 任务全部成功，共生成 30 份 MP3（默认“晓晓、云希”各一份），无失败任务。
- 浏览器实测（Chrome）：
    - 视频播放、进度条拖动正常。
    - 点击字幕可跳转到正确时间。
    - 字幕随播放高亮并滚动。
    - 视频与字幕宽屏双栏正常。
    - 划词“防火”创建概念后，Locator 与高亮均准确落在“防火”。
    - 阅读页可加载后端缓存 MP3，音色菜单展示“晓晓/云希”；切换“云希”后请求对应 MP3，播放按钮正确切换为暂停状态。
    - 夜蓝主题可跨材料管理页、话题详情页和阅读页保持一致；阅读页可切换四种正文字体。
    - 材料页“未关联任何话题”筛选正确；从筛选结果关联话题后成功请求 `POST /api/topic-materials/`，材料立即移出未关联列表。
    - 学习讨论消息中的 Markdown 标题、加粗列表和 GFM 表格正确渲染。
- Edge TTS 新增 3 项定向测试均通过：多音色部分成功、`briefing -> edge_tts` 串联、历史材料回填排队。
- **完整后端回归已通过**：`manage.py test api` 共 24 项测试全部通过，覆盖系统配置持久化、配置校验和 Provider 模型发现；补料测试验证“生成候选 -> 人工采纳 -> 进入清洗流水线”。
- **问答引用修复**：修复了发起问答时无法正确引用选中文字的问题。
- **补料摘要修复**：修复了 AI 推荐材料导入后未自动触发摘要（briefing）任务的问题。
- `git diff --check` 通过。
- Vite 仍报告主 bundle 超过 500 kB，尚未做代码分割。

## 10. 外部服务联调

已验证的本机服务状态：

1. **ASR (faster-whisper)**: ✅ 已安装并完成无字幕视频真实转录。首次运行会从 Hugging Face 下载模型，后续使用本机缓存；未设置 `HF_TOKEN` 只影响下载限速，不影响运行。
2. **LLM (Ollama)**: ✅ `qwen3.6:35b-a3b` 模型已就绪并可响应。
3. **Search (SearxNG)**: ✅ Docker 容器运行中，且已配置支持 JSON 格式输出。
4. **Crawl (Crawl4AI)**: ⚠️ Docker 镜像在 M1/M2 架构上存在 `SIGILL` 兼容性问题。系统已配置自动回退至本地原生的 **trafilatura** 抓取引擎，无需启动该容器。

已完成真实验收：

1. `ffmpeg/ffprobe + faster-whisper` 无字幕视频转录。
2. Chrome 视频播放、Range seek、进度条拖动、字幕同步及点击跳转。
3. 视频清洗段落与原始 ASR 时间轴重新对齐。
4. 视频字幕划词标注与 Locator offset 一致性。
5. 统一话题详情、右侧学习讨论抽屉、`qwen3:30b-a3b` 实际回复和材料候选卡片展示。

仍待真实验收：

1. 外挂 `.srt/.vtt` 字幕优先路径。
2. 思维导图拖拽与关系编辑。
3. 历史考试结果、评估草稿和复习任务进度。

## 11. 接手优先级

1. 完成外挂字幕、思维导图、历史考试结果、评估草稿和复习进度的浏览器验收。
2. 继续补齐此前简化页面恢复中的细节，尤其是评估草稿状态、复习任务进度和 Topic 学习产出治理。
3. 为关键 V2 用户路径补端到端测试，至少覆盖视频导入 -> ASR -> 清洗 -> 字幕 seek -> 划词 Locator。
4. 之后再处理前端代码分割和 bundle 体积告警（当前主 bundle 约 1.75 MB，gzip 约 549 kB）。

## 12. 接手规则

1. 不覆盖当前工作区未提交变更。
2. 先读本文件、`docs/development_design_v2_alpha.md` 和 `docs/local_service_integration.md`。
3. V2 ER 升级不等于功能下线；保留已有产品能力，并直接适配 V2 模型。
4. 所有异步能力必须有持久化任务、错误状态、重试路径和前端可观测性。
5. 修改 Locator、视频或阅读器时，验证文本滚动与视频时间回跳。
6. 视频媒体响应必须保留 HTTP Range 支持；不要退回 Django 默认 `static()` 媒体响应。
7. 视频清洗后不得按段落序号恢复时间戳，必须依据原始 ASR segments 做单调文本对齐。
8. 阅读器中的时间戳、按钮等展示节点必须标记为不参与正文 offset，避免污染 Locator。

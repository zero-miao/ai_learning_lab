# AI Learning Lab 交接文档

> 本文只记录长期有效的产品/工程决策、V2-alpha 整体进度和不易复现的验收结论。API、迁移、分支和具体实现以代码与 Git 为准。

## 1. V1 与 V2 的关系

V2 不是独立新产品，也不是 V1 的缩减版重写，而是同一产品的数据模型和实现架构升级。

- V1 已跑通“导入 -> 阅读理解 -> 概念/高亮/问答 -> 评估 -> 复习”的完整学习闭环；V2 在继承该闭环的基础上增加视频学习、自动补料和统一的数据模型。
- V1 已有能力默认必须保留。V2 文档未提及某项 V1 能力，不代表该能力被移除；只有明确记录的产品决策才能下线功能。
- V1 文档用于确认历史产品能力和设计意图，不作为当前 API、字段或数据模型契约。
- V2 的实现契约以当前模型、迁移、测试和代码为准。V1 兼容表、兼容字段和旧 API 可以删除，但不能以迁移为理由造成功能退化。
- 新增或恢复 UI 必须直接使用 V2 模型和 API，不重新引入 V1 兼容层。

相关文档：

- [docs/V1-ALPHA.md](docs/V1-ALPHA.md)、[docs/PRD.md](docs/PRD.md)：V1 能力与产品历史
- [docs/product_design_v2_alpha.md](docs/product_design_v2_alpha.md)：V2-alpha 产品范围
- [docs/development_design_v2_alpha.md](docs/development_design_v2_alpha.md)：V2-alpha 工程设计
- [docs/local_service_integration.md](docs/local_service_integration.md)：本地服务联调
- [DEV.md](DEV.md)：开发与启动说明

## 2. 产品与架构边界

`ai-learning-lab` 是本地单用户的 AI 辅助学习系统，覆盖材料导入、阅读理解、知识沉淀、掌握度评估、间隔复习、本地视频学习和自动补料。

- 保持本地单体架构和 SQLite 持久化，不引入多用户鉴权、Celery、Redis、消息队列或复杂 Docker 编排。
- 不以公网部署、移动端、云备份、同步协作为目标。
- 长耗时 LLM、ASR、TTS、检索和抓取必须通过持久化 `AITask` 与单 worker 异步执行；前端必须展示排队、执行、失败状态并提供重试。
- `AITask` 通过 `trigger_type + trigger_id` 关联业务对象。任务类由 `TaskRegistry` 元类自动注册，任务逻辑、提示词和显示名称内聚在任务类中，不维护硬编码分发表。
- 环境变量只负责基础设施参数和系统配置首次初始化。运行期模型路由、本地服务地址、补料阈值和界面默认值由单例 `SystemConfiguration` 管理。
- 任务入队时固化实际模型；重试继续使用原模型。所有环境默认项必须在 `.env.example` 中完整声明并附中文说明。
- LLM 通过 OpenAI-compatible 接口接入，必须支持本地 Ollama。当前模型只是可变配置，不写入 handoff 作为固定契约。

## 3. V2 核心契约

### 数据归属

| 模型 | 稳定责任 |
| --- | --- |
| `Material` | 全局资料实体，保存原文、清洗正文、媒体信息、摘要和处理状态。 |
| `TopicMaterial` | Topic 与 Material 的关联语境，保存分类、相关度、导入理由和软删除状态。 |
| `MaterialRecommendation` | 自动补料候选及人工采纳状态。候选不会直接成为 Topic 材料。 |
| `MaterialChunk` | 正文 offset；视频/音频额外保存真实时间区间。 |
| `MaterialTextLocator` | Concept、Highlight、Question 共用的原文定位器，同时承载文字和媒体时间坐标。 |
| `Session` / `SessionMessage` | 阅读问答和 Topic 讨论的统一多轮会话。 |
| `Exam` / `ExamQuestion` / `ReviewRecord` | 掌握度评估和间隔复习闭环。 |
| `AITask` | 所有异步任务的持久化状态、输入、完整上下文、结果和错误。 |
| `SystemConfiguration` | 可持久化修改的运行期系统配置。 |

V2 已移除 `AIResponse`、`ConceptAnchor`、`DiscussionMessage`。禁止重新增加这些表、V1 兼容字段、`AITask` 业务外键，或让前端重新消费 `materials`、`anchors`、`ai_responses`、`import_status`、`source_type` 等旧契约。

### 材料与补料

- Material 是可跨 Topic 复用的全局实体。解除 TopicMaterial 只移除当前 Topic 的关联；删除 Topic 不得删除共享 Material 或实体文件。
- 全局删除 Material 必须取消其运行中任务，并清理主媒体、外挂字幕和 TTS 文件。
- 自动补料只生成 `MaterialRecommendation`。用户人工采纳后才能创建/恢复 TopicMaterial 并启动材料处理流水线。
- 材料流水线按原文获取/ASR -> 清洗 -> 摘要 -> TTS 顺序推进，并支持幂等续跑。
- 长文本清洗必须按自然段分段，并向每段提供已清洗上文和待处理下文，不能通过截断规避上下文长度。
- `raw_text` 保存原始文本或转录，`clean_text` 保存 AI 清洗后的正文；MaterialChunk 只基于 `clean_text` 创建。

### Locator 与媒体

- 文本、网页和视频共用 MaterialTextLocator。概念、高亮、问题不得各自维护另一套定位字段。
- 视频 Chunk 的时间坐标必须依据原始字幕/ASR segments 与清洗正文做单调文本对齐；禁止按清洗后的段落序号硬配时间戳。
- 阅读器中的时间戳、按钮等展示节点必须标记为不参与正文 offset，避免污染划词定位。
- 视频和 TTS 媒体响应必须保留 HTTP Range 支持。
- 标注跳转遵循同一规则：有时间坐标则 seek，无时间坐标则按正文 offset 滚动。

### 前端与阅读体验

- 页面必须简洁高效，学习页面优先保障连续阅读：减少重复入口和无意义层级，把主要空间留给正文与学习内容，同时保证关键操作在长页面中始终容易触达。
- 前端文案必须使用清晰的本地化描述，不直接展示内部状态 Key。长文本应控制行宽、段落间距和换行，正文行高原则上不低于 `1.6`，避免拥挤或过度稀疏。
- AI 输出、摘要、讨论、问答和复习提示统一按 Markdown/GFM 渲染，完整支持标题、列表、引用、链接、代码和表格；Markdown 容器不得使用 `white-space: pre-wrap` 破坏排版。
- 阅读字体由用户选择并持久化，正文、字幕和阅读型内容应一致继承当前字体；代码等具有明确语义的内容除外，不得在局部组件中随意写死字体。
- 背景颜色和文字颜色必须跟随全站主题。浅色主题不得用大面积深色背景承载长文本或代码上下文；深色主题必须使用 Ant Design token 或主题相关颜色保证对比度和可读性。

### 删除与可观测性

- Topic 删除必须清理其独占 Session、SessionMessage 和关联 AITask，但不得误删共享 Material。
- 所有异步用户路径必须具备持久化任务、刷新后状态恢复、可读错误和页面内重试。

## 4. V2-alpha 进度

### 已完成

- 完成 V2 ER 硬切换，移除 V1 数据兼容层，并保留 V1 完整学习闭环。
- Topic 统一为学习话题；支持编辑目标/范围、搜索、删除、右侧学习讨论和材料管理。
- Material 全局化；支持网页、粘贴文本、本地视频、已有材料复用、Topic 关联治理和全局彻底删除。
- 文本与视频统一进入阅读器；支持字幕同步、点击 seek、划词创建概念/高亮/问答、双向回跳和重复定位。
- 阅读问答支持基于 Session 的多轮对话、最近历史、Locator 选中文字和材料正文上下文；刷新后可恢复回复任务。
- 概念、高亮支持生成、确认、编辑、删除；概念图支持关系创建、编辑和删除。
- Topic 讨论支持 Markdown/GFM，并能识别材料缺口、生成结构化补料候选。
- 自动补料支持 Topic、Concept、Question、Highlight 和讨论触发；候选必须人工采纳后才进入材料流水线。
- 视频支持外挂字幕优先、faster-whisper 兜底、真实时间轴对齐、HTTP Range 播放和字幕标注。
- 文本/网页支持 Edge TTS 多音色缓存、Range 播放、倍速、播放段落高亮和历史材料回填。
- 全站主题、阅读字体、LLM/任务模型、本地服务和超时等配置已持久化到设置页；支持 Provider 模型发现。
- 全局材料页已表格化，展示原文/清洗/摘要/TTS 状态，并支持 Topic 筛选与关联。
- 掌握度评估支持异步出题、草稿保存、提交阅卷、任务恢复/重试、历史结果和逐题反馈。
- 复习计划支持异步提示、复盘评分、任务恢复/重试、反馈和下一次复习安排。
- 任务管理页支持状态/类型筛选、完整上下文查看和失败任务重试。

### 已实现但仍待真实验收

- 外挂 `.srt/.vtt` 字幕优先处理已覆盖上传测试，仍缺真实视频与字幕的浏览器验收。
- 思维导图拖拽建关系、关系编辑和删除仍缺浏览器交互验收。
- 评估历史结果及评估/复习任务反馈仍缺完整浏览器验收。

### 尚未完成

1. 阅读页在“当前 Topic 标注 / 全部标注”之间切换。
2. 将视频学习标记绘制到播放器进度条；当前只有播放器下方的可点击标记列表。
3. 建立关键 V2 用户路径的端到端自动化测试，至少覆盖视频导入 -> ASR -> 清洗 -> 字幕 seek -> 划词 Locator。
4. 前端代码分割；当前主 bundle 约 1.79 MB，gzip 约 560 kB。

后续优先完成跨 Topic 标注和待验收交互，再建设端到端测试与播放器标记，最后处理 bundle 体积。

## 5. 验证证据

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

当前自动化基线：

- 后端 `manage.py test api` 共 26 项通过，覆盖系统配置、Provider 模型发现、多轮问答、Topic 删除、补料人工采纳、TTS 和视频时间轴等关键契约。
- `ruff check backend`、`manage.py check`、`makemigrations --check --dry-run`、前端 build/lint 均通过。
- `ruff format --check backend` 仍会报告两份历史迁移文件需要格式化，不属于当前业务代码问题。
- Vite 仍报告主 bundle 超过 500 kB。

已完成且复现成本较高的真实验收：

- `ffmpeg/ffprobe + faster-whisper` 成功处理约 99 秒无字幕 MP4，生成 60 个原始时间片。
- Chrome 中视频播放、Range seek、进度条拖动、字幕同步、点击字幕跳转和宽屏双栏均正常。
- 视频清洗段落可重新对齐原始 ASR 时间轴；字幕划词创建 Locator 后文字 offset 与视频时间均正确。
- 带 `Range: bytes=4096-8191` 的媒体请求返回 `206`、正确 `Content-Range` 和 4096 字节响应体。
- Edge TTS `zh-CN-XiaoxiaoNeural` 可生成 24 kHz、48 kbps 单声道 MP3；音频 Range 请求和前端音色切换正常。
- 历史回填 15 个 TTS 任务全部成功，共生成 30 份 MP3。
- 夜蓝主题可跨材料页、Topic 页和阅读页保持一致，四种阅读字体可切换。
- “未关联任何话题”筛选与已有材料关联闭环已在浏览器验证。
- Topic 讨论的真实 Ollama 回复、Markdown/GFM 展示和补料候选卡片已验证。

本机服务结论：

- Ollama、faster-whisper 和 SearxNG 已真实跑通。
- Crawl4AI Docker 镜像在 Apple Silicon 上存在 `SIGILL` 兼容问题；系统已决定自动回退到原生 `trafilatura`，不依赖该容器才能完成补料。
- Edge TTS 是在线服务，正文会发送给微软朗读接口；当前不提供 Web Speech 回退。

## 6. 接手守则

1. 不覆盖或回退工作区中来源不明的未提交变更。
2. 判断功能是否可删除时，先对照 V1 能力；V2 迁移本身不是下线理由。
3. 修改 Locator、阅读器或视频链路时，同时验证文本滚动、视频 seek 和 offset 一致性。
4. 修改异步功能时，同时补齐状态恢复、失败反馈和重试路径。
5. 修改材料或 Topic 删除逻辑时，检查共享 Material、文件和关联任务的清理边界。
6. 交付前执行标准回归；涉及视频、Locator、TTS 或浏览器交互时补做对应真实验收。

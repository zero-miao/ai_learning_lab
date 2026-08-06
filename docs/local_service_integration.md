# V2-alpha 本机服务联调手册

本手册用于验证 V2-alpha 的两条依赖本机服务的链路：

- 视频：`ffprobe` + `faster-whisper`
- 自动补料：Ollama + SearxNG + Crawl4AI

应用本身使用 SQLite，不需要外部数据库。Django 开发服务启动后会同时启动单线程 `AITask` 调度器。

## 1. 前置条件

需要以下工具：

```bash
brew install ffmpeg
brew install ollama
brew install --cask docker
```

确认视频工具可用：

```bash
ffprobe -version
ffmpeg -version
```

确认 Docker Desktop 已运行：

```bash
docker info
```

## 2. Python 与前端依赖

在项目根目录执行：

```bash
.venv/bin/pip install -r requirements.txt
cd frontend
npm install
cd ..
```

确认 ASR 依赖：

```bash
.venv/bin/python -c "import faster_whisper; print(faster_whisper.__version__)"
```

首次运行 `faster-whisper` 会下载指定模型。开发环境建议先在 `.env` 使用：

```dotenv
ASR_MODEL=small
```

## 3. Ollama

启动 Ollama 服务：

```bash
ollama serve
```

在另一个终端拉取并检查模型。模型名必须和根目录 `.env` 的 `LLM_MODEL` 一致：

```bash
ollama pull qwen3.6:35b-a3b
ollama list
curl http://127.0.0.1:11434/api/tags
```

建议 `.env` 配置：

```dotenv
LLM_PROVIDER_TYPE=ollama
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3.6:35b-a3b
```

## 4. SearxNG

创建本地配置目录：

```bash
mkdir -p ~/.ai-learning-lab/searxng
```

启动 SearxNG：

```bash
docker run --rm --name ai-learning-searxng \
  -p 127.0.0.1:8080:8080 \
  -v ~/.ai-learning-lab/searxng:/etc/searxng \
  searxng/searxng:latest
```

确认 JSON 搜索可用：

```bash
curl "http://127.0.0.1:8080/search?q=Django+ORM&format=json"
```

若返回 HTML、403 或没有 `results`，检查 SearxNG 的 `settings.yml` 是否允许 JSON 格式和外部搜索引擎访问。

## 5. Crawl4AI

启动 Crawl4AI 服务：

```bash
docker run --rm --name ai-learning-crawl4ai \
  -p 127.0.0.1:11235:11235 \
  unclecode/crawl4ai:latest
```

本项目的补料服务会向 `POST /crawl` 发送：

```json
{"urls":["https://example.com"]}
```

确认镜像版本提供该接口：

```bash
curl -X POST http://127.0.0.1:11235/crawl \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com"]}'
```

如果所用 Crawl4AI 镜像的 API 路径或请求格式不同，调整 `backend/api/supplement_service.py` 的 `crawl()`，保持其输出为正文文本。Crawl4AI 不可用时，当前实现会回退到 `trafilatura` 抓取。

## 6. 环境变量

根目录 `.env` 至少包含：

```dotenv
DJANGO_SECRET_KEY=local-development-secret
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
DJANGO_DATABASE_PATH=backend/db.sqlite3
DJANGO_MEDIA_ROOT=backend/media

LLM_PROVIDER_TYPE=ollama
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3.6:35b-a3b

ASR_MODEL=small
SEARXNG_BASE_URL=http://127.0.0.1:8080
CRAWL4AI_BASE_URL=http://127.0.0.1:11235
SUPPLEMENT_RELEVANCE_THRESHOLD=0.8
```

## 7. 启动应用

后端：

```bash
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py runserver 127.0.0.1:8000
```

前端：

```bash
cd frontend
npm run dev
```

检查后端：

```bash
curl http://127.0.0.1:8000/api/health/
```

预期：

```json
{"status":"ok"}
```

## 8. 视频验收

1. 新建学习主题。
2. 导入带 `.srt` 或 `.vtt` 的本地视频。
3. 等待 `asr` 任务结束，确认材料状态为“可学习”。
4. 打开材料页，确认播放器、转录稿和时间同步可用。
5. 在转录稿选择文字创建概念、高亮或问答，确认标记点与视频回跳正确。
6. 再导入无字幕视频，确认 `faster-whisper` 生成转录稿。

失败排查：

- `未找到 ffprobe`：重新安装 ffmpeg，并确认 shell 中 `ffprobe -version` 可用。
- `未安装 faster-whisper`：重新执行 `.venv/bin/pip install -r requirements.txt`。
- 模型下载失败或过慢：检查网络、磁盘空间，并暂时使用较小的 `ASR_MODEL`。

## 9. 自动补料验收

1. 创建一个具有明确标题和学习目标的主题。
2. 点击主题页“自动补料”。
3. 等待 `supplement_search` 任务完成。
4. 确认新增材料标记为“AI 新增”，显示相关度、推荐理由和分类。
5. 修改分类，再移除材料，确认仅从当前主题移除。
6. 从概念、问答、高亮的“补资料”入口再触发一次，确认触发方可追溯。

任务成功但导入数为零时，查看任务 `result_json`：

- `candidates[].reason = 相关度低于阈值`：候选被阈值过滤。
- `正文过短`：抓取结果不满足最小正文长度。
- `抓取失败或正文为空`：检查 Crawl4AI 或目标网页可访问性。

## 10. 验证命令

```bash
.venv/bin/python -m ruff check backend
cd backend && ../.venv/bin/python manage.py test api
cd ../frontend && npm run build
```

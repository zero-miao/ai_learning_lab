# AI Learning Lab 开发环境文档

## 项目定位

AI Learning Lab 是一个本地部署的 AI 辅助学习系统项目。本文档仅记录项目开发相关的环境要求、依赖列表、本地环境现状和初始化步骤，后续开发本系统时以本文档作为环境基线。

## 项目目录

```text
/Users/meiao/ai_workspace/ai-learning-lab
```

## 技术栈

- 后端：Python + Django + Django REST Framework
- 前端：React + TypeScript + Vite + Ant Design
- 数据库：SQLite
- 部署形态：本地开发与本地运行

## 环境要求

### 后端环境

- Python：3.12.x
- Django：4.x
- Django REST Framework：与 Django 4.x 兼容版本
- SQLite：使用 Python 标准库内置 sqlite3，必要时依赖系统 SQLite

### 前端环境

- Node.js：20 LTS
- npm：随 Node.js 20 LTS 安装的稳定版本
- Vite：当前稳定版本
- React：当前稳定版本
- TypeScript：当前稳定版本
- Ant Design：当前稳定版本

### LLM 环境 (本地)

项目支持使用本地 Ollama 作为 LLM Provider，以实现完全的本地化运行：

- **工具**：[Ollama](https://ollama.com/)
- **接口**：兼容 OpenAI API (默认 `http://localhost:11434/v1`)
- **正式聊天模型**：`qwen3.6:35b-a3b`
- **快速模型**：`qwen3:30b-a3b`
- **Embedding 模型**：`nomic-embed-text:latest`

## 当前本地环境现状

以下信息来自 2026-08-01 对本机环境的检查：

```text
操作系统：macOS arm64
Python：3.12.13 (in .venv)
Node.js：v20.20.2
npm：10.8.2
Docker：24.0.2
```

## 项目结构

```text
ai-learning-lab/
├── backend/            # Django 后端项目
│   ├── manage.py
│   ├── config/         # 项目配置
│   └── api/            # API 应用（含健康检查）
├── frontend/           # React 前端项目
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── .venv/              # Python 虚拟环境
├── DEV.md              # 开发文档
├── HANDOFF.md          # 交接文档
└── requirements.txt    # 后端依赖
```

## 环境变量

项目根目录提供两个环境变量文件：

- `.env`：本机正式运行使用的环境变量文件，包含真实运行值；已加入 `.gitignore`，不应提交到 Git。
- `.env.example`：环境变量模板，用于说明需要配置哪些变量，可提交到 Git 作为参考。

当前 `.env` 默认使用本地 Ollama，核心配置如下：

| 变量名 | 用途 | 当前正式值 / 示例 |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Django 加密签名密钥，本机运行必需 | 使用当前项目生成的本地密钥 |
| `DJANGO_DEBUG` | 是否启用 Django Debug 模式 | `True` |
| `DJANGO_ALLOWED_HOSTS` | Django 允许访问的 Host，逗号分隔 | `127.0.0.1,localhost` |
| `DJANGO_DATABASE_PATH` | SQLite 数据库文件路径 | `backend/db.sqlite3` |
| `LLM_PROVIDER_TYPE` | LLM Provider 类型 | `ollama` |
| `LLM_BASE_URL` | Ollama OpenAI 兼容接口地址 | `http://localhost:11434/v1` |
| `LLM_API_KEY` | OpenAI SDK 兼容要求使用的 API Key，本地 Ollama 可填固定值 | `ollama` |
| `LLM_MODEL` | 当前后端默认调用模型 | `qwen3.6:35b-a3b` |
| `LLM_MODEL_<TASK_TYPE>` | 指定 AI 任务类型的模型，未设置时回退 `LLM_MODEL` | `LLM_MODEL_CONCEPT_DRAFT=qwen3.6:35b-a3b` |
| `LLM_MODEL_DISCUSSION_<STAGE>` | 按讨论阶段选择模型 | `EXPLORE=qwen2.5:14b`、`FRAME=qwen3:30b-a3b`、`DECIDE=qwen3.6:35b-a3b` |
| `OLLAMA_KEEP_ALIVE` | Ollama 模型空闲保留时间 | `10m` |
| `OLLAMA_CHAT_MODEL` | 正式聊天模型 | `qwen3.6:35b-a3b` |
| `OLLAMA_FAST_MODEL` | 快速任务模型 | `qwen3:30b-a3b` |
| `OLLAMA_EMBED_MODEL` | Embedding 模型 | `nomic-embed-text:latest` |

如需重新生成本机环境配置，可复制模板后按需修改：

```bash
cp .env.example .env
```

`<TASK_TYPE>` 使用任务类型的大写名称，例如 `briefing` 对应
`LLM_MODEL_BRIEFING`，`answer_question` 对应 `LLM_MODEL_ANSWER_QUESTION`。
完整可配置任务类型见 `.env.example`；任务入队时会将实际选用模型写入 `AITask`，后续重试继续使用同一模型。
讨论型话题按 `explore`、`frame`、`decide` 阶段路由模型；48 GB 统一内存下保持单 worker，不要让多个大模型长期同时驻留。修改 `.env` 后需重启 Django 服务。

## 本地启动步骤

### 1. 启动后端

```bash
cd backend
source ../.venv/bin/activate
python manage.py runserver 127.0.0.1:8000
```

后端健康检查接口：`http://127.0.0.1:8000/api/health/`

### 2. 启动前端

```bash
cd frontend
npm run dev
```

前端访问地址：`http://localhost:5173/`

### 3. LLM 配置

AI 功能默认读取项目根目录 `.env`，当前正式配置已指向本地 Ollama。启动后端前请确认 Ollama 服务已运行，并已拉取 `.env` 中声明的模型。

## 依赖列表

### 后端依赖

```text
Python 3.12.x
Django 4.x
djangorestframework
```

后端依赖统一固化在项目根目录 `requirements.txt`，本地安装时执行 `pip install -r requirements.txt`。

### 前端依赖

```text
Node.js 20 LTS
npm
react
react-dom
typescript
vite
antd
```

建议后续在项目前端目录中使用 `package.json` 和 lockfile 固化实际版本。

## 环境初始化步骤

### 1. 进入项目目录

```bash
cd /Users/meiao/ai_workspace/ai-learning-lab
```

### 2. 安装或更新 pyenv

```bash
brew update
brew install pyenv
```

如果已经安装 pyenv，可使用：

```bash
brew upgrade pyenv
```

### 3. 安装 Python 3.12

```bash
pyenv install 3.12
pyenv local 3.12
python --version
```

期望输出为 Python 3.12.x。

### 4. 创建后端虚拟环境

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 5. 安装或配置 nvm

```bash
brew install nvm
mkdir -p ~/.nvm
```

根据本机 shell 类型，将以下内容加入 `~/.zshrc` 或对应 shell 配置文件：

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$(brew --prefix nvm)/nvm.sh" ] && \. "$(brew --prefix nvm)/nvm.sh"
[ -s "$(brew --prefix nvm)/etc/bash_completion.d/nvm" ] && \. "$(brew --prefix nvm)/etc/bash_completion.d/nvm"
```

重新加载 shell 配置：

```bash
source ~/.zshrc
```

### 6. 安装 Node.js 20 LTS

```bash
nvm install 20
nvm use 20
nvm alias default 20
node --version
npm --version
```

期望 Node.js 输出为 v20.x，npm 能正常输出版本号。

### 7. 初始化前端依赖

项目创建前端工程时建议使用 Vite：

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install antd
```

### 8. 开发环境基线确认

正式开始开发前，确认以下命令均可正常执行：

```bash
python --version
pip --version
node --version
npm --version
docker --version
```

期望结果：

```text
Python 3.12.x
Node.js v20.x
npm 正常可用
Docker 24.0.2 或更高版本可用
```

## 后续开发约定

- 后续开发本系统时，以本文档记录的 Python 3.12、Node.js 20 LTS、本地 SQLite 作为默认环境基线。
- 不再基于当前旧版 Python 3.6.10 和 Node.js v10.16.3 开发。
- 新增后端依赖后，必须同步固化到项目根目录 `requirements.txt`。
- 新增前端依赖后，必须同步固化到 `package.json` 和 lockfile。
- 后端 Python 代码必须遵循 PEP 8：使用 4 个空格缩进、模块和函数使用 `snake_case`、类使用 `PascalCase`，并避免未使用的导入与行尾空白。项目统一采用 Ruff/Black 兼容的 88 字符行宽。
- 后端统一使用 Ruff 格式化与检查；提交前在项目根目录执行：

  ```bash
  .venv/bin/python -m ruff format --check backend
  .venv/bin/python -m ruff check backend
  ```

  需要自动修复格式时执行：

  ```bash
  .venv/bin/python -m ruff format backend
  .venv/bin/python -m ruff check --fix backend
  ```

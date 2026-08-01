---
name: ai-learning-lab-handoff
description: 读取并理解 ai-learning-lab 项目交接上下文、开发环境基线与本地个人工具边界。适用于在 Trae 中接手本项目、搭建 MVP 骨架、修改代码、规划技术方案、初始化 Django/React/Vite/Ant Design 工程、确认开发环境或避免过度工程化时使用。
author: meiao.zero
---

# AI Learning Lab 项目接手指南

在 `ai-learning-lab` 项目内执行任何开发、规划、重构、环境配置或问题排查前，先读取项目根目录的：

1. `HANDOFF.md`
2. `DEV.md`
3. `docs/PRD.md`
4. `docs/TECH.md`
5. `requirements.txt`（涉及后端依赖时）

这些文件是当前项目的事实基线。若文档与猜测、通用最佳实践冲突，以项目文档为准；若文档之间存在冲突，先向用户澄清，不要擅自假设。

## 项目定位

`ai-learning-lab` 是本地个人使用的 AI 辅助学习系统。核心目标是帮助用户完成学习计划、学习记录、复盘、掌握状态判断，以及基于 AI 的学习闭环编排。

关键边界：

- 本地 Web 站点
- 仅个人电脑使用
- 不考虑公网部署
- 不考虑多用户
- 不考虑鉴权体系
- 不考虑 HTTPS
- 不考虑云备份

因此，不要按企业级 SaaS、公网平台或多租户系统过度设计。

## 技术栈基线

后端：

- Python 3.12
- Django 4.x
- Django REST Framework
- SQLite

前端：

- React
- TypeScript
- Vite
- Ant Design

存储：

- SQLite

除非用户明确要求，不要切换到 MySQL、PostgreSQL、复杂消息队列、分布式任务系统、K8s、复杂 Docker Compose、多租户、RBAC、OAuth/SSO 等方案。

## 当前阶段

项目当前处于 MVP 骨架搭建前阶段。优先目标是完成“能启动、能访问、前后端能连通”的最小闭环，而不是一开始实现完整业务功能。

建议优先顺序：

1. 初始化 Django 后端项目。
2. 接入 Django REST Framework。
3. 使用 SQLite 作为默认数据库。
4. 初始化 React + TypeScript + Vite 前端项目。
5. 接入 Ant Design。
6. 建立前后端目录结构与本地启动说明。
7. 提供最小可运行页面和健康检查接口。

## 开发原则

- 修改前先确认当前文件状态，避免覆盖用户已有改动。
- 技术方案先讲清楚再开发；不确定时先澄清。
- 优先复用成熟三方库，不重复造轮子。
- 把复杂度集中在学习闭环编排、AI Prompt 编排、AI 结果校验、掌握状态判断等核心能力上。
- 开发交付前运行必要校验，并说明验证结果。
- 新增后端依赖后，同步更新根目录 `requirements.txt`。
- 新增前端依赖后，同步更新 `package.json` 和 lockfile。

## 本地环境注意事项

以 `DEV.md` 为准确认 Python、Node.js、npm、Docker 等版本。正式开发前需要满足：

- Python 3.12.x
- Node.js v20.x
- npm 正常可用
- SQLite 使用本地默认能力即可

不要基于旧版 Python 3.6.10 或 Node.js v10.16.3 开发。

## 用户协作偏好

- 默认使用简体中文。
- 回复简洁、高信号，先给结论。
- 不确定时先澄清，不擅自假设。
- 开发任务完成后先自验，再汇报结果。

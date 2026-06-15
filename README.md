# ResumeFLOW

ResumeFLOW 是一个面向求职材料管理的 AI 简历工作台。它把简历版本、经历库、JD 匹配分析、AI 助手、PDF 导出和账户管理放在同一个工作流里，适合用来沉淀个人经历资产，并针对不同岗位快速生成和优化简历。

## 功能概览

- 简历仪表盘：管理多份简历、切换目标岗位、维护草稿和定稿状态。
- 简历编辑器：编辑个人信息、教育背景、工作/项目经历、技能和证书。
- 经历库：集中维护可复用的经历素材，并支持经历摘要生成和简历上传导入。
- AI 助手：支持简历内容补全、JD 分析、经历润色、草稿卡片应用和上下文跳转。
- PDF 导出：前后端配合生成简历 PDF 和经历库 PDF。
- 账户与反馈：集成 Logto 鉴权、账户管理、反馈收集和基础访问分析。

## 技术栈

- 前端：Vite、React、TypeScript、Lucide React
- 后端：FastAPI、SQLModel、PostgreSQL、asyncpg、Playwright
- 鉴权：Logto
- AI：兼容 OpenAI 风格接口的 `AI_*` 配置，并保留 Gemini 兼容配置
- 独立子应用：`magic-resume-inspect/` 是单独的 Next.js 工作区

## 仓库结构

```text
.
├── App.tsx                     # 前端应用入口
├── components/                 # 通用 UI 组件
├── hooks/                      # 前端业务 hooks
├── services/                   # API、AI、导出、鉴权等前端服务
├── tests/                      # 前端 Node test 定向测试
├── views/                      # Dashboard、Editor、ExperienceBank、AI Assistant 等视图
├── backend/                    # FastAPI 后端服务
│   ├── app/                    # 后端应用代码
│   ├── migrations/             # 数据库迁移脚本
│   └── test_*.py               # 后端 unittest 测试
└── magic-resume-inspect/       # 独立 Next.js 应用，使用 pnpm
```

## 本地开发

### 1. 前端

```bash
npm install
cp .env.example .env
npm run dev
```

Vite 开发服务器默认绑定 `0.0.0.0:5173`，并把 `/api` 代理到 `VITE_API_BASE_URL`；未设置时回退到 `http://localhost:8000`。

本地 Logto 登出回跳需要在 Logto 控制台加入：

```text
http://localhost:5173
```

并按需设置：

```text
VITE_LOGTO_ACCOUNT_API_RESOURCE
```

### 2. 后端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
python init_local_db.py
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

也可以用：

```bash
sh prestart.sh
```

`prestart.sh` 会先运行 `python app/init_db.py`，再启动 Uvicorn。

### 3. 管理员初始化

```bash
cd backend
python set_first_admin.py <logto-user-id>
```

或先设置 `FIRST_ADMIN_USER_ID`，再运行：

```bash
python set_first_admin.py
```

### 4. magic-resume-inspect

`magic-resume-inspect/` 是独立 Next.js 工作区，不要和根项目混用包管理器。

```bash
cd magic-resume-inspect
pnpm install
pnpm dev
```

## 环境变量

前端变量参考 `.env.example`，后端变量参考 `backend/.env.example`。常用配置包括：

- `VITE_API_BASE_URL`：前端访问后端的 API 地址
- `VITE_LOGTO_*`：Logto 前端鉴权配置
- `DATABASE_URL`：PostgreSQL 连接字符串
- `LOGTO_ISSUER` / `LOGTO_AUDIENCE`：后端鉴权校验配置
- `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL`：主要 AI 服务配置
- `GEMINI_API_KEY` / `GEMINI_BASE_URL` / `GEMINI_MODEL`：Gemini 兼容配置
- `EXPORT_TOKEN_SECRET`：导出快照令牌密钥
- `POSTHOG_*`、`FEISHU_*`：分析和反馈通知相关配置

不要提交真实 `.env`、密钥、数据库连接串或用户数据。

## 验证

前端构建：

```bash
npm run build
```

前端定向测试示例：

```bash
node --test tests/account-management-static.test.mjs
node --test tests/experienceBankDrafts.test.mjs tests/experienceSimpleModeParser.test.mjs
```

后端环境和连接检查：

```bash
cd backend
python verify_env.py
python verify_db.py
python verify_ai.py
python verify_timeout.py
```

后端定向测试示例：

```bash
cd backend
python -m unittest test_assistant_features
python -m unittest test_parser_service
python -m unittest test_agent_api
python -m unittest test_ai_service
python -m unittest test_account_verification_cooldown
python -m unittest test_experience_drafts
```

## 部署提示

- 根目录 `Dockerfile` 构建前端静态产物，并用 Nginx 提供服务。
- `backend/Dockerfile` 构建 FastAPI 服务，并安装 Playwright Chromium 以支持导出能力。
- 生产部署需要分别配置前端构建参数、后端环境变量、PostgreSQL、Logto 回调地址和 CORS 允许来源。
- `backend/migrate_postgres_best_effort.py` 是手动高影响数据库迁移工具，只有在明确设置 `SOURCE_DATABASE_URL` 和 `TARGET_DATABASE_URL` 后才应运行。

## 开发约定

- 根项目使用 npm 和 `package-lock.json`。
- `magic-resume-inspect/` 使用 pnpm 和 `pnpm-lock.yaml`。
- 不要手改生成产物或缓存，例如 `dist/`、`backend/__pycache__/`、`backend/.assistant_attachment_cache/`、`vite-dev.log`、`git-status.txt`、`git-diff.txt`。
- 目前仓库没有统一启动根前端和 `backend/` 的命令，开发时需要分别启动。

## 许可证

本项目采用 GNU Affero General Public License v3.0 or later（`AGPL-3.0-or-later`）。

AGPL 是强 copyleft 许可证。分发本项目或基于本项目的修改版本时，需要按 AGPL 条款开放相应源代码；如果修改版本通过网络服务提供给用户使用，也需要向这些用户提供对应源代码。完整条款见 [LICENSE](LICENSE)。

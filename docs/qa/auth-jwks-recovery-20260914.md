# Logto 公钥缓存恢复排查（2026-09-14）

## 线上证据

只读检查 Zeabur `resumeflow-cn` / `resumeflow-botism` 的当前部署运行日志：

- 页面显示当前部署为 3 天前发布，状态为运行中；这不能单独证明进程未重启。
- 15:17 至 15:24 的可见日志中，`/health` 每约 10 秒返回 200。
- 15:20:56、15:21:17、15:22:05 出现 `auth_jwks_refresh_failed failure_type=ConnectTimeout stale_key_available=False`，同时 profile、resumes 等业务接口返回 503。
- 15:22:27 起可见多项业务请求返回 200。

这次已确认的故障是公钥拉取连接超时且无可用旧公钥，不能认定为容器冷启动。旧代码仅在启动、业务请求及 `/ready` 探测时拉取；平台实际访问 `/health`，闲置期间不会维护公钥缓存。默认缓存有效期为 3600 秒、额外容错期为 900 秒；实际线上 TTL 未读取确认。

容器终端虽显示 shell 提示符，但发送只读诊断命令后未取得回显，因此未确认进程 uptime、线上 TTL 或 DNS/TCP/TLS 分段耗时。未修改生产配置或重启服务。

## 修复

- 新增与应用生命周期绑定的独立公钥维护任务；默认每 30 秒检查，提前 60 秒刷新，短 TTL 下按比例调整。
- 冷启动预热失败后仍启动维护任务，按照失败冷却时间重试，不依赖用户请求或探针。
- 复用现有锁、HTTP 客户端、重试及公钥验证；刷新失败不延长旧公钥信任期限，未知 kid 不能使用旧密钥。
- `/ready` 不再等待公钥网络请求，只报告当前可用性，避免慢请求超过探针等待时间。
- 关闭应用时取消并等待维护任务，然后关闭 HTTP 客户端。

## 验证与发布边界

本地执行：

```text
cd backend
python -B -m unittest test_auth_jwks_maintenance test_auth_jwks_availability test_auth_readiness test_auth_middleware_security test_auth_middleware_id_token test_runtime_schema
```

41 项测试通过，包含无用户流量下连续失败后恢复、提前刷新期间已知密钥可用、公钥轮换、过期信任期限不被延长、未知密钥拒绝以及在途请求取消。

另外 14 项认证导入边界/启动测试、2 项部署结构测试通过；`git diff --check` 通过。未启动本地数据库或调用真实认证服务运行这些测试。

在 `release-v1.7` 独立工作区复验同一组 57 项检查。工作区不复制本地 `.env`；启动配置测试补充仅供测试的 AI 密钥占位值后通过，未调用真实 AI 服务。

代码尚未发布到生产。发布后需验证无人访问时公钥仍自动更新、失败后无需刷新页面即可在后端恢复，并检查平台 readiness 配置。应区分 readiness 流量准入与 liveness 重启策略；不要通过无限延长旧公钥有效期掩盖网络故障。持续的 Logto 出口故障仍需网络层诊断，此修复不能保证上游始终可达。

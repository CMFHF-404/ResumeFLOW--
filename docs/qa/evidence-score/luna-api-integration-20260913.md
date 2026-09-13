# API Luna简历审查接入

已将v4对象审查和上下文问题生成接入本地应用配置，并增加独立API Luna审查路由。后续 low 修复使用 v13 提示词、OpenAI shape v7，同一合成简历最终在66.278秒返回5条建议、0条禁用，schema、业务与前端归一化通过。完整过程及剩余内容质量问题见 [low修复验收](luna-low-repair-20260913.md)。未部署生产、提交或推送。

最初按用户要求将本地档位改为low时，同一完整合成输入59.975秒返回，但因主要经历列表及操作参数错误被业务校验拒绝；详见 `.artifacts/codex-luna-api-low-20260913/report.md`。以下medium耗时保留为首次接入记录，不代表当前修复后的low结果。

## 应用配置与调用边界

当前本地 `.env` 已启用 `VITE_ENABLE_EVIDENCE_RESUME_SCORE=true`、`VITE_ENABLE_RESUME_REVIEW_V4=true`；`backend/.env` 已启用对应后端开关，并设置：

```dotenv
ENABLE_EVIDENCE_RESUME_SCORE=true
ENABLE_RESUME_REVIEW_V4=true
RESUME_SCORE_MODEL=gpt-5.6-luna
RESUME_SCORE_THINKING_LEVEL=low
```

这是用户明确要求应用测试结果后的本地启用，不代表既定独立HR质量门槛已完成。代码和示例中的审查模型默认改为Luna；生产示例的功能开关仍保持关闭，生产发布需要独立处理。

- v4审查使用独立 `resume_review` 路由。显式Luna模型使用 `AI_BASE_URL`、`AI_API_KEY`，不会被全局 `AI_ROUTE_PROFILE=gemini_primary` 改回Gemini，也不借用快速解析通道的凭据。
- 这里的审查是现有的一次评分/诊断调用，没有增加“生成后再审计”的第二次模型调用。优化规划、回答后改写、JD分析和其他AI功能仍走其原有路径。
- 代码缺省Luna档位为medium，本地后续试验已显式改为low。low/medium/high设置会原样传给原生reasoning_effort，元数据与请求一致。未知或不支持的模型档位仍提前拒绝。
- 设置明确Gemini模型ID可回退审查路由；空模型继承全局路由。运行失败不自动回退，不新增重试、修复或复评分。
- 服务启动后会缓存配置；当前没有在监听的5173/8000服务可重启，因此这些本地设置会在下次启动时读取。前端已重新构建；未进行真实登录账户验收。

## 原生结构化输出

Luna走Chat Completions的 `response_format.type=json_schema`、`strict=true`。转换器移除Google专用propertyOrdering，将可选字段转换为“必填但可为null”，并确保对象additionalProperties=false。业务缺口类型枚举被保留，不再被误当作内部地址枚举删除。

收到结果后只把schema允许省略的null字段恢复为缺省表示，不修复必要字段、评分主体或实际选择。正文selectedItems=null可按缺省处理；课程或排序的null会变成缺少明确选择并被服务端禁用，不能清空课程。未知来源、评分损坏和写入范围保护继续生效。

服务端保存实际发送的schema hash及providerSchemaVersion，当前为 `resume_review_openai_shape_v7`（首次接入为v1）。评估运行器也使用审查专用路由，并冻结传输、配置和模型能力依赖，避免声明的模型与实际请求不一致。

官方依据：[Luna模型支持](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[Structured Outputs字段与null约定](https://developers.openai.com/api/docs/guides/structured-outputs)。官方能力支持不能证明第三方中转实现可靠。

## 实际API检查

使用当前已有的 `wolfai.top` 兼容通道及后端已有凭据，未打印或写入密钥；测试材料均为合成内容。

| 检查 | 结果 |
|---|---|
| 最小原生严格JSON请求 | 6.374秒成功，API回显gpt-5.6-luna |
| 一份完整合成简历审查，medium | 115.016秒被应用总预算取消，没有完整响应 |

首次最小请求的用量为33输入、46输出；完整超时请求的实际用量未知，失败记录中的零值不能当作没有消耗。两个请求分别保存，没有自动修复或用重试成功覆盖超时。

证据目录：`.artifacts/codex-luna-api-20260913/`，包含manifest、canary、完整调用结果、合成输入和只含批准配置键的本地配置记录。没有生成虚假的完整成功报告。

首次medium接入的结论是完整审查超时；之后按用户要求改为low并完成上述结构修复。最终low单样本已在预算内完成，但尚不能证明跨简历稳定或全面内容质量达标。超时时仍保持失败反馈和旧报告，不承诺120秒内一定成功。

## 回归重点

- MockTransport验证Luna请求实际URL、模型、strict schema、推理参数及一次调用；其他全局路由不受影响。
- 不支持schema、返回Markdown等错误均不会触发隐式重试或Gemini回退。
- nullable可选字段转换不会修复必填null，也不会把缺失课程选择当清空授权。
- 已启用Luna时，即使全局为Gemini，生产模式仍验证其AI_BASE_URL的HTTPS安全边界。
- 保留v3/旧报告、确认、应用与撤销等既有边界；没有改账户数据或共享资料库。

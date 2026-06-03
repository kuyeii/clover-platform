# 第 11：PIPT 底层网关与 superadmin 接入契约

## 1. 当前阶段结论

本阶段已将 PIPT 从标书生成局部能力下沉为平台 core gateway，作为后续 superadmin 和其他业务模块统一接入本地脱敏预处理的底层数据面。

当前完成范围：

- PIPT strong token 协议、manifest、policy 与 legacy token 兼容。
- 正则、规则、NER 后处理识别增强。
- 标书生成 Dify DSL 与 bridge DSL 同步适配占位符保留、扫描和修复约束。
- core gateway API 暴露 preprocess、postprocess、batch、validate、events、admin-summary 和 mapping cleanup。
- 合同审核仅接入 compatibility 适配字段，不启用真实脱敏。
- core event sink、mapping vault 与 superadmin 映射明细页已接入。

当前未进入范围：

- 不默认开启合同审核 strong 脱敏。
- 不允许 superadmin 直连 `core.pipt_gateway_mappings`；敏感明细只能通过管理员 API 受控读取。

## 2. Core API

所有 API 均挂载在平台 core 路由下：

- `GET /api/v1/core/pipt-gateway/status`
- `POST /api/v1/core/pipt-gateway/payload`
- `POST /api/v1/core/pipt-gateway/preprocess`
- `POST /api/v1/core/pipt-gateway/preprocess/batch`
- `POST /api/v1/core/pipt-gateway/postprocess`
- `POST /api/v1/core/pipt-gateway/postprocess/batch`
- `POST /api/v1/core/pipt-gateway/validate-placeholders`
- `GET /api/v1/core/pipt-gateway/admin-summary`
- `GET /api/v1/core/pipt-gateway/events`
- `GET /api/v1/core/pipt-gateway/mappings`
- `DELETE /api/v1/core/pipt-gateway/mappings/expired`

权限边界：

- status、payload、preprocess、postprocess、validate 需要登录用户。
- admin-summary、events、mappings、cleanup 需要管理员。
- superadmin 可使用 `PIPT_GATEWAY_ADMIN_TOKEN` 对应的 service token 调用 PIPT 管理面接口；该 token 不开放普通 preprocess / postprocess 业务接口。
- 401 / 403 不 fallback 到业务模块。

## 3. Superadmin 推荐接入

superadmin 普通概览只应读取以下两个接口：

- `GET /api/v1/core/pipt-gateway/admin-summary`
- `GET /api/v1/core/pipt-gateway/events`

PIPT 识别映射功能页允许读取：

- `GET /api/v1/core/pipt-gateway/mappings`

禁止 superadmin 直连读取：

- `core.pipt_gateway_mappings.original_text_enc`
- `core.pipt_gateway_mappings.original_text_hash`
- PIPT engine 的 `mapping_table`
- 任何 workflow 的原始输入、输出全文

## 4. Admin Summary 字段

`admin-summary.events`：

- `event_count`：事件总数。
- `placeholder_count`：合法占位符出现次数总和。
- `unsupported_count`：疑似破损或非法占位符次数总和。
- `missing_count`：期望占位符缺失次数总和。
- `unexpected_count`：模型输出新增或非预期合法占位符次数总和。
- `by_module`：按 `module_code` 聚合的事件数量。
- `by_operation`：按 `operation/status` 聚合的事件数量。

`admin-summary.vault`：

- `mapping_count`：vault 行数。
- `active_count`：未过期 mapping 数。
- `expired_count`：已过期 mapping 数。
- `encrypted_count`：行级加密状态为 `encrypted` 的 mapping 数。
- `plaintext_count`：行级加密状态为 `plaintext` 的 mapping 数。
- `contains_plaintext`：是否存在明文开发模式写入的 mapping。

`contains_plaintext` 基于 `core.pipt_gateway_mappings.encryption_status` 聚合，不基于当前环境变量推断。旧数据缺少状态时默认视为 `plaintext`。

## 5. Events 字段

`events.items[]`：

- `id`
- `request_id`
- `module_code`
- `purpose`
- `operation`：`preprocess`、`postprocess` 或 `validate`。
- `status`：`success`、`warning`、`error` 或 `skipped`。
- `mode`：`compatibility`、`strong` 或 `legacy`。
- `input_text_hash`
- `output_text_hash`
- `placeholder_count`
- `unsupported_count`
- `missing_count`
- `unexpected_count`
- `details`
- `created_at`

`details` 返回前会二次安全清洗，只允许计数、布尔和 mode，不返回 token、原文、mapping 或 traceback。

## 5.1 Mapping 明细字段

`mappings.items[]`：

- `request_id`
- `module_code`
- `purpose`
- `entity_type`
- `original_text`：解密后的原始字符，仅管理员接口返回。
- `placeholder`：映射字符。
- `placeholder_protocol`
- `encryption_status`
- `decrypt_status`
- `expired`
- `created_at`
- `expires_at`

该接口是高敏管理面，不写入事件日志，不返回 `original_text_enc`。

## 6. 数据表

`core.pipt_gateway_events`：

- 存 hash、计数、状态和安全 details。
- 不存原文。
- 不存 mapping table。
- 不存 token 列表。

`core.pipt_gateway_mappings`：

- 存本地可逆恢复所需 mapping。
- `original_text_enc` 只供 postprocess restore 使用。
- `original_text_hash` 只供一致性和审计使用。
- `encryption_status` 记录行级状态：`encrypted` 或 `plaintext`。
- superadmin 不直接读取该表。

## 7. 配置要求

生产环境必须配置：

- `PIPT_GATEWAY_VAULT_KEY`

允许 fallback：

- `PIPT_DB_KEY`

两个 key 都必须是合法 Fernet key。preflight 会校验 key 格式；运行时缺 key 或无效 key 会抛 `CONFIGURATION_ERROR`，不会被包装成数据库错误。

开发环境允许无 key，此时 mapping vault 会以 `plaintext` 状态写入；superadmin 必须把 `contains_plaintext=true` 视为风险提示。

## 8. 合同审核适配边界

合同审核当前只使用 compatibility 模式：

- 不改写合同文本。
- 不执行真实脱敏。
- 只注入 `placeholder_manifest`、`placeholder_policy`、`pipt_gateway_enabled`、`pipt_gateway_mode` 等 workflow 字段。

后续如要开启 strong 模式，必须单独评审：

- 是否允许合同文本被 token 改写后外发。
- 是否有 request_id 贯穿 postprocess restore。
- 是否有失败兜底，避免不可恢复文本进入用户可见结果。

## 9. 标书生成工作流边界

标书生成已适配 strong token：

- token 格式为 `@@PIPT:v1:e000001:kxxxxxxxx@@`。
- manifest 不包含原文。
- Dify DSL 已同步 canonical 和 bridge 副本。
- 工作流扫描 malformed token、unexpected token。
- repair 节点必须受 allowed placeholders 约束。

后续修改 Dify DSL 时必须同步：

- `legacy/bid-generator/dify/workflows/*.yml`
- `legacy/bid-generator/dify-bridge/dify-workflows/*.yml`

## 10. 当前验证命令

当前阶段最后一次通过的回归范围：

```bash
python -m pytest apps/api/tests/test_pipt_gateway_api.py apps/api/tests/test_pipt_gateway_preflight.py apps/api/tests/test_pipt_gateway_service.py apps/api/tests/test_contract_review_pipeline.py apps/api/tests/test_bid_generator_placeholder_resolve.py apps/api/tests/test_bid_generator_pipt_protocol.py apps/api/tests/test_bid_generator_pipt_engine.py apps/api/tests/test_bid_generator_recognition_rules.py apps/api/tests/test_bid_generator_dify_placeholder_scan.py apps/api/tests/test_bid_generator_pipt_audit_service.py apps/api/tests/test_init_db_bootstrap.py
```

YAML 解析：

```bash
python - <<'PY'
from pathlib import Path
import yaml
paths = sorted(Path('legacy/bid-generator/dify/workflows').glob('*.yml')) + sorted(Path('legacy/bid-generator/dify-bridge/dify-workflows').glob('*.yml'))
for path in paths:
    with path.open('r', encoding='utf-8') as f:
        yaml.safe_load(f)
print(f'loaded {len(paths)} yaml files')
PY
```

空白检查：

```bash
git diff --check
```

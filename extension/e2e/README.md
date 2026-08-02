# 扩展 E2E

在真实浏览器里驱动扩展 UI 的端到端测试。存在的理由很直接：`npm run build`、`npm run typecheck` 和后端的 900+ 单测**都抓不出跨层迁移丢失的运行时行为**——例如 background 手拼 `?contain[x]=1` 被 Tomcat 在 servlet 之前 400 掉的那类 bug（潜伏了两周，只有真发一次 HTTP 才现形）。这套测试就是那道网。

两套脚本：`all.mjs`（UI 行为，`npm run e2e`）与 `mail.mjs`（通知邮件副作用，`npm run e2e:mail`，额外需要 MailHog）。

## 覆盖范围（四件官方对齐需求 + 一个回归哨兵）

| | 内容 |
|---|---|
| ① | 文件夹 `···` 菜单：新建文件夹 / 重命名 / 共享 / 导出 / 删除（+ 保留的「移动…」）；folder 模式共享框（无 Simulate、权限走 `contain[permissions]`）；导出落在导出页 |
| ② | quickaccess 弹窗官方布局（建议 / 浏览 / 筛选›+群组› / 底部固定「新建密码」）；「我拥有的」实发后端新 `filter[is-owned-by-me]` |
| ③ | 解锁窗在 app.html 里是居中 flow-card，与恢复窗同宽；380px 弹窗不受影响（无 `.flow-overlay`） |
| ④ | 安全令牌选择器在 setup 流程口令步骤渲染（顺带验 `ExistingAccountGate`） |
| 哨兵 | 全程无裸方括号 URL、无 `/api/` 返回 400 |

## 前置条件

1. **Node ≥ 20**（undici 的 `File` 全局；与 `npm run build` 同一约束）。默认 PATH 上若是 Node 18，用 nvm：`nvm use 22`。
2. **完整 Chromium**（不是 playwright 默认的 headless_shell —— 它不能加载扩展）：
   ```bash
   npx playwright install chromium
   ```
   载具会自动在 playwright 缓存里挑最高版的完整 chromium；也可用 `JPB_E2E_CHROME=/path/to/chrome` 覆盖。
3. **已构建的 `dist/`**：`npm run build`。
4. **后端跑在 8090**（api 仓的 `local` H2 profile，`DataInitializer` 种子）：
   ```bash
   cd ../../jpassbolt_api && mvn -q spring-boot:run \
     -Dspring-boot.run.arguments=--spring.profiles.active=local
   ```
   ada@passbolt.com 用 `jpassbolt_api/.../gpg/ada_private.asc` + 口令 `password` 登录（种子设计；早先用服务器钥 server_private.asc，为终结「服务器钥=用户钥」的一钥多用已改为 ada 独立开发钥）；carol@passbolt.com 是待激活用户 + 固定 register token，供 setup 流程实测。

## 运行

```bash
npm run e2e
# 或直接： node e2e/all.mjs
```

可选环境变量：`JPB_E2E_SERVER`（默认 `http://127.0.0.1:8090`）、`JPB_E2E_CHROME`、`JPB_E2E_KEY`。

截图与 `e2e-results.json` 落在 `e2e/artifacts/`（已 gitignore）。退出码非 0 = 有断言失败。

## 通知邮件 E2E（`mail.mjs`）

验证对齐计划 P3.1（文件夹 CUD）/ P3.2（资源 CUD）的通知邮件副作用。后端单测用 mock 的 `MailService` 直接调 redactor，证不了三件事：事务**真的提交**后 `AFTER_COMMIT` 监听器会触发、`@Async` 执行器真会投递、以及真实权限行下的收件人解析。这套补上。

额外前置：**MailHog**（后端 `local` profile 已默认把 `spring.mail` 指向它，且 `jpassbolt.email.enabled=true`）

```bash
docker run -d --name jpb-mailhog -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 mailhog/mailhog
npm run e2e:mail     # 或 node e2e/mail.mjs
```

环境变量：`JPB_E2E_MAILHOG`（默认 `http://127.0.0.1:8025`）。

断言要点：

- **先证通路存活**再断言"0 封"——否则 SMTP 断了和门控生效长得一模一样。canary 用默认开启的 `send_folder_share`，并实测投递延迟与"0 封"等待窗做倍数比对。
- 文件夹删除后权限行被**物理删除**，betty 仍收到信，靠的是 `FolderDeletedEvent` 删前快照收件人；资源是**软删**、权限行还在，所以删除者 ada 被排除是 redactor 过滤的功劳。
- 密文归属**不能**靠"两段密文不相等"判断（OpenPGP 每次加密都随机，同一把钥加两次也不等），因此比对 PKESK 包里的**收件人 key ID** 与各用户公钥。
- 脚本自己把开关显式置 false 再验抑制、跑完恢复，故可重复跑（开关持久化在 `organization_settings`，不能依赖出厂默认值）。

## 设计说明

- **账号配置走 background RPC**（`SET_SERVER → SETUP_IMPORT_KEY → SETUP_COMMIT → UNLOCK`），因为 options 页已移除任意私钥导入（官方对齐：真实配置只走邮件 token）。被测的**功能全部走真实 UI**，只有 provisioning 抄了这条捷径。
- `playwright-core` 是 **devDependency**，不进扩展产物。

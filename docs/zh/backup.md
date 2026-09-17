# D1 数据库自动化增量备份与极简链式恢复引擎

<p align="center">
  <a href="../en/backup.md">English</a> | <a href="./backup.md">简体中文</a>
</p>

## 模块概述

`@nuln/worker-kit/backup` 模块为 Cloudflare D1 数据库提供了工业级的高性能、低开销自动化纯增量备份与灾难恢复引擎。

### 核心特性
- **时间戳水位线自动追踪**：自动基于 `WHERE updated_at > ?` 或 `created_at > ?` 抽取自上次备份以来的数据变动，压缩 99.9% 读额度。
- **零变动极速跳过优化**：当无任何数据行修改时，直接跳过 S3 上传（0 额外写入，执行耗时 $< 50\text{ms}$）。
- **恒定 5MB 内存占用**：采用分页游标（`LIMIT 1000`）遍历，彻底杜绝 Worker 128MB 内存溢出（OOM）。
- **一键极简增量链恢复**：自动从 S3 检索指定时间段内的所有增量包，按时间戳正序拓扑排序，校验 SHA-256 签名，并利用 `INSERT OR REPLACE`（LWW 幂等合并）一键恢复数据。
- **Dry-Run 预检机制**：支持在正式恢复写入前先进行无害预览，查看将影响的表清单与总行数。

---

## 核心 API 参考

### 1. `performScheduledIncrementalBackup(options)`
执行一站式定时纯增量备份，自动维护 S3 `latest_watermark.json` 水位线与历史滚动清理。

```ts
import { performScheduledIncrementalBackup } from "@nuln/worker-kit";

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      performScheduledIncrementalBackup({
        db: env.DB,
        serviceName: "mail",
        s3: {
          endpoint: env.S3_BACKUP_ENDPOINT,
          bucket: env.S3_BACKUP_BUCKET,
          accessKeyId: env.S3_BACKUP_ACCESS_KEY_ID,
          secretAccessKey: env.S3_BACKUP_SECRET_ACCESS_KEY,
        },
        staticTables: ["settings", "site_config"], // 静态配置小表随包附带
        skipZeroChanges: true,                     // 0 变动时跳过上传
        retentionDays: 30,                         // 保留 30 天
        maxBackups: 200,                           // 最多保留 200 个增量包
      })
    );
  },
};
```

### 2. `restoreIncrementalChainFromS3(options)`
自动从 S3 拉取增量包链条并按时间戳正序重放到 D1 数据库。

```ts
import { restoreIncrementalChainFromS3 } from "@nuln/worker-kit";

// 1. Dry-Run 预检预览
const preview = await restoreIncrementalChainFromS3({
  db: env.DB,
  serviceName: "mail",
  s3: s3Config,
  dryRun: true,
});
console.log(`将影响 ${preview.totalRowsAffected} 行数据`);

// 2. 正式执行灾难恢复
const result = await restoreIncrementalChainFromS3({
  db: env.DB,
  serviceName: "mail",
  s3: s3Config,
  dryRun: false,
  conflictStrategy: "replace",
});
```

### 3. `listIncrementalBackupsFromS3(options)`
列出并按时间正序排列 S3 上的所有增量包条目。

---

## 完整调用示例

参见 [`examples/02-backup-example.ts`](../../examples/02-backup-example.ts)。

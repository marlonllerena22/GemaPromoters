import fs from "node:fs/promises";
import path from "node:path";
// A persistent copy is made before the first financial migration. Nothing is
// served over HTTP, and an existing application database is never replaced.
export async function backupBeforeFinanceBootstrap(db, databasePath) {
  if (
    process.env.NODE_ENV !== "production" ||
    !process.env.FINANCE_BOOTSTRAP_PAYLOAD
  )
    return;
  const exists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='finance_runtime_settings'",
    )
    .get();
  if (
    exists &&
    db
      .prepare(
        "SELECT key FROM finance_runtime_settings WHERE key='bootstrap_id'",
      )
      .get()
  )
    return;
  const directory = path.join(path.dirname(databasePath), "finance-backups");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(
    directory,
    `before-finance-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
  await db.backup(target);
  await fs.chmod(target, 0o600);
  console.log("[finance] Persistent pre-activation database backup created");
}

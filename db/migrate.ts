import { runSchemaMigration, closePool } from "./client";

export async function migrate() {
  console.log("Running PostgreSQL schema migration…");
  try {
    await runSchemaMigration();
    console.log("✓ PostgreSQL schema migration completed successfully.");
  } catch (error: any) {
    console.error("✗ Migration failed:", error.message);
    throw error;
  }
}

if (require.main === module) {
  migrate()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}

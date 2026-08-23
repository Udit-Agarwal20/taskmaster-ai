import "dotenv/config";
import { query, closePool, runSchemaMigration } from "./client";
import { seed, DEMO_PROJECT_ID } from "./seed";

/**
 * Deterministically resets only the Student Marketplace demo project dataset.
 * Does not delete unrelated projects or drop tables blindly.
 */
export async function resetDemoDatabase() {
  console.log("==================================================");
  console.log("Taskmaster: Deterministic Demo Database Reset");
  console.log("==================================================");

  await runSchemaMigration();

  console.log(`Cleaning project data for '${DEMO_PROJECT_ID}'…`);

  // 1. Delete associated workflow steps, approvals, and runs
  await query(
    `DELETE FROM agent_steps WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE project_id = $1)`,
    [DEMO_PROJECT_ID]
  );
  await query(
    `DELETE FROM approvals WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE project_id = $1)`,
    [DEMO_PROJECT_ID]
  );
  await query(`DELETE FROM agent_runs WHERE project_id = $1`, [DEMO_PROJECT_ID]);
  await query(`DELETE FROM events WHERE project_id = $1`, [DEMO_PROJECT_ID]);
  await query(`DELETE FROM activity_logs WHERE project_id = $1`, [DEMO_PROJECT_ID]);

  // 2. Delete task dependencies and tasks
  await query(
    `DELETE FROM dependencies WHERE task_id IN (SELECT id FROM tasks WHERE project_id = $1)`,
    [DEMO_PROJECT_ID]
  );
  await query(`DELETE FROM tasks WHERE project_id = $1`, [DEMO_PROJECT_ID]);
  await query(`DELETE FROM project_members WHERE project_id = $1`, [DEMO_PROJECT_ID]);
  await query(`DELETE FROM projects WHERE id = $1`, [DEMO_PROJECT_ID]);

  console.log("✓ Project tables cleanly reset.");

  // 3. Recreate canonical seeded state
  await seed();

  console.log("==================================================");
  console.log("✓ Canonical Demo State Successfully Recreated!");
  console.log("==================================================");
}

if (require.main === module) {
  resetDemoDatabase()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("✗ Demo reset failed:", err);
      await closePool();
      process.exit(1);
    });
}

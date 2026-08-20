import { migrate } from "./migrate";
import { seed } from "./seed";
import { closePool } from "./client";

export async function setup() {
  console.log("Setting up Taskmaster PostgreSQL database…");
  await migrate();
  await seed();
  console.log("✓ Taskmaster database setup complete.");
}

if (require.main === module) {
  setup()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("✗ Setup failed:", err.message);
      await closePool();
      process.exit(1);
    });
}

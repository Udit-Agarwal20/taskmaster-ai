import "dotenv/config";
import { projectRepository, taskRepository, dependencyRepository } from "../db/repositories";
import { projectAnalysisService } from "../lib/services/project-analysis.service";
import { DEMO_PROJECT_ID } from "../db/seed";
import { closePool } from "../db/client";

async function verifyDemoState() {
  console.log("==================================================");
  console.log("Taskmaster: Demo State Verification (PostgreSQL)");
  console.log("==================================================");

  let passed = true;

  // 1. Project Exists
  const project = await projectRepository.findById(DEMO_PROJECT_ID);
  if (!project) {
    console.error(`✗ FAIL: Project '${DEMO_PROJECT_ID}' does not exist in PostgreSQL`);
    passed = false;
  } else {
    console.log(`✓ Project exists: ${project.name} (${project.id})`);
  }

  // 2. Tasks count = 17
  const tasks = await taskRepository.listByProject(DEMO_PROJECT_ID);
  if (tasks.length !== 17) {
    console.error(`✗ FAIL: Expected 17 tasks, found ${tasks.length}`);
    passed = false;
  } else {
    console.log(`✓ 17 tasks found in database`);
  }

  // 3. Dependencies count = 8
  const deps = await dependencyRepository.listByProject(DEMO_PROJECT_ID);
  if (deps.length !== 8) {
    console.error(`✗ FAIL: Expected 8 dependencies, found ${deps.length}`);
    passed = false;
  } else {
    console.log(`✓ 8 dependencies found in database`);
  }

  // 4. Blockers = 4
  const blockers = tasks.filter((t) => t.blocked);
  if (blockers.length !== 4) {
    console.error(`✗ FAIL: Expected 4 blockers, found ${blockers.length}`);
    passed = false;
  } else {
    console.log(`✓ 4 blockers identified`);
  }

  // 5. Deadline risks = 3
  const deadlineRisks = tasks.filter(
    (t) => (t.dueDate === "Today" || t.dueDate === "today") && t.status !== "done"
  );
  if (deadlineRisks.length !== 3) {
    console.error(`✗ FAIL: Expected 3 deadline risks, found ${deadlineRisks.length}`);
    passed = false;
  } else {
    console.log(`✓ 3 deadline risks identified (Friday launch)`);
  }

  // 6. Rahul workload = 11 tasks
  const rahulTasks = tasks.filter((t) => t.assignee?.toLowerCase() === "rahul");
  if (rahulTasks.length !== 11) {
    console.error(`✗ FAIL: Expected Rahul to have 11 active tasks, found ${rahulTasks.length}`);
    passed = false;
  } else {
    console.log(`✓ Rahul = 11 active tasks (Primary Bottleneck)`);
  }

  // 7. Overall Risk = HIGH
  const analysis = await projectAnalysisService.analyze(DEMO_PROJECT_ID);
  if (analysis.risk !== "HIGH") {
    console.error(`✗ FAIL: Expected risk level 'HIGH', got '${analysis.risk}'`);
    passed = false;
  } else {
    console.log(`✓ Overall project risk = HIGH`);
  }

  console.log("==================================================");
  if (passed) {
    console.log("✓ CANONICAL DEMO STATE VERIFIED SUCCESSFULLY!");
    console.log("==================================================");
    return 0;
  } else {
    console.error("✗ DEMO STATE VERIFICATION FAILED!");
    console.log("==================================================");
    return 1;
  }
}

if (require.main === module) {
  verifyDemoState()
    .then(async (code) => {
      await closePool();
      process.exit(code);
    })
    .catch(async (err) => {
      console.error("Verification error:", err);
      await closePool();
      process.exit(1);
    });
}

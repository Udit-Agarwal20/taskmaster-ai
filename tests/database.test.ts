import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool } from "../db/client";
import {
  userRepository,
  projectRepository,
  taskRepository,
  dependencyRepository,
  agentRunRepository,
  approvalRepository,
  activityRepository,
} from "../db/repositories";
import { projectAnalysisService } from "../lib/services/project-analysis.service";
import { seed, DEMO_PROJECT_ID, DEMO_TASKS, DEMO_DEPENDENCIES, DEMO_USERS } from "../db/seed";
import { createTaskSchema, updateTaskSchema, createDependencySchema } from "../lib/validation";
import * as fs from "fs";
import * as path from "path";

describe("Milestone 1: PostgreSQL Persistence & Repositories", () => {
  let pglite: PGlite;

  before(async () => {
    // Instantiate real embedded WebAssembly PostgreSQL for hermetic testing
    pglite = new PGlite();
    await pglite.waitReady;

    const pgAdapter: any = {
      query: async (text: string, params?: any[]) => {
        const res = await pglite.query(text, params);
        return {
          rows: res.rows,
          rowCount: res.affectedRows ?? res.rows.length,
          command: "",
          oid: 0,
          fields: res.fields,
        };
      },
      exec: async (sql: string) => {
        await pglite.exec(sql);
      },
      connect: async () => ({
        query: async (text: string, params?: any[]) => {
          const res = await pglite.query(text, params);
          return {
            rows: res.rows,
            rowCount: res.affectedRows ?? res.rows.length,
            command: "",
            oid: 0,
            fields: res.fields,
          };
        },
        release: () => {},
      }),
      end: async () => {
        await pglite.close();
      },
      on: () => {},
    };

    setPool(pgAdapter);

    // Apply schema
    const schemaPath = path.join(process.cwd(), "db", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    await pglite.exec(sql);

    // Run deterministic seed
    await seed();
  });

  after(async () => {
    await closePool();
  });

  it("1. projects can be read", async () => {
    const projects = await projectRepository.list();
    assert.ok(Array.isArray(projects), "projects should be an array");
    assert.ok(projects.length >= 1, "at least 1 project should exist");

    const project = await projectRepository.findById(DEMO_PROJECT_ID);
    assert.ok(project, "Demo project must exist");
    assert.equal(project?.id, DEMO_PROJECT_ID);
    assert.equal(project?.name, "Student Marketplace Launch");
    assert.equal(project?.deadline, "Friday");
    assert.ok(project?.members.length >= 6, "Project should include 6 team members");
    assert.ok(project?.members.includes("Rahul"), "Rahul should be a member");
    assert.ok(project?.members.includes("Maya"), "Maya should be a member");
  });

  it("2. tasks can be read", async () => {
    const tasks = await taskRepository.listByProject(DEMO_PROJECT_ID);
    assert.equal(tasks.length, 17, "Should have seeded exactly 17 tasks");

    const task1 = tasks.find((t) => t.id === "1");
    assert.ok(task1, "Task 1 should exist");
    assert.equal(task1?.title, "Finalize pricing approval");
    assert.equal(task1?.assignee, "Alex");
    assert.equal(task1?.status, "todo");
    assert.equal(task1?.priority, "high");
    assert.equal(task1?.blocked, true);
    assert.equal(task1?.dueDate, "Today");

    const task2 = tasks.find((t) => t.id === "2");
    assert.ok(task2, "Task 2 should exist");
    assert.equal(task2?.assignee, "Rahul");
    assert.equal(task2?.status, "doing");
    assert.equal(task2?.blocked, true);
  });

  it("3. tasks can be created", async () => {
    const created = await taskRepository.create({
      projectId: DEMO_PROJECT_ID,
      title: "Write documentation",
      description: "Document the new PostgreSQL persistence architecture.",
      status: "todo",
      priority: "medium",
      assignee: "Udit",
      dueDate: "Friday",
      blocked: false,
    });

    assert.ok(created.id, "Created task should have an ID");
    assert.equal(created.title, "Write documentation");
    assert.equal(created.projectId, DEMO_PROJECT_ID);
    assert.equal(created.assignee, "Udit");
    assert.equal(created.blocked, false);

    // Verify it can be retrieved by findById
    const fetched = await taskRepository.findById(created.id);
    assert.ok(fetched, "Created task must be fetchable by ID");
    assert.equal(fetched?.id, created.id);
    assert.equal(fetched?.title, "Write documentation");
  });

  it("4. task data persists across updates", async () => {
    const task = await taskRepository.create({
      projectId: DEMO_PROJECT_ID,
      title: "Temporary test task",
      status: "todo",
      priority: "low",
    });

    const updated = await taskRepository.update(task.id, {
      title: "Updated test task",
      status: "doing",
      priority: "high",
      blocked: true,
      assignee: "Sara",
    });

    assert.ok(updated, "Update should succeed");
    assert.equal(updated?.title, "Updated test task");
    assert.equal(updated?.status, "doing");
    assert.equal(updated?.priority, "high");
    assert.equal(updated?.blocked, true);
    assert.equal(updated?.assignee, "Sara");

    // Read back to ensure persistence
    const reloaded = await taskRepository.findById(task.id);
    assert.equal(reloaded?.title, "Updated test task");
    assert.equal(reloaded?.status, "doing");
    assert.equal(reloaded?.blocked, true);

    // Clean up
    await taskRepository.delete(task.id);
    const deleted = await taskRepository.findById(task.id);
    assert.equal(deleted, null, "Deleted task should return null");
  });

  it("5. dependencies can be read", async () => {
    const deps = await dependencyRepository.listByProject(DEMO_PROJECT_ID);
    assert.ok(deps.length >= 8, "Should have at least 8 dependencies");

    const edge1 = deps.find((d) => d.from === "2" && d.to === "1");
    assert.ok(edge1, "Edge 2 -> 1 (Payment depends on Pricing approval) must exist");

    const edge2 = deps.find((d) => d.from === "5" && d.to === "2");
    assert.ok(edge2, "Edge 5 -> 2 (Launch QA depends on Payment) must exist");

    const edge3 = deps.find((d) => d.from === "6" && d.to === "5");
    assert.ok(edge3, "Edge 6 -> 5 (Production deployment depends on QA) must exist");
  });

  it("6. project analysis reads database state", async () => {
    const analysis = await projectAnalysisService.analyze(DEMO_PROJECT_ID);

    assert.equal(analysis.risk, "HIGH", "Risk should be HIGH due to blockers & bottleneck");
    assert.ok(analysis.blockers >= 4, "Should detect at least 4 blockers");
    assert.ok(analysis.deadlineRisks >= 3, "Should detect at least 3 deadline risks ('Today')");
    assert.equal(analysis.bottleneck.name, "Rahul", "Bottleneck should be Rahul");
    assert.ok(analysis.bottleneck.count >= 11, "Rahul should have 11+ tasks assigned");
    assert.ok(analysis.workload["Rahul"] >= 11, "Workload map should show Rahul with 11+ tasks");
    assert.ok(Array.isArray(analysis.dependencies), "Dependencies should be returned");
  });

  it("7. invalid references and constraints are rejected", async () => {
    // Self dependency constraint rejection
    await assert.rejects(
      async () => {
        await dependencyRepository.create("1", "1");
      },
      /cannot depend on itself|no_self_dependency/i,
      "Self dependency must be rejected"
    );

    // Invalid schema input validation rejection via Zod
    const invalidTask = createTaskSchema.safeParse({
      title: "", // empty title
      status: "invalid_status",
    });
    assert.equal(invalidTask.success, false, "Invalid task payload should fail validation");

    const invalidDep = createDependencySchema.safeParse({
      taskId: "1",
      dependsOnTaskId: "1",
    });
    assert.equal(invalidDep.success, false, "Self dependency should fail validation schema");
  });

  it("8. agent runs and steps can be recorded and retrieved", async () => {
    const run = await agentRunRepository.create({
      projectId: DEMO_PROJECT_ID,
      goal: "Get this project back on track.",
      state: "PLANNING",
    });

    assert.ok(run.id, "Agent run must have an ID");
    assert.equal(run.state, "PLANNING");

    const step = await agentRunRepository.addStep({
      agentRunId: run.id,
      stepNumber: 1,
      stepType: "TOOL_CALL",
      toolName: "analyzeProject",
      input: { projectId: DEMO_PROJECT_ID },
      output: { risk: "HIGH", blockers: 4 },
      status: "COMPLETED",
    });

    assert.ok(step.id);
    assert.equal(step.agentRunId, run.id);
    assert.equal(step.toolName, "analyzeProject");

    const steps = await agentRunRepository.getSteps(run.id);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].toolName, "analyzeProject");

    const updatedRun = await agentRunRepository.updateState(
      run.id,
      "COMPLETED",
      "Resolved blockers and optimized workload distribution."
    );
    assert.equal(updatedRun?.state, "COMPLETED");
    assert.equal(
      updatedRun?.summary,
      "Resolved blockers and optimized workload distribution."
    );
  });

  it("9. approvals can be created, listed, and resolved", async () => {
    const run = await agentRunRepository.create({
      projectId: DEMO_PROJECT_ID,
      goal: "Reassign workload",
      state: "WAITING_FOR_APPROVAL",
    });

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassignTask",
      payload: { taskId: "4", from: "Rahul", to: "Maya" },
      riskLevel: "REVIEW",
    });

    assert.ok(approval.id);
    assert.equal(approval.status, "pending");

    const pending = await approvalRepository.listPendingByProject(DEMO_PROJECT_ID);
    assert.ok(pending.some((a) => a.id === approval.id), "Created approval should be listed in pending");

    const resolved = await approvalRepository.resolve(approval.id, "approved", "user-udit");
    assert.equal(resolved?.status, "approved");
    assert.equal(resolved?.approvedBy, "user-udit");
    assert.ok(resolved?.resolvedAt, "resolvedAt timestamp must be populated");
  });

  it("10. activity logs record events and can be queried", async () => {
    const log = await activityRepository.log({
      projectId: DEMO_PROJECT_ID,
      actorType: "agent",
      eventType: "TASK_REASSIGNED",
      metadata: { taskId: "4", from: "Rahul", to: "Maya" },
    });

    assert.ok(log.id);
    assert.equal(log.eventType, "TASK_REASSIGNED");

    const logs = await activityRepository.listByProject(DEMO_PROJECT_ID, 10);
    assert.ok(logs.length >= 1);
    assert.ok(logs.some((l) => l.eventType === "TASK_REASSIGNED"));
  });
});

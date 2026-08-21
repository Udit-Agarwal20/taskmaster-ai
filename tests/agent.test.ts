import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import {
  getProjectStateTool,
  getTasksTool,
  getDependenciesTool,
  getTeamWorkloadTool,
  getProjectActivityTool,
  analyzeProjectTool,
} from "../agent/tools/read_tools";
import { taskmasterAgent, TASKMASTER_MODEL } from "../agent/taskmaster_agent";
import { executeTaskmasterAgent, extractJsonFromText } from "../agent/executor";
import { RecoveryPlanSchema } from "../agent/schema";
import { taskRepository, agentRunRepository } from "../db/repositories";
import * as projectAgentRoute from "../app/api/projects/[projectId]/agent/route";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

describe("Milestone 2: Google ADK + Gemini Agent Foundation", () => {
  let pglite: PGlite;

  before(async () => {
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

    const schemaPath = path.join(process.cwd(), "db", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    await pglite.exec(sql);
    await seed();
  });

  after(async () => {
    await closePool();
  });

  it("1. Taskmaster agent is configured with Gemini 3.5 Flash and read-only tools", () => {
    assert.equal(taskmasterAgent.name, "taskmaster_agent");
    assert.equal(taskmasterAgent.model, TASKMASTER_MODEL);
    assert.equal(TASKMASTER_MODEL, "gemini-3.5-flash");
    assert.ok(taskmasterAgent.tools.length >= 6, "Must have all 6 read-only tools");
    assert.equal(taskmasterAgent.disallowTransferToParent, true);
    assert.equal(taskmasterAgent.disallowTransferToPeers, true);
  });

  it("2. ADK read-only tools read factual project state from repositories", async () => {
    // getProjectState tool
    const projectState = (await getProjectStateTool.runAsync({
      args: { projectId: DEMO_PROJECT_ID },
    } as any)) as any;
    assert.equal(projectState.id, DEMO_PROJECT_ID);
    assert.equal(projectState.name, "Student Marketplace Launch");
    assert.equal(projectState.deadline, "Friday");
    assert.ok(projectState.members.includes("Rahul"));

    // getTasks tool
    const tasksResult = (await getTasksTool.runAsync({
      args: { projectId: DEMO_PROJECT_ID },
    } as any)) as any;
    assert.equal(tasksResult.count, 17);
    assert.equal(tasksResult.tasks.length, 17);

    // getDependencies tool
    const depsResult = (await getDependenciesTool.runAsync({
      args: { projectId: DEMO_PROJECT_ID },
    } as any)) as any;
    assert.equal(depsResult.count, 8);

    // getTeamWorkload tool
    const workloadResult = (await getTeamWorkloadTool.runAsync({
      args: { projectId: DEMO_PROJECT_ID },
    } as any)) as any;
    assert.ok(workloadResult.workload["Rahul"].total >= 11);
    assert.ok(workloadResult.workload["Rahul"].active >= 11);

    // getProjectActivity tool
    const activityResult = (await getProjectActivityTool.runAsync({
      args: { projectId: DEMO_PROJECT_ID, limit: 10 },
    } as any)) as any;
    assert.ok(activityResult.count >= 1);

    // analyzeProject tool
    const analysisResult = (await analyzeProjectTool.runAsync({
      args: { projectId: DEMO_PROJECT_ID },
    } as any)) as any;
    assert.equal(analysisResult.risk, "HIGH");
    assert.equal(analysisResult.blockers, 4);
    assert.equal(analysisResult.deadlineRisks, 3);
    assert.equal(analysisResult.bottleneck.name, "Rahul");
    assert.ok(analysisResult.bottleneck.count >= 11);
  });

  it("3. Structured RecoveryPlanSchema validates correctly", () => {
    const validPlan = {
      projectId: DEMO_PROJECT_ID,
      summary: "Project is HIGH risk due to 4 blockers and Rahul workload bottleneck. Propose reassigning tasks to Maya and unblocking pricing approval.",
      riskLevel: "high" as const,
      findings: [
        {
          type: "blocker" as const,
          title: "Pricing approval blocks checkout integration",
          explanation: "Task 1 (Pricing approval) is blocking Task 2 (Payment integration).",
          relatedTaskIds: ["1", "2"],
        },
        {
          type: "workload" as const,
          title: "Rahul overloaded with 11 active tasks",
          explanation: "Rahul has 11 concurrent tasks assigned, creating a single-point failure bottleneck.",
          relatedTaskIds: ["2", "4", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
        },
      ],
      proposedActions: [
        {
          actionType: "reassign_task" as const,
          taskId: "4",
          targetAssigneeId: "Maya",
          reason: "Reassign Analytics events from Rahul to Maya to relieve bottleneck.",
        },
      ],
      requiresApproval: true,
    };

    const parsed = RecoveryPlanSchema.safeParse(validPlan);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.riskLevel, "high");
      assert.equal(parsed.data.findings.length, 2);
      assert.equal(parsed.data.proposedActions.length, 1);
      assert.equal(parsed.data.requiresApproval, true);
    }
  });

  it("4. extractJsonFromText handles raw JSON and markdown code blocks", () => {
    const raw = '{"projectId":"student-marketplace","summary":"Test summary"}';
    assert.equal(extractJsonFromText(raw).projectId, "student-marketplace");

    const markdown = '```json\n{"projectId":"student-marketplace","summary":"Test markdown summary"}\n```';
    assert.equal(extractJsonFromText(markdown).summary, "Test markdown summary");
  });

  it("5. Missing GEMINI_API_KEY returns clear configuration error and marks run FAILED", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const result = await executeTaskmasterAgent({
        projectId: DEMO_PROJECT_ID,
        goal: "Get this project back on track.",
      });

      assert.equal(result.state, "FAILED");
      assert.ok(result.summary.includes("GEMINI_API_KEY"));
      assert.ok(result.agentRunId);

      // Verify the agent_runs record in PostgreSQL reflects FAILED state
      const run = await agentRunRepository.findById(result.agentRunId);
      assert.ok(run);
      assert.equal(run?.state, "FAILED");
      assert.ok(run?.summary?.includes("GEMINI_API_KEY"));
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it("6. Agent execution rejects invalid project ID", async () => {
    await assert.rejects(
      async () => {
        await executeTaskmasterAgent({
          projectId: "non-existent-project",
          goal: "Plan work",
        });
      },
      /Project 'non-existent-project' not found/
    );
  });

  it("7. Agent execution does NOT mutate any task or project data (Read-Only Guarantee)", async () => {
    const beforeTasks = await taskRepository.listByProject(DEMO_PROJECT_ID);
    assert.equal(beforeTasks.length, 17);

    // Run agent execution attempt
    await executeTaskmasterAgent({
      projectId: DEMO_PROJECT_ID,
      goal: "Get this project back on track.",
    });

    const afterTasks = await taskRepository.listByProject(DEMO_PROJECT_ID);
    assert.equal(afterTasks.length, 17, "Task count must remain exactly 17");

    // Check individual task status remained untouched
    for (let i = 0; i < beforeTasks.length; i++) {
      assert.equal(afterTasks[i].id, beforeTasks[i].id);
      assert.equal(afterTasks[i].status, beforeTasks[i].status);
      assert.equal(afterTasks[i].assignee, beforeTasks[i].assignee);
      assert.equal(afterTasks[i].blocked, beforeTasks[i].blocked);
    }
  });

  it("8. POST /api/projects/:projectId/agent endpoint works and validates project", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${DEMO_PROJECT_ID}/agent`,
      {
        method: "POST",
        body: JSON.stringify({ goal: "Get this project back on track." }),
      }
    );
    const params = Promise.resolve({ projectId: DEMO_PROJECT_ID });

    const response = await projectAgentRoute.POST(req, { params });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(body.agentRunId);
    assert.ok(body.status);
    assert.ok(body.summary);
  });

  it("9. POST /api/projects/:projectId/agent returns 404 for invalid project", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/projects/unknown-proj/agent",
      {
        method: "POST",
        body: JSON.stringify({ goal: "Get this project back on track." }),
      }
    );
    const params = Promise.resolve({ projectId: "unknown-proj" });

    const response = await projectAgentRoute.POST(req, { params });
    assert.equal(response.status, 404);
  });

  it("10. validatePlanGrounding validates valid database references", async () => {
    const { validatePlanGrounding, captureProjectSnapshot } = await import("../agent/validate_plan");
    const snapshotBefore = await captureProjectSnapshot(DEMO_PROJECT_ID);

    const validPlan = {
      projectId: DEMO_PROJECT_ID,
      summary: "Valid test plan referencing existing database tasks 1 and 2.",
      riskLevel: "high" as const,
      findings: [
        {
          type: "blocker" as const,
          title: "Pricing approval blocker",
          explanation: "Task 1 blocks checkout",
          relatedTaskIds: ["1", "2"],
        },
      ],
      proposedActions: [
        {
          actionType: "reassign_task" as const,
          taskId: "4",
          targetAssigneeId: "Maya",
          reason: "Move task 4 to Maya",
        },
      ],
      requiresApproval: true,
    };

    const grounding = await validatePlanGrounding(validPlan);
    assert.equal(grounding.isValid, true);
    assert.equal(grounding.errors.length, 0);
    assert.equal(grounding.checkedEntities.missingTaskIds.length, 0);

    const snapshotAfter = await captureProjectSnapshot(DEMO_PROJECT_ID);
    assert.equal(snapshotBefore.tasksCount, snapshotAfter.tasksCount);
    assert.equal(snapshotBefore.tasksJson, snapshotAfter.tasksJson);
  });

  it("11. validatePlanGrounding detects and rejects invented task IDs", async () => {
    const { validatePlanGrounding } = await import("../agent/validate_plan");

    const inventedPlan = {
      projectId: DEMO_PROJECT_ID,
      summary: "Plan with hallucinated tasks",
      riskLevel: "high" as const,
      findings: [
        {
          type: "blocker" as const,
          title: "Fake blocker",
          explanation: "Non existent task 999",
          relatedTaskIds: ["999"],
        },
      ],
      proposedActions: [
        {
          actionType: "reassign_task" as const,
          taskId: "fake-task-123",
          targetAssigneeId: "Maya",
          reason: "Reassign non-existent task",
        },
      ],
      requiresApproval: false,
    };

    const grounding = await validatePlanGrounding(inventedPlan);
    assert.equal(grounding.isValid, false);
    assert.ok(grounding.errors.length >= 2);
    assert.ok(grounding.checkedEntities.missingTaskIds.includes("999"));
    assert.ok(grounding.checkedEntities.missingTaskIds.includes("fake-task-123"));
  });
});

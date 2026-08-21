import * as dotenv from "dotenv";
import { executeTaskmasterAgent } from "./executor";
import { readOnlyTools } from "./tools/read_tools";
import { DEMO_PROJECT_ID, seed } from "../db/seed";
import { projectAnalysisService } from "../lib/services/project-analysis.service";
import { setPool, closePool } from "../db/client";
import { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

export async function verifyLocalAgent() {
  console.log("==================================================");
  console.log("Taskmaster Milestone 2 — ADK Agent Local Verification");
  console.log("==================================================");

  // Setup embedded PostgreSQL if DATABASE_URL is not set
  if (!process.env.DATABASE_URL) {
    console.log("ℹ No external DATABASE_URL found. Initializing embedded PostgreSQL for local verification…");
    const pglite = new PGlite();
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
    console.log("✓ Embedded database initialized and seeded.");
  }

  // 1. Verify Read-Only Tool Contracts & Analysis Service
  console.log("\n[1/3] Testing Read-Only Tool Integrations against Database…");
  try {
    const analysis = await projectAnalysisService.analyze(DEMO_PROJECT_ID);
    console.log(`✓ Deterministic Analysis: Risk=${analysis.risk}, Blockers=${analysis.blockers}, Bottleneck=${analysis.bottleneck.name} (${analysis.bottleneck.count} tasks)`);
    console.log(`✓ Available ADK Tools (${readOnlyTools.length}):`);
    for (const tool of readOnlyTools) {
      console.log(`  - ${tool.name}: ${tool.description.slice(0, 65)}…`);
    }
  } catch (err: any) {
    console.error("✗ Failed to query project state:", err.message);
    throw err;
  }

  // 2. Check Gemini Configuration
  console.log("\n[2/3] Checking Gemini API Configuration…");
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠ GEMINI_API_KEY is not set in environment.");
    console.warn("  Deterministic tool layer and schema verification PASSED.");
    console.warn("  To run live Gemini 3.5 Flash planning, set GEMINI_API_KEY in your .env file.");
    console.log("\n==================================================");
    console.log("Local Verification Complete: Read tools & schema OK.");
    console.log("==================================================");
    return;
  }
  console.log("✓ GEMINI_API_KEY detected.");

  // 3. Execute Taskmaster Agent
  console.log("\n[3/3] Executing Taskmaster Agent Planning Cycle…");
  console.log(`Goal: "Get this project back on track."`);
  const result = await executeTaskmasterAgent({
    projectId: DEMO_PROJECT_ID,
    goal: "Get this project back on track.",
  });

  console.log(`\nResult Status: ${result.state}`);
  console.log(`Agent Run ID: ${result.agentRunId}`);
  console.log(`Steps Recorded: ${result.stepsCount}`);
  console.log(`Summary: ${result.summary}`);

  if (result.plan) {
    console.log("\n--- Structured Recovery Plan ---");
    console.log(`Overall Risk: ${result.plan.riskLevel.toUpperCase()}`);
    console.log(`Requires Approval: ${result.plan.requiresApproval}`);
    console.log(`\nFindings (${result.plan.findings.length}):`);
    result.plan.findings.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.type.toUpperCase()}] ${f.title} (Tasks: ${f.relatedTaskIds.join(", ")})`);
      console.log(`     ${f.explanation}`);
    });
    console.log(`\nProposed Actions (${result.plan.proposedActions.length}):`);
    result.plan.proposedActions.forEach((a, i) => {
      if (a.actionType === "create_subtask") {
        console.log(`  ${i + 1}. [create_subtask] Parent: ${a.parentTaskId}, Title: "${a.title}" — ${a.reason}`);
      } else if (a.actionType === "reassign_task") {
        console.log(`  ${i + 1}. [reassign_task] Task: ${a.taskId} -> Assignee: ${a.targetAssigneeId} — ${a.reason}`);
      }
    });
  }
  console.log("==================================================");
}

if (require.main === module) {
  verifyLocalAgent()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Local verification error:", err);
      await closePool();
      process.exit(1);
    });
}

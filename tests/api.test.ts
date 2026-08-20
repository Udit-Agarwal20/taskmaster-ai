import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import * as projectsRoute from "../app/api/projects/route";
import * as tasksRoute from "../app/api/projects/[projectId]/tasks/route";
import * as analysisRoute from "../app/api/projects/[projectId]/analysis/route";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

describe("Milestone 1: API Routes Contracts against PostgreSQL", () => {
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

  it("GET /api/projects returns seeded project array", async () => {
    const response = await projectsRoute.GET();
    assert.equal(response.status, 200);

    const data = await response.json();
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 1);
    assert.equal(data[0].id, DEMO_PROJECT_ID);
    assert.equal(data[0].name, "Student Marketplace Launch");
    assert.ok(Array.isArray(data[0].members));
    assert.ok(data[0].members.includes("Rahul"));
  });

  it("GET /api/projects/:projectId/tasks returns 17 tasks", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects/student-marketplace/tasks");
    const params = Promise.resolve({ projectId: DEMO_PROJECT_ID });

    const response = await tasksRoute.GET(req, { params });
    assert.equal(response.status, 200);

    const data = await response.json();
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 17);
    assert.equal(data[0].projectId, DEMO_PROJECT_ID);
  });

  it("POST /api/projects/:projectId/tasks creates task and returns 201", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects/student-marketplace/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Verify API test endpoint",
        description: "Integration test creation",
        status: "todo",
        priority: "high",
        assignee: "Maya",
        dueDate: "Friday",
        blocked: false,
      }),
    });
    const params = Promise.resolve({ projectId: DEMO_PROJECT_ID });

    const response = await tasksRoute.POST(req, { params });
    assert.equal(response.status, 201);

    const created = await response.json();
    assert.ok(created.id);
    assert.equal(created.title, "Verify API test endpoint");
    assert.equal(created.assignee, "Maya");
    assert.equal(created.priority, "high");

    // Fetch tasks list to confirm it was persisted in PostgreSQL
    const listRes = await tasksRoute.GET(req, { params });
    const listData = await listRes.json();
    assert.equal(listData.length, 18);
  });

  it("POST /api/projects/:projectId/tasks rejects empty title with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects/student-marketplace/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "   ",
      }),
    });
    const params = Promise.resolve({ projectId: DEMO_PROJECT_ID });

    const response = await tasksRoute.POST(req, { params });
    assert.equal(response.status, 400);

    const err = await response.json();
    assert.ok(err.error);
  });

  it("GET /api/projects/:projectId/tasks returns 404 for non-existent project", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects/non-existent/tasks");
    const params = Promise.resolve({ projectId: "non-existent" });

    const response = await tasksRoute.GET(req, { params });
    assert.equal(response.status, 404);
  });

  it("GET /api/projects/:projectId/analysis returns correct analysis calculation", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects/student-marketplace/analysis");
    const params = Promise.resolve({ projectId: DEMO_PROJECT_ID });

    const response = await analysisRoute.GET(req, { params });
    assert.equal(response.status, 200);

    const analysis = await response.json();
    assert.equal(analysis.risk, "HIGH");
    assert.ok(analysis.blockers >= 4);
    assert.ok(analysis.deadlineRisks >= 3);
    assert.equal(analysis.bottleneck.name, "Rahul");
    assert.ok(analysis.bottleneck.count >= 11);
    assert.ok(Array.isArray(analysis.dependencies));
  });
});

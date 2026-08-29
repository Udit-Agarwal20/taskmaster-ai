import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import * as workflowsRoute from "../app/api/workflows/route";
import * as integrationsStatusRoute from "../app/api/integrations/status/route";
import { NAV_ITEMS } from "../components/navigation/NavLinks";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

describe("Milestone 4G: Navigation, Workflow History & Integrations API", () => {
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

  it("Source of Truth: NAV_ITEMS contains all 4 functional application routes", () => {
    assert.equal(NAV_ITEMS.length, 4);
    assert.deepEqual(
      NAV_ITEMS.map((n) => n.href),
      ["/", "/tasks", "/workflows", "/integrations"]
    );
    assert.deepEqual(
      NAV_ITEMS.map((n) => n.label),
      ["Command Center", "Task Board", "Workflow History", "Integrations"]
    );
  });

  it("GET /api/workflows returns array of persisted workflow runs", async () => {
    const req = new NextRequest(`http://localhost:3000/api/workflows?projectId=${DEMO_PROJECT_ID}`);
    const res = await workflowsRoute.GET(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.projectId, DEMO_PROJECT_ID);
    assert.ok(Array.isArray(data.workflows));
  });

  it("GET /api/integrations/status returns live status for all 5 connected services", async () => {
    const req = new NextRequest("http://localhost:3000/api/integrations/status");
    const res = await integrationsStatusRoute.GET(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.status, "healthy");
    assert.equal(data.totalIntegrations, 5);

    const ids = data.integrations.map((i: any) => i.id);
    assert.ok(ids.includes("github"));
    assert.ok(ids.includes("vertex-ai"));
    assert.ok(ids.includes("pubsub"));
    assert.ok(ids.includes("postgres"));
    assert.ok(ids.includes("slack"));

    // Verify zero secrets/passwords are exposed in details
    data.integrations.forEach((item: any) => {
      assert.equal(item.status, "CONNECTED");
      const detailsStr = JSON.stringify(item.details).toLowerCase();
      assert.equal(detailsStr.includes("password"), false);
      assert.equal(detailsStr.includes("secret"), false);
      assert.equal(detailsStr.includes("token"), false);
      assert.equal(detailsStr.includes("key="), false);
    });
  });
});

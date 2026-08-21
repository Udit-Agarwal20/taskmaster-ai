import { NextRequest, NextResponse } from "next/server";
import {
  approvalRepository,
  agentRunRepository,
  activityRepository,
  projectRepository,
  taskRepository,
  userRepository,
} from "@/db/repositories";
import { workflowService } from "@/lib/services/workflow.service";
import { z } from "zod";

export const runtime = "nodejs";

const resolveApprovalSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  // Note: Client-supplied approvedBy is deliberately ignored in favor of server-configured demo operator identity
  approvedBy: z.string().optional(),
});

/**
 * Server-controlled operator identity for demo/hackathon mode.
 * Client-provided approver names are ignored to prevent spoofing.
 */
export const SERVER_DEMO_OPERATOR_ID = process.env.DEMO_OPERATOR_ID || "user-udit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> }
) {
  try {
    const { approvalId } = await params;
    if (!approvalId) {
      return NextResponse.json({ error: "approvalId is required" }, { status: 400 });
    }

    const approval = await approvalRepository.findById(approvalId);
    if (!approval) {
      return NextResponse.json(
        { error: `Approval '${approvalId}' not found` },
        { status: 404 }
      );
    }

    // Idempotency: repeated resolutions return existing resolved state
    if (approval.status !== "pending") {
      return NextResponse.json({
        status: "already_resolved",
        approvalId: approval.id,
        approvalStatus: approval.status,
        resolvedAt: approval.resolvedAt,
      });
    }

    const rawBody = await req.json().catch(() => ({}));
    const validated = resolveApprovalSchema.safeParse(rawBody);
    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid approval payload", details: validated.error.format() },
        { status: 400 }
      );
    }

    const { decision } = validated.data;

    // 1. Validate associated workflow run
    const run = await agentRunRepository.findById(approval.agentRunId);
    if (!run) {
      return NextResponse.json(
        { error: `Associated workflow run '${approval.agentRunId}' not found` },
        { status: 400 }
      );
    }

    // 2. Validate project scope
    const project = await projectRepository.findById(run.projectId);
    if (!project) {
      return NextResponse.json(
        { error: `Associated project '${run.projectId}' not found` },
        { status: 400 }
      );
    }

    // 3. Resolve trusted server-side operator identity
    let operatorUser = await userRepository.findById(SERVER_DEMO_OPERATOR_ID);
    if (!operatorUser) {
      // Fallback lookup by name if DEMO_OPERATOR_ID is a name
      const users = await userRepository.list();
      operatorUser = users.find(
        (u) => u.name.toLowerCase() === SERVER_DEMO_OPERATOR_ID.toLowerCase() || u.id === SERVER_DEMO_OPERATOR_ID
      ) || null;
    }
    const resolvedOperatorName = operatorUser ? operatorUser.name : "Udit";
    const resolvedOperatorId = operatorUser ? operatorUser.id : "user-udit";

    // 4. Validate target action entities if approved
    const actionPayload =
      typeof approval.payload === "string" ? JSON.parse(approval.payload) : approval.payload;

    if (decision === "approve" && approval.action === "reassign_task") {
      const task = await taskRepository.findById(actionPayload.taskId);
      if (!task) {
        return NextResponse.json(
          { error: `Target task '${actionPayload.taskId}' no longer exists` },
          { status: 400 }
        );
      }
      if (task.projectId !== run.projectId) {
        return NextResponse.json(
          { error: `Target task does not belong to project '${run.projectId}'` },
          { status: 400 }
        );
      }

      const isMember = project.members.some(
        (m) => m.toLowerCase() === actionPayload.targetAssigneeId.toLowerCase()
      );
      if (!isMember) {
        return NextResponse.json(
          { error: `Target assignee '${actionPayload.targetAssigneeId}' is not a project member` },
          { status: 400 }
        );
      }
    }

    // 5. Resolve approval record in PostgreSQL with trusted server identity
    const resolvedStatus = decision === "approve" ? "approved" : "rejected";
    const resolvedApproval = await approvalRepository.resolve(
      approvalId,
      resolvedStatus,
      resolvedOperatorId
    );

    if (decision === "approve") {
      // Resume workflow to execute approved mutation
      const resumedWorkflow = await workflowService.resumeWorkflow(
        approval.agentRunId,
        `Approved by ${resolvedOperatorName} (Server-controlled Operator ID: ${resolvedOperatorId})`
      );

      return NextResponse.json({
        status: "approved",
        approvalId: approval.id,
        agentRunId: approval.agentRunId,
        approvedBy: resolvedOperatorId,
        approvedByName: resolvedOperatorName,
        workflowState: resumedWorkflow.state,
        summary: resumedWorkflow.summary,
      });
    } else {
      // Rejection: complete workflow without applying mutation
      await agentRunRepository.updateWorkflowState(approval.agentRunId, {
        state: "COMPLETED",
        summary: `Action rejected by ${resolvedOperatorName}. No database mutation was executed.`,
      });

      await activityRepository.log({
        projectId: run.projectId,
        actorType: "user",
        actorId: resolvedOperatorId,
        eventType: "APPROVAL_REJECTED",
        metadata: {
          approvalId: approval.id,
          action: approval.action,
          rejectedBy: resolvedOperatorId,
          rejectedByName: resolvedOperatorName,
          payload: actionPayload,
        },
      });

      return NextResponse.json({
        status: "rejected",
        approvalId: approval.id,
        agentRunId: approval.agentRunId,
        rejectedBy: resolvedOperatorId,
        rejectedByName: resolvedOperatorName,
        workflowState: "COMPLETED",
        summary: `Action rejected by ${resolvedOperatorName}. Task remains unmodified.`,
      });
    }
  } catch (error: any) {
    console.error("POST /api/approvals/[approvalId]/resolve failed:", error.message);
    return NextResponse.json(
      { error: "Failed to resolve approval", details: error.message },
      { status: 500 }
    );
  }
}

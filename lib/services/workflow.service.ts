import {
  agentRunRepository,
  eventRepository,
  activityRepository,
  approvalRepository,
  AgentRun,
  EventRecord,
} from "../../db/repositories";
import { WorkflowState, WorkflowEventType } from "../../agent/state";
import { executeTaskmasterAgent } from "../../agent/executor";

export const LEGAL_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  IDLE: ["UNDERSTANDING", "FAILED", "CANCELLED"],
  UNDERSTANDING: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: [
    "WAITING_FOR_APPROVAL",
    "WAITING_FOR_EVENT",
    "EXECUTING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ],
  WAITING_FOR_APPROVAL: ["RESUMING", "FAILED", "CANCELLED"],
  WAITING_FOR_EVENT: ["RESUMING", "FAILED", "CANCELLED"],
  RESUMING: [
    "PLANNING",
    "EXECUTING",
    "WAITING_FOR_APPROVAL",
    "WAITING_FOR_EVENT",
    "FAILED",
    "CANCELLED",
  ],
  EXECUTING: [
    "VERIFYING",
    "WAITING_FOR_APPROVAL",
    "WAITING_FOR_EVENT",
    "FAILED",
    "CANCELLED",
  ],
  VERIFYING: ["COMPLETED", "PLANNING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export type CreateWorkflowRunParams = {
  projectId: string;
  goal: string;
  triggerType?: WorkflowEventType | string;
  triggerId?: string | null;
  idempotencyKey?: string | null;
  contextSnapshot?: any;
};

export class WorkflowService {
  /**
   * Structured, sanitized observability logging (no secrets).
   */
  private log(event: string, data: Record<string, any>) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        domain: "workflow",
        event,
        ...data,
      })
    );
  }

  /**
   * Validates state transition legality according to the deterministic state machine.
   */
  validateTransition(fromState: WorkflowState, toState: WorkflowState): void {
    const allowed = LEGAL_TRANSITIONS[fromState] ?? [];
    if (!allowed.includes(toState)) {
      throw new Error(
        `Illegal workflow state transition from '${fromState}' to '${toState}'. Allowed: [${allowed.join(
          ", "
        )}]`
      );
    }
  }

  /**
   * Creates a new workflow run or retrieves existing run if idempotencyKey matches.
   */
  async createOrGetRun(
    params: CreateWorkflowRunParams
  ): Promise<{ run: AgentRun; isDuplicate: boolean }> {
    const { projectId, goal, triggerType, triggerId, idempotencyKey, contextSnapshot } = params;

    if (idempotencyKey) {
      const existing = await agentRunRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        this.log("duplicate_run_ignored", {
          idempotencyKey,
          existingRunId: existing.id,
          state: existing.state,
        });
        return { run: existing, isDuplicate: true };
      }
    }

    const run = await agentRunRepository.create({
      projectId,
      goal,
      triggerType: triggerType ?? "USER_GOAL",
      triggerId: triggerId ?? null,
      state: "UNDERSTANDING",
      currentStep: "UNDERSTANDING",
      idempotencyKey: idempotencyKey ?? null,
      contextSnapshot: contextSnapshot ?? {},
    });

    this.log("workflow_created", {
      runId: run.id,
      projectId: run.projectId,
      goal: run.goal,
      state: run.state,
    });

    await activityRepository.create({
      projectId,
      actorType: "agent",
      actorId: run.id,
      eventType: "WORKFLOW_CREATED",
      metadata: { runId: run.id, goal, idempotencyKey },
    });

    return { run, isDuplicate: false };
  }

  /**
   * Performs an audited, validated state transition on a workflow run.
   */
  async transitionState(
    runId: string,
    toState: WorkflowState,
    metadata?: {
      currentStep?: string;
      summary?: string;
      plan?: any;
      lastError?: string;
      contextSnapshot?: any;
    }
  ): Promise<AgentRun> {
    const run = await agentRunRepository.findById(runId);
    if (!run) {
      throw new Error(`Workflow run '${runId}' not found`);
    }

    this.validateTransition(run.state, toState);

    const updated = await agentRunRepository.updateWorkflowState(runId, {
      state: toState,
      currentStep: metadata?.currentStep ?? toState,
      summary: metadata?.summary,
      plan: metadata?.plan,
      lastError: metadata?.lastError,
      contextSnapshot: metadata?.contextSnapshot,
    });

    if (!updated) {
      throw new Error(`Failed to update workflow run '${runId}'`);
    }

    this.log("state_transition", {
      runId,
      projectId: updated.projectId,
      fromState: run.state,
      toState,
      currentStep: updated.currentStep,
    });

    await activityRepository.create({
      projectId: updated.projectId,
      actorType: "agent",
      actorId: runId,
      eventType: "WORKFLOW_STATE_TRANSITION",
      metadata: {
        runId,
        fromState: run.state,
        toState,
        summary: metadata?.summary,
      },
    });

    return updated;
  }

  /**
   * Pauses the workflow waiting for user approval on consequential actions.
   */
  async pauseForApproval(
    runId: string,
    reason: string,
    approvalId?: string,
    plan?: any
  ): Promise<AgentRun> {
    const run = await agentRunRepository.findById(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    this.validateTransition(run.state, "WAITING_FOR_APPROVAL");

    const updated = await agentRunRepository.updateWorkflowState(runId, {
      state: "WAITING_FOR_APPROVAL",
      currentStep: "WAITING_FOR_APPROVAL",
      waitingReason: reason,
      expectedEventType: "APPROVAL_RESOLVED",
      expectedCorrelationId: approvalId ?? null,
      plan: plan ?? run.plan,
    });

    if (!updated) throw new Error(`Failed to pause workflow run '${runId}'`);

    this.log("workflow_paused", {
      runId,
      state: "WAITING_FOR_APPROVAL",
      reason,
      approvalId,
    });

    return updated;
  }

  /**
   * Pauses the workflow waiting for an external/internal event.
   */
  async pauseForEvent(
    runId: string,
    reason: string,
    expectedEventType: string,
    expectedCorrelationId?: string
  ): Promise<AgentRun> {
    const run = await agentRunRepository.findById(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    this.validateTransition(run.state, "WAITING_FOR_EVENT");

    const updated = await agentRunRepository.updateWorkflowState(runId, {
      state: "WAITING_FOR_EVENT",
      currentStep: "WAITING_FOR_EVENT",
      waitingReason: reason,
      expectedEventType,
      expectedCorrelationId: expectedCorrelationId ?? null,
    });

    if (!updated) throw new Error(`Failed to pause workflow run '${runId}'`);

    this.log("workflow_paused", {
      runId,
      state: "WAITING_FOR_EVENT",
      reason,
      expectedEventType,
      expectedCorrelationId,
    });

    return updated;
  }

  /**
   * Resumes a paused workflow run, retaining the exact same run ID.
   */
  async resumeWorkflow(runId: string, resumeReason?: string): Promise<AgentRun> {
    const run = await agentRunRepository.findById(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    if (run.state !== "WAITING_FOR_APPROVAL" && run.state !== "WAITING_FOR_EVENT") {
      throw new Error(
        `Cannot resume workflow '${runId}' from state '${run.state}'. Expected WAITING_FOR_APPROVAL or WAITING_FOR_EVENT.`
      );
    }

    this.validateTransition(run.state, "RESUMING");

    const resumingRun = await agentRunRepository.updateWorkflowState(runId, {
      state: "RESUMING",
      currentStep: "RESUMING",
      waitingReason: null,
      expectedEventType: null,
      expectedCorrelationId: null,
    });

    if (!resumingRun) throw new Error(`Failed to update workflow '${runId}' to RESUMING`);

    this.log("workflow_resumed", {
      runId,
      previousState: run.state,
      resumeReason: resumeReason ?? "Resumed by operator/event",
    });

    await activityRepository.create({
      projectId: resumingRun.projectId,
      actorType: "agent",
      actorId: runId,
      eventType: "WORKFLOW_RESUMED",
      metadata: { runId, previousState: run.state, resumeReason },
    });

    // Execute next stage after resumption (e.g. EXECUTING -> VERIFYING -> COMPLETED)
    return await this.executeWorkflowStage(resumingRun.id);
  }

  /**
   * Retries a transiently failed workflow or marks it FAILED when retries are exhausted.
   */
  async recordRetry(runId: string, error: string): Promise<AgentRun> {
    const run = await agentRunRepository.findById(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    const newRetryCount = run.retryCount + 1;

    if (newRetryCount > run.maxRetries) {
      this.log("workflow_retries_exhausted", {
        runId,
        retryCount: newRetryCount,
        maxRetries: run.maxRetries,
        error,
      });
      return await this.failWorkflow(
        runId,
        `Max retries (${run.maxRetries}) exceeded: ${error}`
      );
    }

    this.log("workflow_retry", {
      runId,
      retryCount: newRetryCount,
      maxRetries: run.maxRetries,
      error,
    });

    const retried = await agentRunRepository.updateWorkflowState(runId, {
      retryCount: newRetryCount,
      lastError: error,
      state: "PLANNING",
      currentStep: "REPLANNING",
    });

    if (!retried) throw new Error(`Failed to record retry for run '${runId}'`);
    return retried;
  }

  /**
   * Explicitly fails a workflow run.
   */
  async failWorkflow(runId: string, error: string): Promise<AgentRun> {
    const updated = await agentRunRepository.updateWorkflowState(runId, {
      state: "FAILED",
      currentStep: "FAILED",
      lastError: error,
      summary: `Failed: ${error}`,
      completedAt: new Date().toISOString(),
    });

    if (!updated) throw new Error(`Failed to fail workflow run '${runId}'`);

    this.log("workflow_failed", { runId, error });
    return updated;
  }

  /**
   * Explicitly cancels a workflow run.
   */
  async cancelWorkflow(runId: string, reason: string): Promise<AgentRun> {
    const updated = await agentRunRepository.updateWorkflowState(runId, {
      state: "CANCELLED",
      currentStep: "CANCELLED",
      summary: `Cancelled: ${reason}`,
      completedAt: new Date().toISOString(),
    });

    if (!updated) throw new Error(`Failed to cancel workflow run '${runId}'`);

    this.log("workflow_cancelled", { runId, reason });
    return updated;
  }

  /**
   * Ingests and processes an internal/external event with deduplication and waiting workflow resumption.
   */
  async processEvent(input: {
    type: WorkflowEventType | string;
    projectId: string;
    source: string;
    idempotencyKey?: string | null;
    payload?: any;
  }): Promise<{
    event: EventRecord;
    run: AgentRun | null;
    status: "processed" | "resumed" | "ignored";
  }> {
    const { type, projectId, source, idempotencyKey, payload } = input;

    let event: EventRecord;

    // 1. Deduplicate event via idempotency key
    if (idempotencyKey) {
      const existing = await eventRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.status === "processed" || existing.status === "ignored") {
          this.log("duplicate_event_ignored", {
            idempotencyKey,
            existingEventId: existing.id,
            type: existing.type,
          });
          const linkedRun = existing.linkedRunId
            ? await agentRunRepository.findById(existing.linkedRunId)
            : null;
          return { event: existing, run: linkedRun, status: "ignored" };
        }
        // Event was queued/processing: proceed with processing this existing event
        event = existing;
      } else {
        event = await eventRepository.create({
          type,
          projectId,
          source,
          idempotencyKey: idempotencyKey ?? null,
          payload: payload ?? {},
          status: "received",
        });
      }
    } else {
      // 2. Persist event
      event = await eventRepository.create({
        type,
        projectId,
        source,
        idempotencyKey: idempotencyKey ?? null,
        payload: payload ?? {},
        status: "received",
      });
    }

    this.log("event_received", {
      eventId: event.id,
      type: event.type,
      projectId: event.projectId,
      source: event.source,
    });

    // 3. Match against waiting workflows
    const correlationId =
      payload?.correlationId ?? payload?.approvalId ?? payload?.taskId;
    const waitingRun = await agentRunRepository.findWaitingRun(
      projectId,
      type,
      correlationId
    );

    if (waitingRun) {
      this.log("waiting_workflow_matched", {
        eventId: event.id,
        runId: waitingRun.id,
        waitingReason: waitingRun.waitingReason,
      });

      const resumedRun = await this.resumeWorkflow(
        waitingRun.id,
        `Resumed by event ${type} (${event.id})`
      );

      await eventRepository.updateStatus(event.id, "processed", new Date(), resumedRun.id);

      return { event, run: resumedRun, status: "resumed" };
    }

    // 4. If USER_GOAL event, create and execute new workflow
    if (type === "USER_GOAL" && payload?.goal) {
      const { run } = await this.createOrGetRun({
        projectId,
        goal: payload.goal,
        triggerType: type,
        triggerId: event.id,
        idempotencyKey: idempotencyKey ? `goal:${idempotencyKey}` : null,
      });

      const executedRun = await this.executeWorkflowStage(run.id);
      await eventRepository.updateStatus(event.id, "processed", new Date(), executedRun.id);
      return { event, run: executedRun, status: "processed" };
    }

    // 5. If GITHUB_PULL_REQUEST_MERGED event, autonomously formulate goal and execute workflow
    if (type === "GITHUB_PULL_REQUEST_MERGED") {
      const prNumber = payload?.pullRequestNumber ?? payload?.number ?? "PR";
      const prTitle = payload?.title ?? "Pull Request";
      const branch = payload?.targetBranch ?? "main";
      const author = payload?.mergedBy ?? "developer";

      const goal = `GitHub PR #${prNumber} '${prTitle}' was merged into ${branch} by ${author}. Inspect live project state, identify unblocked tasks or required follow-ups, and execute next safe actions.`;

      await activityRepository.log({
        projectId,
        actorType: "system",
        actorId: "github-webhook",
        eventType: "GITHUB_PULL_REQUEST_MERGED",
        metadata: {
          eventId: event.id,
          prNumber,
          prTitle,
          branch,
          author,
          repository: payload?.repository,
        },
      });

      const { run } = await this.createOrGetRun({
        projectId,
        goal,
        triggerType: type,
        triggerId: event.id,
        idempotencyKey: idempotencyKey ? `github-run:${idempotencyKey}` : null,
      });

      const executedRun = await this.executeWorkflowStage(run.id);
      await eventRepository.updateStatus(event.id, "processed", new Date(), executedRun.id);
      return { event, run: executedRun, status: "processed" };
    }

    // Unmatched event marked as processed
    await eventRepository.updateStatus(event.id, "processed", new Date());
    return { event, run: null, status: "processed" };
  }

  /**
   * Non-mutating placeholder execution for Milestone 3A.
   */
  async executePlannedAction(action: any): Promise<{ status: string; action: any }> {
    return {
      status: "NOT_IMPLEMENTED_FOR_MILESTONE_3A",
      action,
    };
  }

  /**
   * Non-mutating placeholder verification for Milestone 3A.
   */
  async verifyPlannedAction(action: any): Promise<{ status: string; action: any }> {
    return {
      status: "NOT_IMPLEMENTED_FOR_MILESTONE_3A",
      action,
    };
  }

  /**
   * Executes the next stages in the workflow lifecycle.
   */
  async executeWorkflowStage(runId: string): Promise<AgentRun> {
    let run = await agentRunRepository.findById(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    const { getActionPolicy } = await import("../../agent/policy/action_registry");
    const { executeCreateSubtask, executeReassignTask, executeSendSlackMessage } = await import(
      "../../agent/tools/mutation_tools"
    );

    try {
      // 1. UNDERSTANDING -> PLANNING via Agent Executor
      if (run.state === "UNDERSTANDING" || run.state === "PLANNING" || run.state === "RESUMING") {
        if (run.state === "UNDERSTANDING") {
          run = await this.transitionState(runId, "PLANNING", {
            currentStep: "ANALYZING_PROJECT",
          });
        }

        // If resuming after approval resolution
        if (run.state === "RESUMING") {
          const pendingApprovals = await approvalRepository.listByRun(run.id);
          const approved = pendingApprovals.find((a) => a.status === "approved");
          if (approved && approved.action === "reassign_task") {
            run = await this.transitionState(run.id, "EXECUTING", {
              currentStep: "EXECUTING_REASSIGNMENT",
            });

            const mutationRes = await executeReassignTask({
              projectId: run.projectId,
              action: approved.payload,
              approvedBy: approved.approvedBy || "Human Operator",
              agentRunId: run.id,
            });

            if (!mutationRes.verified) {
              throw new Error(`Mutation verification failed: ${mutationRes.error}`);
            }

            run = await this.transitionState(run.id, "VERIFYING", {
              currentStep: "VERIFYING_REASSIGNMENT",
            });

            run = await this.transitionState(run.id, "COMPLETED", {
              currentStep: "COMPLETED",
              summary: `Successfully reassigned task ${mutationRes.taskId} to ${mutationRes.newAssignee} with human approval and database verification.`,
            });

            return run;
          }
        }

        // Run planner agent
        const result = await executeTaskmasterAgent({
          projectId: run.projectId,
          goal: run.goal,
          runId: run.id,
        });

        if (result.state === "FAILED") {
          return (await agentRunRepository.findById(runId))!;
        }

        if (result.plan) {
          const rawActions = result.plan.proposedActions || [];
          const categorization = (await import("../../agent/policy/action_registry")).categorizeProposedActions(
            rawActions
          );

          const {
            proposedActions,
            allowedAutoActions,
            cappedToReviewActions,
            reviewRequiredActions,
            blockedActions,
          } = categorization;

          // If any action requires approval (or was converted from auto due to cap), pause in WAITING_FOR_APPROVAL
          const pendingApprovalList = [...reviewRequiredActions, ...cappedToReviewActions];
          if (pendingApprovalList.length > 0) {
            const firstApprovalAction = pendingApprovalList[0];
            const policy = getActionPolicy(firstApprovalAction);
            const approval = await approvalRepository.create({
              agentRunId: run.id,
              action: firstApprovalAction.actionType,
              payload: firstApprovalAction,
              riskLevel: policy.riskLevel,
            });

            await agentRunRepository.updateWorkflowState(run.id, {
              contextSnapshot: {
                proposedActions,
                allowedActions: allowedAutoActions,
                executedActions: [],
                blockedActions,
                awaitingApprovalActions: pendingApprovalList,
              },
            });

            return await this.pauseForApproval(
              run.id,
              `Awaiting human approval for ${firstApprovalAction.actionType}.`,
              approval.id,
              result.plan
            );
          }

          // If all actions are automatic (e.g. create_subtask), execute only allowed auto actions (up to cap)
          run = await this.transitionState(run.id, "EXECUTING", {
            currentStep: "EXECUTING_AUTO_MUTATIONS",
            plan: result.plan,
            summary: result.summary,
            contextSnapshot: {
              proposedActions,
              allowedActions: allowedAutoActions,
              executedActions: [],
              blockedActions,
              awaitingApprovalActions: [],
            },
          });

          const executedActions: any[] = [];
          let projectMutationsSucceeded = true;

          // 1. Primary project database mutations
          for (const action of allowedAutoActions) {
            if (action.actionType === "create_subtask") {
              const res = await executeCreateSubtask({
                projectId: run.projectId,
                action,
                agentRunId: run.id,
              });
              if (!res.verified) {
                projectMutationsSucceeded = false;
                throw new Error(`Subtask verification failed: ${res.error}`);
              }
              executedActions.push(res);
            }
          }

          // 2. External action sinks (e.g. send_slack_message)
          for (const action of allowedAutoActions) {
            if (action.actionType === "send_slack_message") {
              const res = await executeSendSlackMessage({
                projectId: run.projectId,
                action,
                agentRunId: run.id,
                projectMutationVerified: projectMutationsSucceeded,
              });
              executedActions.push(res);
            }
          }

          run = await this.transitionState(run.id, "VERIFYING", {
            currentStep: "VERIFYING_RESULTS",
            contextSnapshot: {
              proposedActions,
              allowedActions: allowedAutoActions,
              executedActions,
              blockedActions,
              awaitingApprovalActions: [],
            },
          });

          run = await this.transitionState(run.id, "COMPLETED", {
            currentStep: "COMPLETED",
            summary: result.summary,
            contextSnapshot: {
              proposedActions,
              allowedActions: allowedAutoActions,
              executedActions,
              blockedActions,
              awaitingApprovalActions: [],
            },
          });

          return run;
        }
      }

      return run;
    } catch (err: any) {
      return await this.recordRetry(runId, err.message || "Execution failure");
    }
  }
}

export const workflowService = new WorkflowService();

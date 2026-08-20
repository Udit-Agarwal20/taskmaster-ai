import { taskRepository, dependencyRepository } from "../../db/repositories";

export type ProjectAnalysis = {
  risk: "HIGH" | "MEDIUM" | "LOW";
  blockers: number;
  deadlineRisks: number;
  bottleneck: { name: string; count: number };
  workload: Record<string, number>;
  dependencies: Array<{ from: string; to: string }>;
};

export class ProjectAnalysisService {
  async analyze(projectId: string): Promise<ProjectAnalysis> {
    const tasks = await taskRepository.listByProject(projectId);
    const deps = await dependencyRepository.listByProject(projectId);

    const blockers = tasks.filter((t) => t.blocked);
    const overdue = tasks.filter(
      (t) => (t.dueDate === "Today" || t.dueDate === "today") && t.status !== "done"
    );

    const workload = tasks.reduce<Record<string, number>>((acc, t) => {
      const assigneeName = t.assignee || "Unassigned";
      acc[assigneeName] = (acc[assigneeName] ?? 0) + 1;
      return acc;
    }, {});

    const sortedWorkload = Object.entries(workload).sort((a, b) => b[1] - a[1]);
    const bottleneckEntry = sortedWorkload[0] ?? ["Unknown", 0];

    const bottleneck = {
      name: bottleneckEntry[0],
      count: Number(bottleneckEntry[1]),
    };

    let risk: "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (blockers.length >= 3 || bottleneck.count >= 4) {
      risk = "HIGH";
    } else if (blockers.length > 0) {
      risk = "MEDIUM";
    }

    const dependencies = deps.map((d) => ({
      from: d.from,
      to: d.to,
    }));

    return {
      risk,
      blockers: blockers.length,
      deadlineRisks: overdue.length,
      bottleneck,
      workload,
      dependencies,
    };
  }
}

export const projectAnalysisService = new ProjectAnalysisService();

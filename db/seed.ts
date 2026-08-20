import {
  userRepository,
  projectRepository,
  taskRepository,
  dependencyRepository,
  activityRepository,
} from "./repositories";
import { query, closePool, runSchemaMigration } from "./client";

export const DEMO_PROJECT_ID = "student-marketplace";

export const DEMO_USERS = [
  { id: "user-udit", name: "Udit", email: "udit@taskmaster.dev", role: "owner" },
  { id: "user-rahul", name: "Rahul", email: "rahul@taskmaster.dev", role: "member" },
  { id: "user-maya", name: "Maya", email: "maya@taskmaster.dev", role: "member" },
  { id: "user-alex", name: "Alex", email: "alex@taskmaster.dev", role: "member" },
  { id: "user-sara", name: "Sara", email: "sara@taskmaster.dev", role: "member" },
  { id: "user-arjun", name: "Arjun", email: "arjun@taskmaster.dev", role: "member" },
];

export const DEMO_TASKS = [
  {
    id: "1",
    projectId: DEMO_PROJECT_ID,
    title: "Finalize pricing approval",
    description: "Get final pricing sign-off from finance and leadership.",
    status: "todo" as const,
    priority: "high" as const,
    assignee: "Alex",
    assigneeId: "user-alex",
    dueDate: "Today",
    blocked: true,
  },
  {
    id: "2",
    projectId: DEMO_PROJECT_ID,
    title: "Payment integration",
    description: "Implement checkout and payment webhooks.",
    status: "doing" as const,
    priority: "high" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: true,
  },
  {
    id: "3",
    projectId: DEMO_PROJECT_ID,
    title: "Landing page",
    description: "Finish launch landing page and responsive layout.",
    status: "doing" as const,
    priority: "high" as const,
    assignee: "Maya",
    assigneeId: "user-maya",
    dueDate: "Thursday",
    blocked: false,
  },
  {
    id: "4",
    projectId: DEMO_PROJECT_ID,
    title: "Analytics events",
    description: "Instrument launch analytics and conversion funnels.",
    status: "review" as const,
    priority: "medium" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Thursday",
    blocked: false,
  },
  {
    id: "5",
    projectId: DEMO_PROJECT_ID,
    title: "Launch QA",
    description: "Run final regression and release checks.",
    status: "todo" as const,
    priority: "medium" as const,
    assignee: "Sara",
    assigneeId: "user-sara",
    dueDate: "Friday",
    blocked: true,
  },
  {
    id: "6",
    projectId: DEMO_PROJECT_ID,
    title: "Production deployment",
    description: "Prepare and deploy production release pipeline.",
    status: "done" as const,
    priority: "medium" as const,
    assignee: "Arjun",
    assigneeId: "user-arjun",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "7",
    projectId: DEMO_PROJECT_ID,
    title: "User authentication hardening",
    description: "Audit OAuth tokens and session expiration.",
    status: "todo" as const,
    priority: "high" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Today",
    blocked: true,
  },
  {
    id: "8",
    projectId: DEMO_PROJECT_ID,
    title: "Search and filtering API",
    description: "Optimize search indexing for student listings.",
    status: "doing" as const,
    priority: "medium" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "9",
    projectId: DEMO_PROJECT_ID,
    title: "Image upload & compression pipeline",
    description: "Setup Cloud Storage image processing.",
    status: "todo" as const,
    priority: "medium" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "10",
    projectId: DEMO_PROJECT_ID,
    title: "Email notification triggers",
    description: "Configure transactional email templates.",
    status: "todo" as const,
    priority: "low" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "11",
    projectId: DEMO_PROJECT_ID,
    title: "Seller verification flow",
    description: "Build student ID verification backend.",
    status: "todo" as const,
    priority: "high" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Today",
    blocked: false,
  },
  {
    id: "12",
    projectId: DEMO_PROJECT_ID,
    title: "Order dispute workflow",
    description: "Implement dispute resolution endpoints.",
    status: "todo" as const,
    priority: "medium" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "13",
    projectId: DEMO_PROJECT_ID,
    title: "Database index tuning",
    description: "Analyze slow query logs on PostgreSQL.",
    status: "doing" as const,
    priority: "medium" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Thursday",
    blocked: false,
  },
  {
    id: "14",
    projectId: DEMO_PROJECT_ID,
    title: "Rate limiting & bot protection",
    description: "Implement Redis token bucket rate limiting.",
    status: "todo" as const,
    priority: "medium" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "15",
    projectId: DEMO_PROJECT_ID,
    title: "Websocket live bidding engine",
    description: "Deploy socket server for live auction items.",
    status: "doing" as const,
    priority: "high" as const,
    assignee: "Rahul",
    assigneeId: "user-rahul",
    dueDate: "Friday",
    blocked: false,
  },
  {
    id: "16",
    projectId: DEMO_PROJECT_ID,
    title: "Mobile responsive checkout",
    description: "Fix cart drawer on mobile viewports.",
    status: "doing" as const,
    priority: "high" as const,
    assignee: "Maya",
    assigneeId: "user-maya",
    dueDate: "Thursday",
    blocked: false,
  },
  {
    id: "17",
    projectId: DEMO_PROJECT_ID,
    title: "Marketing launch sequence",
    description: "Prepare announcement emails and campus flyers.",
    status: "todo" as const,
    priority: "medium" as const,
    assignee: "Alex",
    assigneeId: "user-alex",
    dueDate: "Friday",
    blocked: false,
  },
];

export const DEMO_DEPENDENCIES = [
  { id: "dep-1", taskId: "2", dependsOnTaskId: "1", type: "blocks" },
  { id: "dep-2", taskId: "5", dependsOnTaskId: "2", type: "blocks" },
  { id: "dep-3", taskId: "6", dependsOnTaskId: "5", type: "blocks" },
  { id: "dep-4", taskId: "11", dependsOnTaskId: "7", type: "blocks" },
  { id: "dep-5", taskId: "12", dependsOnTaskId: "2", type: "blocks" },
  { id: "dep-6", taskId: "5", dependsOnTaskId: "3", type: "blocks" },
  { id: "dep-7", taskId: "5", dependsOnTaskId: "16", type: "blocks" },
  { id: "dep-8", taskId: "17", dependsOnTaskId: "3", type: "blocks" },
];

export async function seed() {
  console.log("Seeding Taskmaster demo database…");

  // Ensure tables exist
  await runSchemaMigration();

  // Clean existing demo data deterministically
  await query("DELETE FROM projects WHERE id = $1", [DEMO_PROJECT_ID]);

  // 1. Seed Users
  for (const user of DEMO_USERS) {
    await userRepository.upsert({
      id: user.id,
      name: user.name,
      email: user.email,
    });
  }
  console.log(`✓ Seeded ${DEMO_USERS.length} team members`);

  // 2. Seed Project
  await projectRepository.upsert({
    id: DEMO_PROJECT_ID,
    name: "Student Marketplace Launch",
    description: "Launch the student marketplace product by Friday.",
    deadline: "Friday",
    status: "active",
    ownerId: "user-udit",
  });

  for (const user of DEMO_USERS) {
    await projectRepository.addMember(DEMO_PROJECT_ID, user.id, user.role);
  }
  console.log(`✓ Seeded project: Student Marketplace Launch`);

  // 3. Seed Tasks
  for (const task of DEMO_TASKS) {
    await taskRepository.upsert(task);
  }
  console.log(`✓ Seeded ${DEMO_TASKS.length} tasks`);

  // 4. Seed Dependencies
  for (const dep of DEMO_DEPENDENCIES) {
    await dependencyRepository.create(dep.taskId, dep.dependsOnTaskId, dep.type, dep.id);
  }
  console.log(`✓ Seeded ${DEMO_DEPENDENCIES.length} dependencies`);

  // 5. Initial Activity Log
  await activityRepository.log({
    projectId: DEMO_PROJECT_ID,
    actorType: "system",
    eventType: "PROJECT_SEEDED",
    metadata: {
      tasksCount: DEMO_TASKS.length,
      dependenciesCount: DEMO_DEPENDENCIES.length,
      membersCount: DEMO_USERS.length,
    },
  });

  console.log("✓ Demo dataset successfully seeded!");
}

if (require.main === module) {
  seed()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("✗ Seeding failed:", err.message);
      await closePool();
      process.exit(1);
    });
}

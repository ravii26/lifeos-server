/* =====================================================================
   Personal Knowledge Graph — GET /graph

   Returns a nodes + edges representation of all the user's interconnected
   entities so the frontend can render a force-directed or hierarchical
   graph visualization.

   Node types:  AREA · GOAL · PROJECT · TASK · HABIT · TOPIC · NOTEBOOK · NOTE · RESOURCE
   Edge types:  AREA_GOAL · AREA_HABIT · AREA_TOPIC · GOAL_PROJECT · PROJECT_TASK ·
                AREA_TASK · TOPIC_TASK · TOPIC_NOTEBOOK · TOPIC_NOTE · TOPIC_RESOURCE ·
                RESOURCE_NOTE
   (Vault items are intentionally excluded — they have no structural links and
    would render as floating nodes in a connections graph.)
   ===================================================================== */
import prisma from "../../lib/prisma.js"

export type NodeType =
  | "AREA"
  | "GOAL"
  | "PROJECT"
  | "TASK"
  | "HABIT"
  | "TOPIC"
  | "NOTEBOOK"
  | "NOTE"
  | "RESOURCE"
export type EdgeType =
  | "AREA_GOAL"
  | "AREA_HABIT"
  | "AREA_TOPIC"
  | "GOAL_PROJECT"
  | "PROJECT_TASK"
  | "AREA_TASK"
  | "TOPIC_TASK"     // task linked to topic via LEARN source
  | "TOPIC_NOTEBOOK"
  | "TOPIC_NOTE"
  | "TOPIC_RESOURCE"
  | "RESOURCE_NOTE"

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  data: Record<string, unknown>
}

export interface GraphEdge {
  source: string
  target: string
  relation: EdgeType
}

export interface GraphResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  counts: Record<NodeType, number>
  generatedAt: Date
}

export const getGraphService = async (userId: string): Promise<GraphResult> => {
  const [areas, goals, projects, tasks, habits, topics, notebooks, notes, resources] =
    await Promise.all([
    prisma.area.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, color: true, icon: true, isActive: true },
    }),
    prisma.goal.findMany({
      where: { userId },
      select: { id: true, title: true, areaId: true, status: true, priority: true },
    }),
    prisma.project.findMany({
      where: { userId },
      select: { id: true, title: true, areaId: true, goalId: true, status: true },
    }),
    prisma.task.findMany({
      where: { userId },
      select: { id: true, title: true, areaId: true, goalId: true, projectId: true, status: true, source: true, sourceId: true },
      take: 50, // cap tasks to keep the graph renderable
      orderBy: { createdAt: "desc" },
    }),
    prisma.habit.findMany({
      where: { userId },
      select: { id: true, title: true, areaId: true, isActive: true, habitType: true },
    }),
    prisma.topic.findMany({
      where: { userId },
      select: { id: true, title: true, areaId: true, masteryLevel: true },
    }),
    prisma.notebook.findMany({
      where: { userId },
      select: { id: true, title: true, topicId: true },
    }),
    prisma.note.findMany({
      where: { userId },
      select: { id: true, title: true, topicId: true, noteType: true, resourceId: true },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    prisma.resource.findMany({
      where: { userId },
      select: { id: true, title: true, topicId: true, resourceType: true, status: true },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
  ])

  const nodes: GraphNode[] = [
    ...areas.map((a) => ({
      id: a.id,
      type: "AREA" as NodeType,
      label: a.name,
      data: { color: a.color, icon: a.icon, isActive: a.isActive, areaType: a.type },
    })),
    ...goals.map((g) => ({
      id: g.id,
      type: "GOAL" as NodeType,
      label: g.title,
      data: { status: g.status, priority: g.priority, areaId: g.areaId },
    })),
    ...projects.map((p) => ({
      id: p.id,
      type: "PROJECT" as NodeType,
      label: p.title,
      data: { status: p.status, areaId: p.areaId, goalId: p.goalId },
    })),
    ...tasks.map((t) => ({
      id: t.id,
      type: "TASK" as NodeType,
      label: t.title,
      data: { status: t.status, source: t.source },
    })),
    ...habits.map((h) => ({
      id: h.id,
      type: "HABIT" as NodeType,
      label: h.title,
      data: { isActive: h.isActive, habitType: h.habitType },
    })),
    ...topics.map((tp) => ({
      id: tp.id,
      type: "TOPIC" as NodeType,
      label: tp.title,
      data: { masteryLevel: tp.masteryLevel, areaId: tp.areaId },
    })),
    ...notebooks.map((nb) => ({
      id: nb.id,
      type: "NOTEBOOK" as NodeType,
      label: nb.title,
      data: { topicId: nb.topicId },
    })),
    ...notes.map((n) => ({
      id: n.id,
      type: "NOTE" as NodeType,
      label: n.title,
      data: { noteType: n.noteType, topicId: n.topicId },
    })),
    ...resources.map((r) => ({
      id: r.id,
      type: "RESOURCE" as NodeType,
      label: r.title,
      data: { resourceType: r.resourceType, status: r.status, topicId: r.topicId },
    })),
  ]

  const edges: GraphEdge[] = []

  for (const g of goals) {
    if (g.areaId) edges.push({ source: g.areaId, target: g.id, relation: "AREA_GOAL" })
  }
  for (const p of projects) {
    if (p.goalId) edges.push({ source: p.goalId, target: p.id, relation: "GOAL_PROJECT" })
    else if (p.areaId) edges.push({ source: p.areaId, target: p.id, relation: "AREA_GOAL" })
  }
  for (const t of tasks) {
    if (t.projectId) edges.push({ source: t.projectId, target: t.id, relation: "PROJECT_TASK" })
    else if (t.areaId) edges.push({ source: t.areaId, target: t.id, relation: "AREA_TASK" })
  }
  for (const h of habits) {
    edges.push({ source: h.areaId, target: h.id, relation: "AREA_HABIT" })
  }
  for (const tp of topics) {
    edges.push({ source: tp.areaId, target: tp.id, relation: "AREA_TOPIC" })
  }
  for (const nb of notebooks) {
    edges.push({ source: nb.topicId, target: nb.id, relation: "TOPIC_NOTEBOOK" })
  }
  for (const n of notes) {
    edges.push({ source: n.topicId, target: n.id, relation: "TOPIC_NOTE" })
  }
  for (const r of resources) {
    edges.push({ source: r.topicId, target: r.id, relation: "TOPIC_RESOURCE" })
  }

  // Note → its source resource, only when that resource is a node in this graph
  // (resources are capped, so guard against a dangling edge).
  const resourceIds = new Set(resources.map((r) => r.id))
  for (const n of notes) {
    if (n.resourceId && resourceIds.has(n.resourceId)) {
      edges.push({ source: n.resourceId, target: n.id, relation: "RESOURCE_NOTE" })
    }
  }

  // LEARN-sourced tasks → the topic of the note they were created from. The
  // source note may be outside the capped notes set, so look it up directly.
  const learnTasks = tasks.filter((t) => t.source === "LEARN" && t.sourceId)
  if (learnTasks.length) {
    const sourceNotes = await prisma.note.findMany({
      where: { userId, id: { in: learnTasks.map((t) => t.sourceId!) } },
      select: { id: true, topicId: true },
    })
    const topicByNote = new Map(sourceNotes.map((sn) => [sn.id, sn.topicId]))
    for (const t of learnTasks) {
      const topicId = topicByNote.get(t.sourceId!)
      if (topicId) edges.push({ source: topicId, target: t.id, relation: "TOPIC_TASK" })
    }
  }

  const counts: Record<NodeType, number> = {
    AREA: areas.length,
    GOAL: goals.length,
    PROJECT: projects.length,
    TASK: tasks.length,
    HABIT: habits.length,
    TOPIC: topics.length,
    NOTEBOOK: notebooks.length,
    NOTE: notes.length,
    RESOURCE: resources.length,
  }

  return { nodes, edges, counts, generatedAt: new Date() }
}

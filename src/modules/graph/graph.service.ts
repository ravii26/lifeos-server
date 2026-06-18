/* =====================================================================
   Personal Knowledge Graph — GET /graph

   Returns a nodes + edges representation of all the user's interconnected
   entities so the frontend can render a force-directed or hierarchical
   graph visualization.

   Node types:  AREA · GOAL · PROJECT · TASK · HABIT · TOPIC · NOTEBOOK · NOTE
   Edge types:  AREA_GOAL · AREA_HABIT · AREA_TOPIC · GOAL_PROJECT ·
                PROJECT_TASK · AREA_TASK · TOPIC_NOTEBOOK · TOPIC_NOTE
   ===================================================================== */
import prisma from "../../lib/prisma.js"

export type NodeType = "AREA" | "GOAL" | "PROJECT" | "TASK" | "HABIT" | "TOPIC" | "NOTEBOOK" | "NOTE"
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
  const [areas, goals, projects, tasks, habits, topics, notebooks, notes] = await Promise.all([
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
      select: { id: true, title: true, areaId: true, goalId: true, projectId: true, status: true, source: true },
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
      select: { id: true, title: true, topicId: true, noteType: true },
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

  const counts: Record<NodeType, number> = {
    AREA: areas.length,
    GOAL: goals.length,
    PROJECT: projects.length,
    TASK: tasks.length,
    HABIT: habits.length,
    TOPIC: topics.length,
    NOTEBOOK: notebooks.length,
    NOTE: notes.length,
  }

  return { nodes, edges, counts, generatedAt: new Date() }
}

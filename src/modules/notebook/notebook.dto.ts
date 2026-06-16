// Response DTO — the shape the server returns for a Notebook.
export interface NotebookDto {
  id: string
  topicId: string
  title: string
  description: string | null
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

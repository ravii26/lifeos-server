// Response DTO — the shape the server returns for a Note.
export interface NoteDto {
  id: string
  topicId: string
  notebookId: string | null
  resourceId: string | null
  title: string
  content: string
  noteType: string
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

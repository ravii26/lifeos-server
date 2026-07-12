// Response DTO — the shape the server returns for an EntityLink.
export interface LinkDto {
  id: string
  fromType: string
  fromId: string
  toType: string
  toId: string
  role: string
  weight: number | null
  createdAt: Date
}

// List responses are enriched with each endpoint's human label so the client
// can render a chip ("↳ advances GOAL: lose weight") without having to load
// every goal/resource/note list itself to resolve a bare id.
export interface EnrichedLinkDto extends LinkDto {
  fromLabel: string
  toLabel: string
}

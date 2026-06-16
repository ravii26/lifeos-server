import { findIdentityByUser, upsertIdentity } from "./identity.repository.js"
import type { UpsertIdentityDto } from "./identity.schema.js"
import type { IdentityDto } from "./identity.dto.js"

// Returns the user's identity, or null if they haven't created one yet.
export const getIdentityService = (userId: string): Promise<IdentityDto | null> => {
  return findIdentityByUser(userId)
}

export const upsertIdentityService = (
  userId: string,
  input: UpsertIdentityDto,
): Promise<IdentityDto> => {
  return upsertIdentity(userId, input)
}

import { findDecisionContext } from "./decisions.repository.js"
import { getDecisions } from "./decisions.ai.js"
import type { DecisionResult } from "./decisions.ai.js"

export const getDecisionsService = async (userId: string): Promise<DecisionResult> => {
  const context = await findDecisionContext(userId)
  return getDecisions(context)
}

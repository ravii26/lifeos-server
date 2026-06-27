import { Router } from "express"
import {
  createVaultItemController,
  listVaultItemsController,
  getVaultItemController,
  updateVaultItemController,
  deleteVaultItemController,
  markVaultItemUsedController,
  markVaultItemHelpfulController,
} from "./vault.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createVaultItemSchema,
  updateVaultItemSchema,
  listVaultItemsSchema,
} from "./vault.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createVaultItemSchema), createVaultItemController)
router.get("/", validateQuery(listVaultItemsSchema), listVaultItemsController)
router.get("/:id", getVaultItemController)
router.patch("/:id", validate(updateVaultItemSchema), updateVaultItemController)
router.post("/:id/used", markVaultItemUsedController)
router.post("/:id/helpful", markVaultItemHelpfulController)
router.delete("/:id", deleteVaultItemController)

export default router

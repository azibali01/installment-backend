import express, { type Request, type Response } from "express"
import { authenticate, authorize } from "../middleware/auth.js"
import RolePermission from "../models/RolePermission.js"

const router = express.Router()


router.get("/", authenticate, authorize(["admin"]), async (req: Request, res: Response) => {
    try {
        const roles = await RolePermission.find()
        res.json(roles)
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch roles" })
    }
})


router.get("/:role", authenticate, authorize(["admin"]), async (req: Request, res: Response) => {
    try {
        const rp = await RolePermission.findOne({ role: req.params.role })
        if (!rp) return res.status(404).json({ error: "Role not found" })
        res.json(rp)
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch role" })
    }
})


router.put("/:role", authenticate, authorize(["admin"]), async (req: Request, res: Response) => {
    try {
        const { permissions } = req.body
        if (!Array.isArray(permissions)) return res.status(400).json({ error: "permissions must be an array" })

        const rp = await RolePermission.findOneAndUpdate(
            { role: req.params.role },
            { $set: { permissions } },
            { upsert: true, new: true },
        )

        res.json(rp)
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update role" })
    }
})

export default router

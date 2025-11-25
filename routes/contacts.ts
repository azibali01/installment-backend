import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import ContactLog from "../models/ContactLog.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import mongoose from "mongoose"

const router = express.Router()

router.post("/", authenticate, authorizePermission("manage_installments"), async (req: Request, res: Response) => {
    try {
        const { planId, scheduleIndex, response, nextContactDate, contactMethod, notes } = req.body
        if (!planId) return res.status(400).json({ error: "planId required" })

        const session = await mongoose.startSession()
        session.startTransaction()
        try {
            const plan = await InstallmentPlan.findById(planId).session(session)
            if (!plan) {
                await session.abortTransaction()
                session.endSession()
                return res.status(404).json({ error: "Plan not found" })
            }

            if (typeof scheduleIndex === "number" && (scheduleIndex < 0 || scheduleIndex >= plan.installmentSchedule.length)) {
                await session.abortTransaction()
                session.endSession()
                return res.status(400).json({ error: "invalid scheduleIndex" })
            }

            const created = await ContactLog.create([
                {
                    planId,
                    customerId: plan.customerId,
                    scheduleIndex,
                    contactedBy: req.user?.id,
                    response,
                    contactMethod,
                    nextContactDate: nextContactDate ? new Date(nextContactDate) : undefined,
                    notes,
                },
            ], { session })

            await session.commitTransaction()
            session.endSession()

            const populated = await ContactLog.findById(created[0]._id).populate('contactedBy', 'name email role')
            res.status(201).json({ success: true, log: populated })
        } catch (err) {
            await session.abortTransaction()
            session.endSession()
            throw err
        }
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create contact log" })
    }
})

router.get("/", authenticate, authorizePermission("view_reports"), async (req: Request, res: Response) => {
    try {
        const { planId, customerId } = req.query as any
        const q: any = {}
        if (planId) q.planId = planId
        if (customerId) q.customerId = customerId

        const page = Math.max(1, Number(req.query.page) || 1)
        const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20))
        const total = await ContactLog.countDocuments(q)
        const logs = await ContactLog.find(q)
            .populate('contactedBy', 'name email role')
            .sort({ contactDate: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)

        res.json({ logs, total, page, pageSize })
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch contact logs" })
    }
})

export default router

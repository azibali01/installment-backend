import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import InstallmentRequest from "../models/InstallmentRequest.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import { body, param, query } from "express-validator"
import { validateRequest } from "../middleware/validate.js"
import mongoose from "mongoose"

const router = express.Router()


router.post(
    "/",
    authenticate,
    [
        body("installmentId").notEmpty().isMongoId().withMessage("installmentId is required"),
        body("type").isIn(["edit", "delete"]).withMessage("type must be 'edit' or 'delete'"),
        validateRequest,
    ],
    async (req: Request, res: Response) => {
        try {
            const { installmentId, type, changes, reason } = req.body

            const creatorRole = req.user?.role
            const isPrivileged = creatorRole === "admin" || creatorRole === "manager"

            const reqDoc = new InstallmentRequest({
                installmentId,
                type,
                changes: changes || undefined,
                reason,
                requestedBy: req.user?.id,
            })


            if (isPrivileged) {
                if (type === "edit") {
                    await InstallmentPlan.findByIdAndUpdate(installmentId, changes || {}, { new: true })
                } else if (type === "delete") {
                    await InstallmentPlan.findByIdAndDelete(installmentId)
                }
                reqDoc.status = "approved"
                reqDoc.reviewedBy = req.user?.id as any
                reqDoc.reviewedAt = new Date()
            }

            await reqDoc.save()
            res.status(201).json(reqDoc)
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create request" })
        }
    },
)


router.get(
    "/",
    authenticate,
    authorizePermission("manage_installments"),
    async (req: Request, res: Response) => {
        try {
            const { status } = req.query as { status?: string }
            const page = Number.parseInt((req.query.page as string) || "1") || 1
            const limit = Number.parseInt((req.query.limit as string) || "20") || 20
            const filter: Record<string, any> = {}
            if (status) filter.status = status

            const total = await InstallmentRequest.countDocuments(filter)
            const list = await InstallmentRequest.find(filter)
                .populate({
                    path: "installmentId",
                    populate: [
                        { path: "customerId", select: "name" },
                        { path: "productId", select: "name" },
                    ],
                })
                .populate({ path: "requestedBy", select: "name" })
                .populate({ path: "reviewedBy", select: "name" })
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)

            res.json({ data: list, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch requests" })
        }
    },
)


router.put(
    "/:id/approve",
    authenticate,
    authorizePermission("manage_installments"),
    [param("id").isMongoId().withMessage("Invalid request id"), validateRequest],
    async (req: Request, res: Response) => {
        const session = await mongoose.startSession()
        session.startTransaction()
        try {
            const r = await InstallmentRequest.findById(req.params.id).session(session)
            if (!r) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ error: "Request not found" })
            }
            if (r.status !== "pending") {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ error: "Request not pending" })
            }
            if (r.type === "edit") {
                await InstallmentPlan.findByIdAndUpdate(r.installmentId, r.changes || {}, { new: true, session })
            } else if (r.type === "delete") {
                await InstallmentPlan.findByIdAndDelete(r.installmentId, { session })
            }
            r.status = "approved"
            r.reviewedBy = req.user?.id as any
            r.reviewedAt = new Date()
            await r.save({ session })
            await session.commitTransaction(); session.endSession();
            res.json(r)
        } catch (error) {
            await session.abortTransaction(); session.endSession();
            res.status(500).json({ error: error instanceof Error ? error.message : "Failed to approve request" })
        }
    },
)


router.put(
    "/:id/reject",
    authenticate,
    authorizePermission("manage_installments"),
    [param("id").isMongoId().withMessage("Invalid request id"), validateRequest],
    async (req: Request, res: Response) => {
        try {
            const r = await InstallmentRequest.findById(req.params.id)
            if (!r) return res.status(404).json({ error: "Request not found" })
            if (r.status !== "pending") return res.status(400).json({ error: "Request not pending" })

            r.status = "rejected"
            r.reviewedBy = req.user?.id as any
            r.reviewedAt = new Date()
            r.reviewComment = req.body.reviewComment
            await r.save()

            res.json(r)
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Failed to reject request" })
        }
    },
)

export default router

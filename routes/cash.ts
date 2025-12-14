import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import User from "../models/User.js"
import CashTransfer from "../models/CashTransfer.js"
import { body, param, query } from "express-validator"
import { validateRequest } from "../middleware/validate.js"
import { asyncHandler } from "../middleware/asyncHandler.js"
import { NotFoundError, ValidationError, ForbiddenError } from "../utils/errors.js"

const router = express.Router()

// Get own cash balance
router.get("/balance", authenticate, asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user?.id).select("cashBalance name email role")
  if (!user) throw new NotFoundError("User")
  res.json({ balance: user.cashBalance, user: { name: user.name, email: user.email, role: user.role } })
}))

// Get all users' balances (admin only)
router.get("/balances", authenticate, authorizePermission("manage_users"), asyncHandler(async (req: Request, res: Response) => {
  const users = await User.find({ isActive: true }).select("name email role cashBalance").sort({ role: 1, name: 1 })
  res.json(users)
}))

// Transfer cash
router.post(
  "/transfer",
  authenticate,
  [
    body("toUserId").notEmpty().isMongoId().withMessage("Valid recipient user ID is required"),
    body("amount").isFloat({ min: 0.01 }).withMessage("Amount must be greater than 0"),
    body("notes").optional().isString().isLength({ max: 500 }).withMessage("Notes must be less than 500 characters"),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { toUserId, amount, notes } = req.body
    const fromUserId = req.user?.id

    if (!fromUserId) throw new ForbiddenError("User not authenticated")

    // Get sender and recipient
    const fromUser = await User.findById(fromUserId)
    const toUser = await User.findById(toUserId)

    if (!fromUser) throw new NotFoundError("Sender user")
    if (!toUser) throw new NotFoundError("Recipient user")
    if (!toUser.isActive) throw new ValidationError("Recipient user is not active")

    // Check if sender has enough balance
    if (fromUser.cashBalance < amount) {
      throw new ValidationError("Insufficient cash balance")
    }

    // Validate transfer rules based on roles
    const fromRole = fromUser.role
    const toRole = toUser.role

    // Employee can only transfer to manager or admin
    if (fromRole === "employee" && toRole !== "manager" && toRole !== "admin") {
      throw new ForbiddenError("Employees can only transfer cash to managers or admins")
    }

    // Manager can only transfer to admin
    if (fromRole === "manager" && toRole !== "admin") {
      throw new ForbiddenError("Managers can only transfer cash to admins")
    }

    // Admin can transfer to anyone (no restriction)

    // Perform transfer (atomic operation)
    const session = await User.startSession()
    session.startTransaction()

    try {
      // Deduct from sender
      await User.findByIdAndUpdate(fromUserId, { $inc: { cashBalance: -amount } }, { session })

      // Add to recipient
      await User.findByIdAndUpdate(toUserId, { $inc: { cashBalance: amount } }, { session })

      // Create transfer record
      const transfer = new CashTransfer({
        fromUser: fromUserId,
        toUser: toUserId,
        amount,
        notes: notes || undefined,
        status: "completed",
        createdBy: fromUserId,
      })
      await transfer.save({ session })

      await session.commitTransaction()

      // Get updated balances
      const updatedFrom = await User.findById(fromUserId).select("cashBalance")
      const updatedTo = await User.findById(toUserId).select("cashBalance")

      res.status(201).json({
        message: "Cash transferred successfully",
        transfer: {
          id: transfer._id,
          from: { id: fromUser._id, name: fromUser.name, balance: updatedFrom?.cashBalance },
          to: { id: toUser._id, name: toUser.name, balance: updatedTo?.cashBalance },
          amount,
          notes: transfer.notes,
          createdAt: transfer.createdAt,
        },
      })
    } catch (error) {
      await session.abortTransaction()
      throw error
    } finally {
      session.endSession()
    }
  }),
)

// Get transfer history
router.get(
  "/transfers",
  authenticate,
  [
    query("userId").optional().isMongoId().withMessage("userId must be a valid id"),
    query("type").optional().isIn(["sent", "received", "all"]).withMessage("type must be sent, received, or all"),
    query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const currentUserId = req.user?.id
    const { userId, type = "all" } = req.query as { userId?: string; type?: string }
    const page = Number.parseInt((req.query.page as string) || "1") || 1
    const limit = Number.parseInt((req.query.limit as string) || "20") || 20

    // Admin can view all transfers or filter by userId
    // Other users can only view their own transfers
    const targetUserId = req.user?.role === "admin" && userId ? userId : currentUserId

    if (!targetUserId) throw new ForbiddenError("User not authenticated")

    const filter: Record<string, any> = {}

    if (type === "sent") {
      filter.fromUser = targetUserId
    } else if (type === "received") {
      filter.toUser = targetUserId
    } else {
      // all - show both sent and received
      filter.$or = [{ fromUser: targetUserId }, { toUser: targetUserId }]
    }

    const total = await CashTransfer.countDocuments(filter)
    const transfers = await CashTransfer.find(filter)
      .populate("fromUser", "name email role")
      .populate("toUser", "name email role")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()

    res.json({
      data: transfers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    })
  }),
)

// Get specific transfer details
router.get(
  "/transfers/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Invalid transfer id"), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const transfer = await CashTransfer.findById(req.params.id)
      .populate("fromUser", "name email role")
      .populate("toUser", "name email role")
      .populate("createdBy", "name")

    if (!transfer) throw new NotFoundError("Cash transfer")

    // Check if user has permission to view this transfer
    const currentUserId = req.user?.id
    const isAdmin = req.user?.role === "admin"
    const isSender = transfer.fromUser.toString() === currentUserId
    const isRecipient = transfer.toUser.toString() === currentUserId

    if (!isAdmin && !isSender && !isRecipient) {
      throw new ForbiddenError("You don't have permission to view this transfer")
    }

    res.json(transfer)
  }),
)

export default router


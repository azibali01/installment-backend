import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorize, authorizePermission } from "../middleware/auth.js"
import Expense from "../models/Expense.js"
import User from "../models/User.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"

const router = express.Router()

router.get("/", authenticate, authorizePermission("view_expenses"), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1))
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)))
    const skip = (page - 1) * limit
    const total = await Expense.countDocuments()
    // Only select necessary fields for list view
    const expenses = await Expense.find()
      .select("category amount date description userId relatedUser createdAt")
      .populate("userId", "name")
      .populate("relatedUser", "name")
      .skip(skip)
      .limit(limit)
      .lean()
    res.json({ data: expenses, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch expenses" })
  }
})

router.post(
  "/",
  authenticate,
  authorizePermission("manage_expenses"),
  [
    body("category")
      .isIn([
        "salary",
        "rent",
        "utilities",
        "inventory_purchase",
        "supplies",
        "marketing",
        "maintenance",
        "logistics",
        "taxes",
        "other",
      ])
      .withMessage("invalid category"),
    body("amount").isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
    body("date").isISO8601().withMessage("date must be a valid ISO date"),
    body("description").optional().isString(),
    body("relatedUser").optional().isMongoId().withMessage("relatedUser must be a valid user id"),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    const session = await mongoose.startSession()
    session.startTransaction()
    try {
      const { category, amount, date, description, relatedUser } = req.body
      const userId = req.user?.id
      const user = await User.findById(userId).session(session)
      if (!user) {
        await session.abortTransaction(); session.endSession();
        return res.status(404).json({ error: "User not found" })
      }
      if (user.cashBalance < Number(amount)) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ error: "Insufficient cash balance" })
      }
      const expense = new Expense({
        category,
        amount: Number(amount),
        date: new Date(date),
        description,
        userId,
        relatedUser,
      })
      await expense.save({ session })
      await User.findByIdAndUpdate(userId, { $inc: { cashBalance: -Number(amount) } }, { session })
      await session.commitTransaction(); session.endSession();
      res.status(201).json(expense)
    } catch (error) {
      await session.abortTransaction(); session.endSession();
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create expense" })
    }
  },
)

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_expenses"),
  [param("id").isMongoId().withMessage("Invalid expense id"), validateRequest],
  async (req: Request, res: Response) => {
    const session = await mongoose.startSession()
    session.startTransaction()
    try {
      const { id } = req.params
      const expense = await Expense.findById(id).session(session)
      if (!expense) {
        await session.abortTransaction(); session.endSession();
        return res.status(404).json({ error: "Expense not found" })
      }
      await User.findByIdAndUpdate(expense.userId, { $inc: { cashBalance: expense.amount } }, { session })
      await expense.deleteOne({ session })
      await session.commitTransaction(); session.endSession();
      res.json({ success: true })
    } catch (error) {
      await session.abortTransaction(); session.endSession();
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete expense" })
    }
  }
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_expenses"),
  [
    param("id").isMongoId().withMessage("Invalid expense id"),
    body("category")
      .optional()
      .isIn([
        "salary",
        "rent",
        "utilities",
        "inventory_purchase",
        "supplies",
        "marketing",
        "maintenance",
        "logistics",
        "taxes",
        "other",
      ])
      .withMessage("invalid category"),
    body("amount").optional().isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
    body("date").optional().isISO8601().withMessage("date must be a valid ISO date"),
    body("description").optional().isString(),
    body("relatedUser").optional().isMongoId().withMessage("relatedUser must be a valid user id"),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    const session = await mongoose.startSession()
    session.startTransaction()
    try {
      const { id } = req.params
      const { category, amount, date, description, relatedUser } = req.body
      const expense = await Expense.findById(id).session(session)
      if (!expense) {
        await session.abortTransaction(); session.endSession();
        return res.status(404).json({ error: "Expense not found" })
      }
      if (amount !== undefined) {
        const oldAmount = expense.amount
        const newAmount = Number(amount)
        const diff = newAmount - oldAmount
        if (diff !== 0) {
          if (diff > 0) {
            const user = await User.findById(expense.userId).session(session)
            if (!user || user.cashBalance < diff) {
              await session.abortTransaction(); session.endSession();
              return res.status(400).json({ error: "Insufficient cash balance for update" })
            }
          }
          await User.findByIdAndUpdate(expense.userId, { $inc: { cashBalance: -diff } }, { session })
        }
      }
      const update: any = {}
      if (category !== undefined) update.category = category
      if (amount !== undefined) update.amount = Number(amount)
      if (date !== undefined) update.date = new Date(date)
      if (description !== undefined) update.description = description
      if (relatedUser !== undefined) update.relatedUser = relatedUser
      const updated = await Expense.findByIdAndUpdate(id, update, { new: true, session })
      await session.commitTransaction(); session.endSession();
      res.json(updated)
    } catch (error) {
      await session.abortTransaction(); session.endSession();
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update expense" })
    }
  },
)

export default router

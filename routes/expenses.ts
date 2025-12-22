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
    const expenses = await Expense.find().populate("userId").populate("relatedUser")
    res.json(expenses)
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
    try {
      const { category, amount, date, description, relatedUser } = req.body
      const userId = req.user?.id

      // Check if user has enough balance
      const user = await User.findById(userId)
      if (!user) {
        return res.status(404).json({ error: "User not found" })
      }

      if (user.cashBalance < Number(amount)) {
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

      await expense.save()

      // Deduct from user's cash balance
      await User.findByIdAndUpdate(userId, { $inc: { cashBalance: -Number(amount) } })

      res.status(201).json(expense)
    } catch (error) {
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
    try {
      const { id } = req.params

      const expense = await Expense.findById(id)
      if (!expense) return res.status(404).json({ error: "Expense not found" })

      // Refund the amount to the user
      await User.findByIdAndUpdate(expense.userId, { $inc: { cashBalance: expense.amount } })

      await expense.deleteOne()

      res.json({ success: true })
    } catch (error) {
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
    try {
      const { id } = req.params
      const { category, amount, date, description, relatedUser } = req.body

      const expense = await Expense.findById(id)
      if (!expense) return res.status(404).json({ error: "Expense not found" })

      if (amount !== undefined) {
        const oldAmount = expense.amount
        const newAmount = Number(amount)
        const diff = newAmount - oldAmount

        if (diff !== 0) {
          // Check if user has enough balance for the increase
          if (diff > 0) {
            const user = await User.findById(expense.userId)
            if (!user || user.cashBalance < diff) {
              return res.status(400).json({ error: "Insufficient cash balance for update" })
            }
          }

          // Adjust user balance
          await User.findByIdAndUpdate(expense.userId, { $inc: { cashBalance: -diff } })
        }
      }

      const update: any = {}
      if (category !== undefined) update.category = category
      if (amount !== undefined) update.amount = Number(amount)
      if (date !== undefined) update.date = new Date(date)
      if (description !== undefined) update.description = description
      if (relatedUser !== undefined) update.relatedUser = relatedUser

      const updated = await Expense.findByIdAndUpdate(id, update, { new: true })

      res.json(updated)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update expense" })
    }
  },
)

export default router

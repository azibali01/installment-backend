import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorize, authorizePermission } from "../middleware/auth.js"
import Expense from "../models/Expense.js"
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

      const expense = new Expense({
        category,
        amount: Number(amount),
        date: new Date(date),
        description,
        userId: req.user?.id,
        relatedUser,
      })

      await expense.save()
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

      const deleted = await Expense.findByIdAndDelete(id)

      if (!deleted) return res.status(404).json({ error: "Expense not found" })

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
      const update: any = {}
      const { category, amount, date, description, relatedUser } = req.body
      if (category !== undefined) update.category = category
      if (amount !== undefined) update.amount = Number(amount)
      if (date !== undefined) update.date = new Date(date)
      if (description !== undefined) update.description = description
      if (relatedUser !== undefined) update.relatedUser = relatedUser

      const updated = await Expense.findByIdAndUpdate(id, update, { new: true })

      if (!updated) return res.status(404).json({ error: "Expense not found" })

      res.json(updated)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update expense" })
    }
  },
)

export default router

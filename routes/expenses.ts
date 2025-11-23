import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorize, authorizePermission } from "../middleware/auth.js"
import Expense from "../models/Expense.js"

const router = express.Router()

router.get("/", authenticate, authorizePermission("view_expenses"), async (req: Request, res: Response) => {
  try {
    const expenses = await Expense.find().populate("userId").populate("relatedUser")
    res.json(expenses)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch expenses" })
  }
})

router.post("/", authenticate, authorizePermission("manage_expenses"), async (req: Request, res: Response) => {
  try {
    const { category, amount, date, description, relatedUser } = req.body

    if (relatedUser && !mongoose.Types.ObjectId.isValid(String(relatedUser))) {
      return res.status(400).json({ error: "relatedUser must be a valid user id" })
    }

    if (amount == null || Number.isNaN(Number(amount))) {
      return res.status(400).json({ error: "amount must be a valid number" })
    }

    if (!date || Number.isNaN(Date.parse(String(date)))) {
      return res.status(400).json({ error: "date must be a valid date string" })
    }

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
})

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_expenses"),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params

      if (!mongoose.Types.ObjectId.isValid(String(id))) {
        return res.status(400).json({ error: "Invalid expense id" })
      }

      const deleted = await Expense.findByIdAndDelete(id)

      if (!deleted) return res.status(404).json({ error: "Expense not found" })

      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete expense" })
    }
  }
)

export default router

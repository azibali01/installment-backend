import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Payment from "../models/Payment.js"
import Expense from "../models/Expense.js"
import InstallmentPlan from "../models/InstallmentPlan.js"

const router = express.Router()

router.get("/cash-flow", authenticate, authorizePermission("view_reports"), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query

    const query: any = {}
    if (startDate || endDate) {
      query.createdAt = {}
      if (startDate) query.createdAt.$gte = new Date(startDate as string)
      if (endDate) query.createdAt.$lte = new Date(endDate as string)
    }

    const cashIn = await Payment.aggregate([{ $match: query }, { $group: { _id: null, total: { $sum: "$amount" } } }])

    const cashOut = await Expense.aggregate([{ $match: query }, { $group: { _id: null, total: { $sum: "$amount" } } }])

    const totalCashIn = cashIn[0]?.total || 0
    const totalCashOut = cashOut[0]?.total || 0

    res.json({
      totalCashIn,
      totalCashOut,
      profit: totalCashIn - totalCashOut,
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate report" })
  }
})

router.get("/installment-status", authenticate, authorizePermission("view_reports"), async (req: Request, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const overdue = await InstallmentPlan.find({
      "installmentSchedule.dueDate": { $lt: today },
      "installmentSchedule.status": "pending",
    })

    const duToday = await InstallmentPlan.find({
      "installmentSchedule.dueDate": today,
      "installmentSchedule.status": "pending",
    })

    const upcoming = await InstallmentPlan.find({
      "installmentSchedule.dueDate": { $gt: today },
      "installmentSchedule.status": "pending",
    }).limit(10)

    res.json({ overdue, duToday, upcoming })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate report" })
  }
})

export default router

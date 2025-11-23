import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Payment from "../models/Payment.js"
import InstallmentPlan from "../models/InstallmentPlan.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const payments = await Payment.find().populate("installmentPlanId").populate("recordedBy")
    res.json(payments)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch payments" })
  }
})

router.post("/", authenticate, authorizePermission("manage_payments"), async (req: Request, res: Response) => {
  try {
    const { installmentPlanId, installmentMonth, amount, paymentDate, notes } = req.body

    const plan = await InstallmentPlan.findById(installmentPlanId)
    if (!plan) {
      return res.status(404).json({ error: "Installment plan not found" })
    }

    const payment = new Payment({
      installmentPlanId,
      installmentMonth,
      amount,
      paymentDate,
      recordedBy: req.user?.id,
      notes,
    })

    await payment.save()

    // Update installment schedule
    if (plan.installmentSchedule[installmentMonth - 1]) {
      plan.installmentSchedule[installmentMonth - 1].status = "paid"
      plan.installmentSchedule[installmentMonth - 1].paidDate = new Date(paymentDate)
    }

    plan.remainingBalance -= amount
    await plan.save()

    res.status(201).json(payment)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to record payment" })
  }
})

export default router

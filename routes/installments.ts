import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import InstallmentPlan from "../models/InstallmentPlan.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const installments = await InstallmentPlan.find()
      .populate("customerId")
      .populate("productId")
      .populate("approvedBy")
    res.json(installments)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch installments" })
  }
})

router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const installment = await InstallmentPlan.findById(req.params.id).populate("customerId").populate("productId")
    res.json(installment)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch installment" })
  }
})

router.post("/", authenticate, async (req: Request, res: Response) => {
  try {
    const { customerId, productId, totalAmount, downPayment, interestRate, numberOfMonths } = req.body

    const remainingBalance = totalAmount - downPayment
    const totalWithInterest = remainingBalance * (1 + interestRate / 100)
    const monthlyInstallment = totalWithInterest / numberOfMonths

    const startDate = new Date()
    const endDate = new Date()
    endDate.setMonth(endDate.getMonth() + numberOfMonths)

    const installmentSchedule = Array.from({ length: numberOfMonths }, (_, i) => ({
      month: i + 1,
      dueDate: new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, startDate.getDate()),
      amount: monthlyInstallment,
      status: "pending",
    }))


    const creatorRole = req.user?.role
    const autoApprove = creatorRole === "admin" || creatorRole === "manager"

    const plan = new InstallmentPlan({
      customerId,
      productId,
      totalAmount,
      downPayment,
      remainingBalance,
      monthlyInstallment,
      interestRate,
      numberOfMonths,
      startDate,
      endDate,
      installmentSchedule,
      createdBy: req.user?.id,
      status: autoApprove ? "approved" : "pending",
      approvedBy: autoApprove ? req.user?.id : undefined,
    })

    await plan.save()
    res.status(201).json(plan)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create installment" })
  }
})

router.put("/:id", authenticate, authorizePermission("manage_installments"), async (req: Request, res: Response) => {
  try {
    const update = req.body
    const plan = await InstallmentPlan.findByIdAndUpdate(req.params.id, update, { new: true })
    res.json(plan)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update installment" })
  }
})

router.put("/:id/approve", authenticate, authorizePermission("approve_installments"), async (req: Request, res: Response) => {
  try {
    const plan = await InstallmentPlan.findByIdAndUpdate(
      req.params.id,
      { status: "approved", approvedBy: req.user?.id },
      { new: true },
    )
    res.json(plan)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to approve installment" })
  }
})

router.delete("/:id", authenticate, authorizePermission("manage_installments"), async (req: Request, res: Response) => {
  try {
    const deleted = await InstallmentPlan.findByIdAndDelete(req.params.id)
    if (!deleted) return res.status(404).json({ error: "Installment not found" })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete installment" })
  }
})

export default router

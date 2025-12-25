import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorizePermission, authorize } from "../middleware/auth.js"
import Payment from "../models/Payment.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import PaymentRequest from "../models/PaymentRequest.js"
import User from "../models/User.js"
import { allocatePaymentToSchedule } from "../utils/finance.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"
import { asyncHandler } from "../middleware/asyncHandler.js"
import { NotFoundError, BadRequestError } from "../utils/errors.js"

const router = express.Router()

router.get("/", authenticate, asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 10)))

  const customerId = String(req.query.customerId || "").trim()
  const status = String(req.query.status || "").trim()

  const filter: Record<string, any> = {}

  // Filter by customer -> payments whose installmentPlan belongs to this customer
  if (customerId) {
    const plans = await InstallmentPlan.find({ customerId }).select("_id").lean()
    const planIds = plans.map((p: any) => p._id)
    if (planIds.length === 0) {
      return res.json({ data: [], total: 0, page, pageSize })
    }
    filter.installmentPlanId = { $in: planIds }
  }

  // Support client-side special filters for payments list
  if (status) {
    if (status === "withMonth") {
      filter.installmentMonth = { $gt: 0 }
    } else if (status === "auto") {
      filter.installmentMonth = { $lte: 0 }
    } else {
      // assume status is a payment.status value
      filter.status = status
    }
  }

  const total = await Payment.countDocuments(filter)
  const payments = await Payment.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .populate({ path: "installmentPlanId", populate: [{ path: "customerId", select: "name" }, { path: "productId", select: "name" }] })
    .populate("recordedBy", "name")
    .populate("receivedBy", "name")
    .select("installmentPlanId installmentMonth amount paymentDate recordedBy receivedBy notes breakdown allocation status createdAt")
    .lean()

  const out = payments.map((p) => {
    const po: any = p
    po.customerName = po.installmentPlanId?.customerId?.name || null
    po.receivedByName = po.receivedBy?.name || null
    return po
  })

  res.json({ data: out, total, page, pageSize })
}))

router.post(
  "/",
  authenticate,
  authorizePermission("manage_payments"),
  [
    body("installmentPlanId").notEmpty().withMessage("installmentPlanId is required").isMongoId().withMessage("installmentPlanId must be a valid id"),
    body("installmentMonth").optional().isInt({ gt: 0 }).withMessage("installmentMonth must be a positive integer"),
    body("amount").isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
    body("paymentDate").isISO8601().withMessage("paymentDate must be a valid date"),
    asyncHandler(async (req: Request, res: Response) => {
      const { installmentPlanId, installmentMonth, amount, paymentDate, notes, receivedBy } = req.body
      // Validate required fields
      if (!req.user?.id) throw new Error("User not authenticated")
      if (!mongoose.Types.ObjectId.isValid(req.user.id)) throw new BadRequestError(`Invalid user ID: ${req.user.id}`)
      if (!installmentPlanId) throw new BadRequestError("installmentPlanId is required")
      if (!mongoose.Types.ObjectId.isValid(installmentPlanId)) throw new BadRequestError(`Invalid installmentPlanId: ${installmentPlanId}`)
      if (!amount || Number(amount) <= 0) throw new BadRequestError("Valid amount is required")
      if (!paymentDate) throw new BadRequestError("paymentDate is required")

      // Determine receiver
      const receiverId = receivedBy || req.user.id
      if (!mongoose.Types.ObjectId.isValid(receiverId)) throw new BadRequestError(`Invalid receiver ID: ${receiverId}`)
      try {
        const receiver = await User.findById(receiverId)
        if (!receiver) throw new BadRequestError("Receiver user not found")

        const plan = await InstallmentPlan.findById(installmentPlanId)
        if (!plan) throw new NotFoundError("Installment plan")

        const recent = await Payment.findOne({ installmentPlanId, amount, recordedBy: req.user?.id }).sort({ createdAt: -1 })
        if (recent && Date.now() - (recent.createdAt?.getTime() || 0) < 5000) {
          return res.status(200).json({ payment: recent, warning: "Duplicate suppressed (recent similar payment)" })
        }

        let allocationResult: any = null
        if (installmentMonth) {
          const idx = installmentMonth - 1
          if (!plan.installmentSchedule[idx]) {
            throw new BadRequestError("Installment month not found on plan")
          }
          const entry = plan.installmentSchedule[idx]
          const paidSoFar = Number(entry.paidAmount || 0)
          const due = Number(entry.amount || 0)
          const newPaid = paidSoFar + Number(amount)
          entry.paidAmount = newPaid
          if (newPaid + 0.001 >= due) {
            entry.status = "paid"
            entry.paidDate = new Date(paymentDate)
          }
          plan.remainingBalance = Math.max(0, Number(plan.remainingBalance || 0) - Number(amount))
          // Calculate proper breakdown based on interest model
          const interestModel = (plan as any).interestModel || "equal"
          let breakdown: { principal: number; interest: number; fees: number }
          if (interestModel === "equal") {
            breakdown = { principal: Number(amount), interest: 0, fees: 0 }
          } else {
            // For amortized/flat models, calculate interest portion from schedule entry
            const interestPart = Number(entry.interest || 0)
            const principalPart = Math.max(0, due - interestPart)
            const ratio = due > 0 ? Number(amount) / due : 0
            const appliedInterest = Math.min(interestPart * ratio, Number(amount))
            const appliedPrincipal = Number(amount) - appliedInterest
            breakdown = { principal: appliedPrincipal, interest: appliedInterest, fees: 0 }
          }
          allocationResult = { appliedToMonths: [{ month: installmentMonth, applied: Number(amount) }], breakdown }
        } else {
          const schedule = plan.installmentSchedule.map((s: any) => ({ ...s }))
          allocationResult = allocatePaymentToSchedule(schedule, (plan as any).interestModel || "equal", Number(amount), (plan as any).roundingPolicy || "nearest")
          for (const a of allocationResult.appliedToMonths) {
            if (a.month === -1) continue
            const idx = a.month - 1
            if (!plan.installmentSchedule[idx]) continue
            const entry = plan.installmentSchedule[idx]
            entry.paidAmount = entry.paidAmount ? Number(entry.paidAmount) + Number(a.applied) : Number(a.applied)
            if (Number(entry.paidAmount) + 0.001 >= Number(entry.amount || 0)) {
              entry.status = "paid"
              entry.paidDate = new Date(paymentDate)
            }
          }
          plan.remainingBalance = Math.max(0, Number(plan.remainingBalance || 0) - Number(amount))
        }
        // Update plan status if fully paid
        if (plan.remainingBalance <= 10) {
          plan.status = "completed"
        }
        // Ensure breakdown is always provided (required by schema)
        const breakdown = allocationResult?.breakdown || { principal: Number(amount), interest: 0, fees: 0 }
        const normalizedBreakdown = {
          principal: Number(breakdown.principal || amount),
          interest: Number(breakdown.interest || 0),
          fees: Number(breakdown.fees || 0),
          downPaymentApplied: Number(breakdown.downPaymentApplied || 0),
        }
        const paymentDateObj = new Date(paymentDate)
        const normalizedInstallmentMonth = installmentMonth ? Number(installmentMonth) : 0
        const payment = new Payment({
          installmentPlanId,
          installmentMonth: normalizedInstallmentMonth,
          amount: Number(amount),
          paymentDate: paymentDateObj,
          recordedBy: req.user.id,
          receivedBy: receiverId,
          notes: notes || undefined,
          breakdown: normalizedBreakdown,
          allocation: allocationResult?.appliedToMonths,
          status: "recorded",
        })
        await plan.save()
        await payment.save()
        await User.findByIdAndUpdate(receiverId, { $inc: { cashBalance: Number(amount) } })
        res.status(201).json({ payment, allocation: allocationResult })
      } catch (err) {
        throw err
      }
    })
  ]
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_payments"),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role === "employee") {
      throw new Error("Employees cannot directly edit payments. Please submit a request to admin/manager.")
    }
    const id = req.params.id
    const update = req.body as Partial<{ amount: number; paymentDate: string; installmentMonth: number; notes: string }>
    try {
      const payment = await Payment.findById(id)
      if (!payment) throw new NotFoundError("Payment")
      const oldMonth = Number(payment.installmentMonth || 0)
      if (!oldMonth || oldMonth <= 0) {
        throw new BadRequestError("Editing auto-allocated payments is not supported. Please reconcile manually.")
      }
      const plan = await InstallmentPlan.findById(payment.installmentPlanId)
      const oldAmount = Number(payment.amount || 0)
      const newAmount = typeof update.amount === "number" ? Number(update.amount) : oldAmount
      const newMonth = typeof update.installmentMonth === "number" ? Number(update.installmentMonth) : oldMonth
      if (plan) {
        // 1. Revert old payment effect
        const oldIdx = oldMonth - 1
        if (plan.installmentSchedule[oldIdx]) {
          const currentPaid = Number(plan.installmentSchedule[oldIdx].paidAmount || 0)
          plan.installmentSchedule[oldIdx].paidAmount = Math.max(0, currentPaid - oldAmount)
          const due = Number(plan.installmentSchedule[oldIdx].amount || 0)
          if (Number(plan.installmentSchedule[oldIdx].paidAmount) + 0.001 < due) {
            plan.installmentSchedule[oldIdx].status = "pending"
            plan.installmentSchedule[oldIdx].paidDate = undefined
          }
        }
        plan.remainingBalance = Number(plan.remainingBalance || 0) + oldAmount
        // 2. Apply new payment effect
        const newIdx = newMonth - 1
        if (!plan.installmentSchedule[newIdx]) {
          throw new BadRequestError("Target installment month not found on plan")
        }
        const newPaid = Number(plan.installmentSchedule[newIdx].paidAmount || 0) + newAmount
        plan.installmentSchedule[newIdx].paidAmount = newPaid
        const newDue = Number(plan.installmentSchedule[newIdx].amount || 0)
        if (newPaid + 0.001 >= newDue) {
          plan.installmentSchedule[newIdx].status = "paid"
          plan.installmentSchedule[newIdx].paidDate = update.paymentDate ? new Date(update.paymentDate) : payment.paymentDate
        }
      }
      payment.amount = newAmount
      payment.installmentMonth = newMonth
      if (update.paymentDate) payment.paymentDate = new Date(update.paymentDate)
      if (update.notes) payment.notes = update.notes
      await payment.save()
      if (plan) await plan.save()
      res.json(payment)
    } catch (err) {
      throw err
    }
  }),
)

// Payment request endpoints for employees
router.post(
  "/requests",
  authenticate,
  [
    body("paymentId").notEmpty().isMongoId().withMessage("paymentId is required"),
    body("type").isIn(["edit", "delete"]).withMessage("type must be 'edit' or 'delete'"),
    body("changes").optional(),
    body("reason").optional().isString(),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { paymentId, type, changes, reason } = req.body;

      // Check if payment exists
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // Employees must submit requests, admin/manager can auto-approve
      const creatorRole = req.user?.role;
      const isPrivileged = creatorRole === "admin" || creatorRole === "manager";

      const reqDoc = new PaymentRequest({
        paymentId,
        type,
        changes: changes || undefined,
        reason: reason || "Requested via app",
        requestedBy: req.user?.id,
      });

      // If admin/manager, auto-approve and execute
      if (isPrivileged) {
        if (type === "edit" && changes) {
          // Apply changes directly (similar to payment PUT logic)
          const update = changes as Partial<{ amount: number; paymentDate: string; installmentMonth: number; notes: string }>;
          const oldAmount = Number(payment.amount || 0);
          const newAmount = typeof update.amount === 'number' ? Number(update.amount) : oldAmount;
          
          if (payment.installmentPlanId) {
            const plan = await InstallmentPlan.findById(payment.installmentPlanId);
            if (plan && payment.installmentMonth && payment.installmentMonth > 0) {
              const oldIdx = payment.installmentMonth - 1;
              if (plan.installmentSchedule[oldIdx]) {
                plan.installmentSchedule[oldIdx].paidAmount = Math.max(0, Number(plan.installmentSchedule[oldIdx].paidAmount || 0) - oldAmount);
                if (Number(plan.installmentSchedule[oldIdx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[oldIdx].amount || 0)) {
                  plan.installmentSchedule[oldIdx].status = 'pending';
                  plan.installmentSchedule[oldIdx].paidDate = undefined;
                }
              }
              
              const newMonth = typeof update.installmentMonth === 'number' ? Number(update.installmentMonth) : payment.installmentMonth;
              const newIdx = newMonth - 1;
              if (plan.installmentSchedule[newIdx]) {
                plan.installmentSchedule[newIdx].paidAmount = Number(plan.installmentSchedule[newIdx].paidAmount || 0) + newAmount;
                if (Number(plan.installmentSchedule[newIdx].paidAmount || 0) + 0.001 >= Number(plan.installmentSchedule[newIdx].amount || 0)) {
                  plan.installmentSchedule[newIdx].status = 'paid';
                  plan.installmentSchedule[newIdx].paidDate = update.paymentDate ? new Date(update.paymentDate) : payment.paymentDate;
                }
              }
              
              plan.remainingBalance = Math.max(0, Number(plan.remainingBalance || 0) - (newAmount - oldAmount));
              await plan.save();
            }
          }

          payment.amount = newAmount as any;
          if (update.paymentDate) payment.paymentDate = new Date(update.paymentDate) as any;
          if (typeof update.installmentMonth === 'number') payment.installmentMonth = update.installmentMonth as any;
          if (typeof update.notes !== 'undefined') payment.notes = update.notes as any;
          await payment.save();
        } else if (type === "delete") {
          // Delete payment (similar to payment DELETE logic)
          const month = Number(payment.installmentMonth || 0);
          if (month > 0 && payment.installmentPlanId) {
            const plan = await InstallmentPlan.findById(payment.installmentPlanId);
            if (plan) {
              const idx = month - 1;
              if (plan.installmentSchedule[idx]) {
                plan.installmentSchedule[idx].paidAmount = Math.max(0, Number(plan.installmentSchedule[idx].paidAmount || 0) - Number(payment.amount || 0));
                if (Number(plan.installmentSchedule[idx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[idx].amount || 0)) {
                  plan.installmentSchedule[idx].status = 'pending';
                  plan.installmentSchedule[idx].paidDate = undefined;
                }
              }
              plan.remainingBalance = Number(plan.remainingBalance || 0) + Number(payment.amount || 0);
              await plan.save();
            }
          }
          await Payment.deleteOne({ _id: payment._id });
        }
        
        reqDoc.status = "approved";
        reqDoc.reviewedBy = req.user?.id as any;
        reqDoc.reviewedAt = new Date();
      }

      await reqDoc.save();
      res.status(201).json(reqDoc);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create payment request" });
    }
  },
);

router.get(
  "/requests",
  authenticate,
  authorizePermission("manage_payments"),
  async (req: Request, res: Response) => {
    try {
      const { status } = req.query as { status?: string };
      const page = Number.parseInt((req.query.page as string) || "1") || 1;
      const limit = Number.parseInt((req.query.limit as string) || "20") || 20;
      const filter: Record<string, any> = {};
      if (status) filter.status = status;

      const total = await PaymentRequest.countDocuments(filter);
      const list = await PaymentRequest.find(filter)
        .populate({
          path: "paymentId",
          populate: [
            { path: "installmentPlanId", populate: [{ path: "customerId", select: "name" }, { path: "productId", select: "name" }] },
            { path: "recordedBy", select: "name" },
          ],
        })
        .populate({ path: "requestedBy", select: "name" })
        .populate({ path: "reviewedBy", select: "name" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      res.json({ data: list, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch payment requests" });
    }
  },
);

router.put(
  "/requests/:id/approve",
  authenticate,
  authorizePermission("manage_payments"),
  [param("id").isMongoId().withMessage("Invalid request id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const r = await PaymentRequest.findById(req.params.id);
      if (!r) return res.status(404).json({ error: "Request not found" });
      if (r.status !== "pending") return res.status(400).json({ error: "Request not pending" });

      const payment = await Payment.findById(r.paymentId);
      if (!payment) return res.status(404).json({ error: "Payment not found" });

      if (r.type === "edit" && r.changes) {
        // Apply edit changes (similar to payment PUT logic)
        const update = r.changes as Partial<{ amount: number; paymentDate: string; installmentMonth: number; notes: string }>;
        const oldAmount = Number(payment.amount || 0);
        const newAmount = typeof update.amount === 'number' ? Number(update.amount) : oldAmount;
        const oldMonth = Number(payment.installmentMonth || 0);
        const newMonth = typeof update.installmentMonth === 'number' ? Number(update.installmentMonth) : oldMonth;

        if (payment.installmentPlanId) {
          const plan = await InstallmentPlan.findById(payment.installmentPlanId);
          if (plan && oldMonth > 0) {
            const oldIdx = oldMonth - 1;
            if (plan.installmentSchedule[oldIdx]) {
              plan.installmentSchedule[oldIdx].paidAmount = Math.max(0, Number(plan.installmentSchedule[oldIdx].paidAmount || 0) - oldAmount);
              if (Number(plan.installmentSchedule[oldIdx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[oldIdx].amount || 0)) {
                plan.installmentSchedule[oldIdx].status = 'pending';
                plan.installmentSchedule[oldIdx].paidDate = undefined;
              }
            }

            const newIdx = newMonth - 1;
            if (plan.installmentSchedule[newIdx]) {
              plan.installmentSchedule[newIdx].paidAmount = Number(plan.installmentSchedule[newIdx].paidAmount || 0) + newAmount;
              if (Number(plan.installmentSchedule[newIdx].paidAmount || 0) + 0.001 >= Number(plan.installmentSchedule[newIdx].amount || 0)) {
                plan.installmentSchedule[newIdx].status = 'paid';
                plan.installmentSchedule[newIdx].paidDate = update.paymentDate ? new Date(update.paymentDate) : payment.paymentDate;
              }
            }

            plan.remainingBalance = Math.max(0, Number(plan.remainingBalance || 0) - (newAmount - oldAmount));
            await plan.save();
          }
        }

        payment.amount = newAmount as any;
        if (update.paymentDate) payment.paymentDate = new Date(update.paymentDate) as any;
        if (typeof update.installmentMonth === 'number') payment.installmentMonth = update.installmentMonth as any;
        if (typeof update.notes !== 'undefined') payment.notes = update.notes as any;
        await payment.save();
      } else if (r.type === "delete") {
        // Delete payment (similar to payment DELETE logic)
        const month = Number(payment.installmentMonth || 0);
        if (month > 0 && payment.installmentPlanId) {
          const plan = await InstallmentPlan.findById(payment.installmentPlanId);
          if (plan) {
            const idx = month - 1;
            if (plan.installmentSchedule[idx]) {
              plan.installmentSchedule[idx].paidAmount = Math.max(0, Number(plan.installmentSchedule[idx].paidAmount || 0) - Number(payment.amount || 0));
              if (Number(plan.installmentSchedule[idx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[idx].amount || 0)) {
                plan.installmentSchedule[idx].status = 'pending';
                plan.installmentSchedule[idx].paidDate = undefined;
              }
            }
            plan.remainingBalance = Number(plan.remainingBalance || 0) + Number(payment.amount || 0);
            await plan.save();
          }
        }
        await Payment.deleteOne({ _id: payment._id });
      }
      
      r.status = "approved";
      r.reviewedBy = req.user?.id as any;
      r.reviewedAt = new Date();
      await r.save();
      res.json(r);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to approve payment request" });
    }
  },
);

// Place all route definitions above this line
router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_payments"),
  asyncHandler(async (req: Request, res: Response) => {
    const payment = await Payment.findById(req.params.id)
    if (!payment) throw new NotFoundError("Payment")
    const month = Number(payment.installmentMonth || 0)
    if (month > 0 && payment.installmentPlanId) {
      const plan = await InstallmentPlan.findById(payment.installmentPlanId)
      if (plan) {
        const idx = month - 1
        if (plan.installmentSchedule[idx]) {
          plan.installmentSchedule[idx].paidAmount = Math.max(0, Number(plan.installmentSchedule[idx].paidAmount || 0) - Number(payment.amount || 0))
          if (Number(plan.installmentSchedule[idx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[idx].amount || 0)) {
            plan.installmentSchedule[idx].status = 'pending'
            plan.installmentSchedule[idx].paidDate = undefined
          }
        }
        plan.remainingBalance = Number(plan.remainingBalance || 0) + Number(payment.amount || 0)
        await plan.save()
      }
    }
    // Decrement cash balance from the receivedBy user if present
    if (payment.receivedBy) {
      await User.findByIdAndUpdate(payment.receivedBy, { $inc: { cashBalance: -Number(payment.amount || 0) } })
    }
    await Payment.deleteOne({ _id: payment._id })
    res.json({ success: true })
  })
)

export default router


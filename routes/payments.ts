import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Payment from "../models/Payment.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import { allocatePaymentToSchedule } from "../utils/finance.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1))
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 10)))

    const total = await Payment.countDocuments()
    const payments = await Payment.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate({ path: "installmentPlanId", populate: [{ path: "customerId" }, { path: "productId" }] })
      .populate("recordedBy")

    const out = payments.map((p) => {
      const po: any = (p as any).toObject ? (p as any).toObject() : p
      po.customerName = po.installmentPlanId?.customerId?.name || null
      return po
    })

    res.json({ data: out, total, page, pageSize })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch payments" })
  }
})

router.post(
  "/",
  authenticate,
  authorizePermission("manage_payments"),
  [
    body("installmentPlanId").notEmpty().withMessage("installmentPlanId is required").isMongoId().withMessage("installmentPlanId must be a valid id"),
    body("installmentMonth").optional().isInt({ gt: 0 }).withMessage("installmentMonth must be a positive integer"),
    body("amount").isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
    body("paymentDate").isISO8601().withMessage("paymentDate must be a valid date"),
    body("notes").optional().isString(),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { installmentPlanId, installmentMonth, amount, paymentDate, notes } = req.body


      // Try to use a transaction; fallback if transactions are not supported
      let session: any = null
      let usingTransaction = false
      try {
        session = await mongoose.startSession()
        session.startTransaction()
        usingTransaction = true
      } catch (err) {
        session = null
        usingTransaction = false
      }

      try {
        const plan = usingTransaction
          ? await InstallmentPlan.findById(installmentPlanId).session(session)
          : await InstallmentPlan.findById(installmentPlanId)
        if (!plan) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(404).json({ error: "Installment plan not found" })
        }

        const recent = await Payment.findOne({ installmentPlanId, amount, recordedBy: req.user?.id }).sort({ createdAt: -1 })
        if (recent && Date.now() - (recent.createdAt?.getTime() || 0) < 5000) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(200).json({ payment: recent, warning: "Duplicate suppressed (recent similar payment)" })
        }

        let allocationResult: any = null
        if (installmentMonth) {
          const idx = installmentMonth - 1
          if (!plan.installmentSchedule[idx]) {
            if (usingTransaction && session) {
              await session.abortTransaction()
              session.endSession()
            }
            return res.status(400).json({ error: "Installment month not found on plan" })
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
          allocationResult = { appliedToMonths: [{ month: installmentMonth, applied: Number(amount) }], breakdown: { principal: Number(amount), interest: 0, fees: 0 } }
        } else {
          const schedule = plan.installmentSchedule.map((s: any) => ({ ...s }))
          allocationResult = allocatePaymentToSchedule(schedule, (plan as any).interestModel || 'equal', Number(amount), (plan as any).roundingPolicy || 'nearest')

          for (const a of allocationResult.appliedToMonths) {
            if (a.month === -1) continue
            const idx = a.month - 1
            if (!plan.installmentSchedule[idx]) continue
            const entry = plan.installmentSchedule[idx]
            entry.paidAmount = entry.paidAmount ? Number(entry.paidAmount) + Number(a.applied) : Number(a.applied)
            if (Number(entry.paidAmount) + 0.001 >= Number(entry.amount || 0)) {
              entry.status = 'paid'
              entry.paidDate = new Date(paymentDate)
            }
          }
          plan.remainingBalance = Math.max(0, Number(plan.remainingBalance || 0) - Number(amount))
        }

        const payment = new Payment({
          installmentPlanId,
          installmentMonth: installmentMonth || 0,
          amount,
          paymentDate,
          recordedBy: req.user?.id,
          notes,
          breakdown: allocationResult ? allocationResult.breakdown : undefined,
        })

        if (usingTransaction && session) {
          await payment.save({ session })
          await plan.save({ session })
          await session.commitTransaction()
          session.endSession()
          return res.status(201).json({ payment, allocation: allocationResult })
        }

        // Fallback: non-transactional with compensating actions
        try {
          await payment.save()
        } catch (err) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          throw err
        }

        try {
          await plan.save()
          return res.status(201).json({ payment, allocation: allocationResult })
        } catch (planSaveErr) {
          // Attempt to roll back saved payment
          try {
            await Payment.deleteOne({ _id: payment._id })
          } catch (cleanupErr) {
            console.error("Failed to cleanup payment after plan save failure:", cleanupErr)
          }
          throw planSaveErr
        }
      } catch (err) {
        if (usingTransaction && session) {
          try { await session.abortTransaction() } catch (_) { }
          session.endSession()
        }
        return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to record payment" })
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to record payment" })
    }
  },
)

export default router

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_payments"),
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const update = req.body as Partial<{ amount: number; paymentDate: string; installmentMonth: number; notes: string }>

      // Try transaction, fallback to non-transactional with compensating actions
      let session: any = null
      let usingTransaction = false
      try {
        session = await mongoose.startSession()
        session.startTransaction()
        usingTransaction = true
      } catch (err) {
        session = null
        usingTransaction = false
      }

      try {
        const payment = usingTransaction
          ? await Payment.findById(id).session(session)
          : await Payment.findById(id)
        if (!payment) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(404).json({ error: "Payment not found" })
        }

        const oldMonth = Number(payment.installmentMonth || 0);
        if (!oldMonth || oldMonth <= 0) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(400).json({ error: "Editing auto-allocated payments is not supported. Please reconcile manually." })
        }

        const plan = usingTransaction
          ? await InstallmentPlan.findById(payment.installmentPlanId).session(session)
          : await InstallmentPlan.findById(payment.installmentPlanId)
        if (!plan) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(404).json({ error: "Installment plan not found for this payment" })
        }

        const oldAmount = Number(payment.amount || 0);
        const newAmount = typeof update.amount === 'number' ? Number(update.amount) : oldAmount;
        const newMonth = typeof update.installmentMonth === 'number' ? Number(update.installmentMonth) : oldMonth;

        const oldIdx = oldMonth - 1;
        if (plan.installmentSchedule[oldIdx]) {
          plan.installmentSchedule[oldIdx].paidAmount = Math.max(0, Number(plan.installmentSchedule[oldIdx].paidAmount || 0) - oldAmount);
          if (Number(plan.installmentSchedule[oldIdx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[oldIdx].amount || 0)) {
            plan.installmentSchedule[oldIdx].status = 'pending';
            plan.installmentSchedule[oldIdx].paidDate = undefined;
          }
        }

        const newIdx = newMonth - 1;
        if (!plan.installmentSchedule[newIdx]) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(400).json({ error: "Target installment month not found on plan" })
        }
        plan.installmentSchedule[newIdx].paidAmount = Number(plan.installmentSchedule[newIdx].paidAmount || 0) + newAmount;
        if (Number(plan.installmentSchedule[newIdx].paidAmount || 0) + 0.001 >= Number(plan.installmentSchedule[newIdx].amount || 0)) {
          plan.installmentSchedule[newIdx].status = 'paid';
          plan.installmentSchedule[newIdx].paidDate = update.paymentDate ? new Date(update.paymentDate) : payment.paymentDate;
        }

        plan.remainingBalance = Math.max(0, Number(plan.remainingBalance || 0) - (newAmount - oldAmount));

        const oldPaymentSnapshot = { amount: payment.amount, paymentDate: payment.paymentDate, installmentMonth: payment.installmentMonth, notes: payment.notes }

        payment.amount = newAmount as any;
        if (update.paymentDate) payment.paymentDate = new Date(update.paymentDate) as any;
        if (typeof update.installmentMonth === 'number') payment.installmentMonth = update.installmentMonth as any;
        if (typeof update.notes !== 'undefined') payment.notes = update.notes as any;

        if (usingTransaction && session) {
          await payment.save({ session });
          await plan.save({ session });
          await session.commitTransaction()
          session.endSession()
          return res.json({ payment, plan });
        }

        try {
          await payment.save()
        } catch (saveErr) {
          return res.status(500).json({ error: saveErr instanceof Error ? saveErr.message : 'Failed to save payment' })
        }

        try {
          await plan.save()
          return res.json({ payment, plan })
        } catch (planErr) {
          // attempt to revert payment to old snapshot
          try {
            payment.amount = oldPaymentSnapshot.amount
            payment.paymentDate = oldPaymentSnapshot.paymentDate
            payment.installmentMonth = oldPaymentSnapshot.installmentMonth
            payment.notes = oldPaymentSnapshot.notes
            await payment.save()
          } catch (revertErr) {
            console.error('Failed to revert payment after plan save failure:', revertErr)
          }
          return res.status(500).json({ error: planErr instanceof Error ? planErr.message : 'Failed to save plan after payment update' })
        }
      } catch (err) {
        if (usingTransaction && session) {
          try { await session.abortTransaction() } catch (_) { }
          session.endSession()
        }
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to edit payment' })
      }
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to edit payment' });
    }
  },
)

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_payments"),
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      let session: any = null
      let usingTransaction = false
      try {
        session = await mongoose.startSession()
        session.startTransaction()
        usingTransaction = true
      } catch (err) {
        session = null
        usingTransaction = false
      }

      try {
        const payment = usingTransaction
          ? await Payment.findById(id).session(session)
          : await Payment.findById(id)
        if (!payment) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(404).json({ error: 'Payment not found' })
        }

        const month = Number(payment.installmentMonth || 0);
        if (!month || month <= 0) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(400).json({ error: 'Deleting auto-allocated payments is not supported. Please reconcile manually.' })
        }

        const plan = usingTransaction
          ? await InstallmentPlan.findById(payment.installmentPlanId).session(session)
          : await InstallmentPlan.findById(payment.installmentPlanId)
        if (!plan) {
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          return res.status(404).json({ error: 'Installment plan not found for this payment' })
        }

        const idx = month - 1;
        if (plan.installmentSchedule[idx]) {
          plan.installmentSchedule[idx].paidAmount = Math.max(0, Number(plan.installmentSchedule[idx].paidAmount || 0) - Number(payment.amount || 0));
          if (Number(plan.installmentSchedule[idx].paidAmount || 0) + 0.001 < Number(plan.installmentSchedule[idx].amount || 0)) {
            plan.installmentSchedule[idx].status = 'pending';
            plan.installmentSchedule[idx].paidDate = undefined;
          }
        }

        plan.remainingBalance = Number(plan.remainingBalance || 0) + Number(payment.amount || 0);

        if (usingTransaction && session) {
          await plan.save({ session });
          await payment.deleteOne({ session });
          await session.commitTransaction()
          session.endSession()
          return res.json({ success: true });
        }

        try {
          await plan.save()
        } catch (planErr) {
          return res.status(500).json({ error: planErr instanceof Error ? planErr.message : 'Failed to save plan' })
        }

        try {
          await payment.deleteOne()
          return res.json({ success: true })
        } catch (delErr) {
          try {
            plan.installmentSchedule[idx].paidAmount = Number(plan.installmentSchedule[idx].paidAmount || 0) - Number(payment.amount || 0)
            plan.remainingBalance = Number(plan.remainingBalance || 0) - Number(payment.amount || 0)
            await plan.save()
          } catch (revertErr) {
            console.error('Failed to revert plan after payment delete failure:', revertErr)
          }
          return res.status(500).json({ error: delErr instanceof Error ? delErr.message : 'Failed to delete payment' })
        }
      } catch (err) {
        if (usingTransaction && session) {
          try { await session.abortTransaction() } catch (_) { }
          session.endSession()
        }
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete payment' })
      }
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete payment' });
    }
  },
)


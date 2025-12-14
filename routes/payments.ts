import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorizePermission, authorize } from "../middleware/auth.js"
import Payment from "../models/Payment.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import PaymentRequest from "../models/PaymentRequest.js"
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
      .populate({ path: "installmentPlanId", populate: [{ path: "customerId", select: "name" }, { path: "productId", select: "name" }] })
      .populate("recordedBy", "name")
      .select("installmentPlanId installmentMonth amount paymentDate recordedBy notes breakdown allocation status createdAt")
      .lean()

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
      
      // Validate required fields
      if (!req.user?.id) {
        return res.status(401).json({ error: "User not authenticated" })
      }
      
      // Validate ObjectIds
      if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
        return res.status(400).json({ error: `Invalid user ID: ${req.user.id}` })
      }
      
      if (!installmentPlanId) {
        return res.status(400).json({ error: "installmentPlanId is required" })
      }
      
      if (!mongoose.Types.ObjectId.isValid(installmentPlanId)) {
        return res.status(400).json({ error: `Invalid installmentPlanId: ${installmentPlanId}` })
      }
      
      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: "Valid amount is required" })
      }
      
      if (!paymentDate) {
        return res.status(400).json({ error: "paymentDate is required" })
      }


      // Try to use a transaction; fallback if transactions are not supported
      let session: any = null
      let usingTransaction = false
      try {
        session = await mongoose.startSession()
        try {
          session.startTransaction()
          usingTransaction = true
        } catch (txErr: any) {
          // Transaction not supported (e.g., standalone MongoDB)
          if (session) {
            try { session.endSession() } catch (_) {}
          }
          session = null
          usingTransaction = false
        }
      } catch (err: any) {
        // Session creation failed or transaction not supported
        if (err?.message?.includes("replica set") || err?.message?.includes("mongos")) {
          // Expected error for standalone MongoDB - silently fallback
          if (session) {
            try { session.endSession() } catch (_) {}
          }
          session = null
          usingTransaction = false
        } else {
          // Unexpected error
          if (session) {
            try { session.endSession() } catch (_) {}
          }
          session = null
          usingTransaction = false
        }
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
          
          // Calculate proper breakdown based on interest model
          const interestModel = (plan as any).interestModel || 'equal'
          let breakdown: { principal: number; interest: number; fees: number }
          if (interestModel === 'equal') {
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

        // Ensure breakdown is always provided (required by schema)
        const breakdown = allocationResult?.breakdown || { 
          principal: Number(amount), 
          interest: 0, 
          fees: 0 
        }
        
        // Validate and normalize breakdown structure
        const normalizedBreakdown = {
          principal: Number(breakdown.principal || amount),
          interest: Number(breakdown.interest || 0),
          fees: Number(breakdown.fees || 0),
          downPaymentApplied: Number(breakdown.downPaymentApplied || 0),
        }
        
        // Validate breakdown values
        if (isNaN(normalizedBreakdown.principal) || isNaN(normalizedBreakdown.interest)) {
          throw new Error(`Invalid breakdown values: principal=${breakdown.principal}, interest=${breakdown.interest}`)
        }
        
        // Ensure paymentDate is a valid Date object
        const paymentDateObj = paymentDate instanceof Date ? paymentDate : new Date(paymentDate)
        if (isNaN(paymentDateObj.getTime())) {
          throw new Error(`Invalid paymentDate: ${paymentDate}`)
        }
        
        // Validate installmentMonth
        const normalizedInstallmentMonth = installmentMonth ? Number(installmentMonth) : 0
        if (installmentMonth && (isNaN(normalizedInstallmentMonth) || normalizedInstallmentMonth < 0)) {
          throw new Error(`Invalid installmentMonth: ${installmentMonth}`)
        }
        
        // Log payment data before creation for debugging
        console.log("=== Creating Payment ===")
        console.log("installmentPlanId:", installmentPlanId)
        console.log("installmentMonth:", normalizedInstallmentMonth)
        console.log("amount:", Number(amount))
        console.log("paymentDate:", paymentDateObj)
        console.log("recordedBy:", req.user?.id)
        console.log("breakdown:", JSON.stringify(normalizedBreakdown, null, 2))
        console.log("========================")
        
        const payment = new Payment({
          installmentPlanId,
          installmentMonth: normalizedInstallmentMonth,
          amount: Number(amount),
          paymentDate: paymentDateObj,
          recordedBy: req.user?.id,
          notes: notes || undefined,
          breakdown: normalizedBreakdown,
        })

        if (usingTransaction && session) {
          try {
            console.log("Saving payment with transaction...")
            await payment.save({ session })
            console.log("Payment saved successfully")
          } catch (paymentErr: any) {
            console.error("=== Payment save error (transaction) ===")
            console.error("Error:", paymentErr?.message)
            console.error("Stack:", paymentErr?.stack)
            console.error("Name:", paymentErr?.name)
            console.error("Errors:", JSON.stringify(paymentErr?.errors, null, 2))
            await session.abortTransaction()
            session.endSession()
            throw paymentErr
          }
          
          try {
            console.log("Saving plan with transaction...")
            await plan.save({ session })
            console.log("Plan saved successfully")
          } catch (planErr: any) {
            console.error("=== Plan save error (transaction) ===")
            console.error("Error:", planErr?.message)
            console.error("Stack:", planErr?.stack)
            console.error("Name:", planErr?.name)
            console.error("Errors:", JSON.stringify(planErr?.errors, null, 2))
            await session.abortTransaction()
            session.endSession()
            throw planErr
          }
          
          await session.commitTransaction()
          session.endSession()
          return res.status(201).json({ payment, allocation: allocationResult })
        }

        // Fallback: non-transactional with compensating actions
        try {
          console.log("Saving payment (non-transactional)...")
          await payment.save()
          console.log("Payment saved successfully")
        } catch (err: any) {
          console.error("=== Payment save error (non-transactional) ===")
          console.error("Error:", err?.message)
          console.error("Stack:", err?.stack)
          console.error("Name:", err?.name)
          console.error("Errors:", JSON.stringify(err?.errors, null, 2))
          if (usingTransaction && session) {
            await session.abortTransaction()
            session.endSession()
          }
          throw err
        }

        try {
          console.log("Saving plan (non-transactional)...")
          await plan.save()
          console.log("Plan saved successfully")
          return res.status(201).json({ payment, allocation: allocationResult })
        } catch (planSaveErr: any) {
          console.error("=== Plan save error (non-transactional) ===")
          console.error("Error:", planSaveErr?.message)
          console.error("Stack:", planSaveErr?.stack)
          console.error("Name:", planSaveErr?.name)
          console.error("Errors:", JSON.stringify(planSaveErr?.errors, null, 2))
          // Attempt to roll back saved payment
          try {
            await Payment.deleteOne({ _id: payment._id })
            console.log("Payment rolled back successfully")
          } catch (cleanupErr) {
            console.error("Failed to cleanup payment after plan save failure:", cleanupErr)
          }
          throw planSaveErr
        }
      } catch (err: any) {
        if (usingTransaction && session) {
          try { await session.abortTransaction() } catch (_) { }
          try { session.endSession() } catch (_) {}
        }
        // Log FULL error details for debugging (server-side only)
        console.error("=== Payment recording error ===")
        console.error("Error message:", err?.message || err)
        console.error("Error stack:", err?.stack)
        console.error("Error name:", err?.name)
        console.error("Error code:", err?.code)
        console.error("Error details:", JSON.stringify(err, null, 2))
        console.error("Request body:", JSON.stringify(req.body, null, 2))
        console.error("User ID:", req.user?.id)
        console.error("================================")
        
        // Check for specific MongoDB validation errors
        if (err?.name === "ValidationError") {
          const validationErrors = Object.values(err.errors || {}).map((e: any) => e.message).join(", ")
          return res.status(400).json({ error: `Validation error: ${validationErrors}` })
        }
        
        // Check for CastError (invalid ObjectId, etc.)
        if (err?.name === "CastError") {
          return res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` })
        }
        
        // Don't expose transaction errors to user - use generic message
        const errorMessage = err?.message?.includes("replica set") || err?.message?.includes("mongos")
          ? "Failed to record payment. Please try again."
          : (err instanceof Error ? err.message : "Failed to record payment")
        return res.status(500).json({ error: errorMessage })
      }
    } catch (error: any) {
      // Log FULL error details for debugging (server-side only)
      console.error("=== Payment recording OUTER error ===")
      console.error("Error message:", error?.message || error)
      console.error("Error stack:", error?.stack)
      console.error("Error name:", error?.name)
      console.error("Error code:", error?.code)
      console.error("Error details:", JSON.stringify(error, null, 2))
      console.error("Request body:", JSON.stringify(req.body, null, 2))
      console.error("User ID:", req.user?.id)
      console.error("====================================")
      
      // Check for specific MongoDB validation errors
      if (error?.name === "ValidationError") {
        const validationErrors = Object.values(error.errors || {}).map((e: any) => e.message).join(", ")
        return res.status(400).json({ error: `Validation error: ${validationErrors}` })
      }
      
      // Check for CastError (invalid ObjectId, etc.)
      if (error?.name === "CastError") {
        return res.status(400).json({ error: `Invalid ${error.path}: ${error.value}` })
      }
      
      // Don't expose transaction errors to user
      const errorMessage = error?.message?.includes("replica set") || error?.message?.includes("mongos")
        ? "Failed to record payment. Please try again."
        : (error instanceof Error ? error.message : "Failed to record payment")
      res.status(500).json({ error: errorMessage })
    }
  },
)

export default router

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_payments"),
  async (req: Request, res: Response) => {
    // Additional role check: Employees cannot directly edit payments
    if (req.user?.role === "employee") {
      return res.status(403).json({ 
        error: "Employees cannot directly edit payments. Please submit a request to admin/manager." 
      });
    }
    try {
      const id = req.params.id;
      const update = req.body as Partial<{ amount: number; paymentDate: string; installmentMonth: number; notes: string }>

      // Try transaction, fallback to non-transactional with compensating actions
      let session: any = null
      let usingTransaction = false
      try {
        session = await mongoose.startSession()
        try {
          session.startTransaction()
          usingTransaction = true
        } catch (txErr: any) {
          // Transaction not supported (e.g., standalone MongoDB)
          if (session) {
            try { session.endSession() } catch (_) {}
          }
          session = null
          usingTransaction = false
        }
      } catch (err: any) {
        // Session creation failed or transaction not supported
        if (err?.message?.includes("replica set") || err?.message?.includes("mongos")) {
          // Expected error for standalone MongoDB - silently fallback
          if (session) {
            try { session.endSession() } catch (_) {}
          }
          session = null
          usingTransaction = false
        } else {
          // Unexpected error
          if (session) {
            try { session.endSession() } catch (_) {}
          }
          session = null
          usingTransaction = false
        }
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
      } catch (err: any) {
        if (usingTransaction && session) {
          try { await session.abortTransaction() } catch (_) { }
          try { session.endSession() } catch (_) {}
        }
        // Don't expose transaction errors to user
        const errorMessage = err?.message?.includes("replica set") || err?.message?.includes("mongos")
          ? "Failed to edit payment. Please try again."
          : (err instanceof Error ? err.message : 'Failed to edit payment')
        return res.status(500).json({ error: errorMessage })
      }
    } catch (error: any) {
      // Don't expose transaction errors to user
      const errorMessage = error?.message?.includes("replica set") || error?.message?.includes("mongos")
        ? "Failed to edit payment. Please try again."
        : (error instanceof Error ? error.message : 'Failed to edit payment')
      return res.status(500).json({ error: errorMessage });
    }
  },
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
          await Payment.deleteOne({ _id: paymentId });
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
        await Payment.deleteOne({ _id: r.paymentId });
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

router.put(
  "/requests/:id/reject",
  authenticate,
  authorizePermission("manage_payments"),
  [param("id").isMongoId().withMessage("Invalid request id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const r = await PaymentRequest.findById(req.params.id);
      if (!r) return res.status(404).json({ error: "Request not found" });
      if (r.status !== "pending") return res.status(400).json({ error: "Request not pending" });

      r.status = "rejected";
      r.reviewedBy = req.user?.id as any;
      r.reviewedAt = new Date();
      r.reviewComment = req.body.reviewComment;
      await r.save();

      res.json(r);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to reject payment request" });
    }
  },
);

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_payments"),
  async (req: Request, res: Response) => {
    // Additional role check: Employees cannot directly delete payments
    if (req.user?.role === "employee") {
      return res.status(403).json({ 
        error: "Employees cannot directly delete payments. Please submit a request to admin/manager." 
      });
    }
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
      } catch (err: any) {
        if (usingTransaction && session) {
          try { await session.abortTransaction() } catch (_) { }
          try { session.endSession() } catch (_) {}
        }
        // Don't expose transaction errors to user
        const errorMessage = err?.message?.includes("replica set") || err?.message?.includes("mongos")
          ? "Failed to delete payment. Please try again."
          : (err instanceof Error ? err.message : 'Failed to delete payment')
        return res.status(500).json({ error: errorMessage })
      }
    } catch (error: any) {
      // Don't expose transaction errors to user
      const errorMessage = error?.message?.includes("replica set") || error?.message?.includes("mongos")
        ? "Failed to delete payment. Please try again."
        : (error instanceof Error ? error.message : 'Failed to delete payment')
      return res.status(500).json({ error: errorMessage });
    }
  },
)


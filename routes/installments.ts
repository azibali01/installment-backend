import express, { type Request, type Response } from "express"
import mongoose from "mongoose"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import Product from "../models/Product.js"
import { encryptPII, maskCnic } from "../utils/crypto.js"
import { generateSchedule } from "../utils/finance.js"
import { body, param, query } from "express-validator"
import { validateRequest } from "../middleware/validate.js"
import { asyncHandler } from "../middleware/asyncHandler.js"
import { NotFoundError, ConflictError, ValidationError } from "../utils/errors.js"

const router = express.Router()

router.get(
  "/",
  authenticate,
  [
    query("customerId").optional().isMongoId().withMessage("customerId must be a valid id"),
    // Removed status filter, approval/reject logic
    query("search").optional().isString().withMessage("search must be a string"),
    query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { customerId, search } = req.query as { customerId?: string; search?: string }
    const page = Number.parseInt((req.query.page as string) || "1") || 1
    const limit = Number.parseInt((req.query.limit as string) || "20") || 20

    const filter: Record<string, any> = {}
    if (customerId) filter.customerId = customerId
    // Removed status filter

    // Server-side search implementation
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i")
      
      // Find matching customers and products first
      const [matchingCustomers, matchingProducts] = await Promise.all([
        (await import("../models/Customer.js")).default.find({ name: searchRegex }).select("_id"),
        Product.find({ name: searchRegex }).select("_id")
      ])

      const customerIds = matchingCustomers.map(c => c._id)
      const productIds = matchingProducts.map(p => p._id)

      filter.$or = [
        { installmentId: searchRegex },
        { reference: searchRegex },
        { customerId: { $in: customerIds } },
        { productId: { $in: productIds } }
      ]
    }

    const total = await InstallmentPlan.countDocuments(filter)
    const includeSchedule = req.query.includeSchedule === "true"
    const query = InstallmentPlan.find(filter)
      .populate("customerId", "name phone")
      .populate("productId", "name price")
      // Removed populate for approvedBy
    
    // Only exclude schedule if not explicitly requested
    if (!includeSchedule) {
      query.select("-installmentSchedule")
    }
    
    const installments = await query
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean() // Use lean for better performance

    res.json({ data: installments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  }),
)

router.get("/:id", authenticate, asyncHandler(async (req: Request, res: Response) => {
  const installment = await InstallmentPlan.findById(req.params.id).populate("customerId").populate("productId")
  if (!installment) {
    throw new NotFoundError("Installment plan")
  }
  res.json(installment)
}))

router.post(
  "/",
  authenticate,
  authorizePermission("manage_installments"),
  [
    body("customerId").notEmpty().withMessage("customerId is required").isMongoId().withMessage("customerId must be a valid id"),
    body("productId").notEmpty().withMessage("productId is required").isMongoId().withMessage("productId must be a valid id"),
    body("markupPercent").optional().isFloat({ min: 0 }).withMessage("markupPercent must be >= 0"),
    body("downPayment").isFloat({ min: 0 }).withMessage("downPayment must be >= 0"),
    body("numberOfMonths").isInt({ gt: 0 }).withMessage("numberOfMonths must be > 0"),
    // bank fields are completely optional
    body("bankCheque.bankName").optional({ checkFalsy: true }).isString().withMessage("bank name must be a string"),
    body("bankCheque.accountNumber").optional({ checkFalsy: true }).isString().withMessage("account number must be a string"),
    body("bankCheque.branch").optional({ checkFalsy: true }).isString().withMessage("branch must be a string"),
    body("bankCheque.chequeNumber").optional({ checkFalsy: true }).isString().withMessage("cheque number must be a string"),
    body("startDate").optional().isISO8601().toDate().withMessage("startDate must be a valid date"),
    body("roundingPolicy").optional().isIn(["nearest", "up", "down"]).withMessage("Invalid roundingPolicy"),
    body("interestModel").optional().isIn(["amortized", "flat", "equal"]).withMessage("Invalid interestModel"),
    body("reference").optional().isString().isLength({ max: 200 }).withMessage("reference must be a string up to 200 characters"),
    body("installmentId").optional().isString().isLength({ min: 1, max: 50 }).withMessage("installmentId must be a string between 1-50 characters"),
    body("guarantors").custom((val, { req }) => {
      // If reference is provided, guarantors are optional
      if (req.body.reference) {
        // If guarantors provided, validate them
        if (val && Array.isArray(val)) {
          if (val.length > 0 && val.length !== 2) {
            throw new Error("If providing guarantors, exactly 2 are required");
          }
          if (val.length === 2) {
            for (const g of val) {
              if (g.cnic) {
                const digits = String(g.cnic).replace(/\D/g, "");
                if (digits.length !== 13) throw new Error("guarantor CNIC must be 13 digits");
              }
            }
          }
        }
        return true;
      }
      // If no reference, guarantors are required
      if (!val || !Array.isArray(val) || val.length !== 2) {
        throw new Error("Two guarantors are required when no reference is provided");
      }
      for (const g of val) {
        if (!g.cnic) throw new Error("guarantor CNIC is required");
        const digits = String(g.cnic).replace(/\D/g, "");
        if (digits.length !== 13) throw new Error("guarantor CNIC must be 13 digits");
      }
      return true;
    }),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const {
        customerId,
        productId,
        markupPercent,
        downPayment,
        numberOfMonths,
        bankCheque,
        guarantors,
        startDate: startDateInput,
        roundingPolicy,
        interestModel,
        installmentSchedule: clientSchedule,
        reference,
        installmentId,
      } = req.body

      // Check if provided installmentId already exists
      if (installmentId) {
        const existing = await InstallmentPlan.findOne({ installmentId })
        if (existing) {
          throw new ConflictError(`Installment ID "${installmentId}" already exists`)
        }
      }

      const startDate = startDateInput ? new Date(startDateInput) : new Date()
      const endDate = new Date(startDate)
      endDate.setMonth(endDate.getMonth() + Number(numberOfMonths))

      // compute authoritative totalAmount from product price + markupPercent
      const prod = await Product.findById(productId)
      const basePrice = prod ? Number(prod.price || 0) : 0
      const markup = Number(markupPercent !== undefined ? markupPercent : 40)
      const totalAmountComputed = Number(basePrice) + (Number(basePrice) * Number(markup) / 100)
      const remainingBalance = Number(totalAmountComputed) - Number(downPayment)

      // generate authoritative schedule on server
      const serverSchedule = generateSchedule(
        remainingBalance,
        Number(markup),
        Number(numberOfMonths),
        startDate,
        (roundingPolicy as any) || "nearest",
        (interestModel as any) || "equal",
      )

      let monthlyInstallment = 0
      if (serverSchedule.length > 0) {
        monthlyInstallment = serverSchedule[0].amount
      }

      if (Array.isArray(clientSchedule) && clientSchedule.length) {
        const mismatch = clientSchedule.length !== serverSchedule.length || clientSchedule.some((cs: any, idx: number) => {
          const ss = serverSchedule[idx]
          if (!ss) return true
          return Math.abs(Number(cs.amount) - Number(ss.amount)) > 1
        })
        if (mismatch) {
          throw new ValidationError("Provided installment schedule does not match server calculation")
        }
      }

      // Approval logic removed

      let processedGuarantors: any[] | undefined = undefined
      if (Array.isArray(guarantors) && guarantors.length > 0) {
        processedGuarantors = guarantors.map((g: any) => {
          const cnicRaw = String(g.cnic || "");
          const cnicMasked = maskCnic(cnicRaw);
          const cnicEncrypted = encryptPII(cnicRaw);
          return {
            name: g.name || undefined,
            relation: g.relation || undefined,
            phone: g.phone || undefined,
            cnicMasked,
            cnicEncrypted,
          }
        })
      }

      const plan = new InstallmentPlan({
        installmentId: installmentId || undefined,
        customerId,
        productId,
        bankCheque: bankCheque || undefined,
        guarantors: processedGuarantors,
        totalAmount: totalAmountComputed,
        markupPercent: markup,
        downPayment,
        remainingBalance,
        monthlyInstallment,
        numberOfMonths,
        startDate,
        endDate,
        installmentSchedule: serverSchedule,
        roundingPolicy: roundingPolicy || "nearest",
        interestModel: interestModel || "amortized",
        createdBy: req.user?.id,
        reference: reference || undefined,
      })

    await plan.save()
    res.status(201).json(plan)
  }),
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_installments"),
  [param("id").isMongoId().withMessage("Invalid installment id"), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    // REMOVE TRANSACTION: Not needed for single-document update, and causes error on standalone MongoDB
    // const session = await mongoose.startSession()
    // session.startTransaction()
    try {
      const update = req.body as any
      const planDoc = await InstallmentPlan.findById(req.params.id)
      if (!planDoc) {
        throw new NotFoundError("Installment plan")
      }
      const markupPercent = update.markupPercent !== undefined ? Number(update.markupPercent) : Number(planDoc.markupPercent || 40)
      const downPayment = update.downPayment !== undefined ? Number(update.downPayment) : Number(planDoc.downPayment)
      const numberOfMonths = update.numberOfMonths !== undefined ? Number(update.numberOfMonths) : Number(planDoc.numberOfMonths)
      const startDate = update.startDate ? new Date(update.startDate) : new Date(planDoc.startDate)
      const roundingPolicy = update.roundingPolicy || planDoc.roundingPolicy || "nearest"
      const interestModel = update.interestModel || planDoc.interestModel || "amortized"
      
      const productIdToUse = update.productId !== undefined ? update.productId : (typeof planDoc.productId === "string" ? planDoc.productId : planDoc.productId?._id)
      const prod = productIdToUse ? await Product.findById(productIdToUse) : null
      // If product not found, calculate basePrice backwards from existing totalAmount to avoid double markup
      let basePrice: number
      if (prod) {
        basePrice = Number(prod.price || 0)
      } else {
        // Calculate original basePrice from totalAmount: basePrice = totalAmount / (1 + markupPercent/100)
        const existingMarkup = Number(planDoc.markupPercent || 40)
        const existingTotal = Number(planDoc.totalAmount || 0)
        basePrice = existingTotal / (1 + existingMarkup / 100)
      }
      const totalAmount = Number(basePrice) + (Number(basePrice) * Number(markupPercent) / 100)
      const remainingBalance = totalAmount - downPayment
      
      const serverSchedule = generateSchedule(
        remainingBalance,
        markupPercent,
        numberOfMonths,
        startDate,
        (roundingPolicy as any) || "nearest",
        (interestModel as any) || "equal",
      )
      
      if (Array.isArray(update.installmentSchedule) && update.installmentSchedule.length) {
        const clientSchedule = update.installmentSchedule
        const mismatch = clientSchedule.length !== serverSchedule.length || clientSchedule.some((cs: any, idx: number) => {
          const ss = serverSchedule[idx]
          if (!ss) return true
          return Math.abs(Number(cs.amount) - Number(ss.amount)) > 1
        })
        if (mismatch) return res.status(400).json({ error: "Provided installment schedule does not match server calculation" })
      }
      
      // Handle guarantors - if reference is provided, guarantors are optional
      let processedGuarantors: any[] | undefined = undefined
      const hasReference = update.reference && String(update.reference).trim()
      
      if (Array.isArray(update.guarantors) && update.guarantors.length) {
        // If reference is provided, only process guarantors that have CNIC
        const guarantorsToProcess = hasReference 
          ? update.guarantors.filter((g: any) => g.cnic && String(g.cnic).trim())
          : update.guarantors
        
        if (guarantorsToProcess.length > 0) {
          processedGuarantors = guarantorsToProcess.map((g: any) => {
            const cnicRaw = String(g.cnic || "")
            const cnicMasked = maskCnic(cnicRaw)
            const cnicEncrypted = encryptPII(cnicRaw)
            return {
              name: g.name || undefined,
              relation: g.relation || undefined,
              phone: g.phone || undefined,
              cnicMasked,
              cnicEncrypted,
            }
          })
        }
      }
      
      // If reference is provided and no guarantors, set to undefined
      if (hasReference && (!processedGuarantors || processedGuarantors.length === 0)) {
        processedGuarantors = undefined
      }
      
      const finalUpdate: any = {
        ...update,
        totalAmount,
        markupPercent,
        downPayment,
        remainingBalance,
        monthlyInstallment: serverSchedule.length ? serverSchedule[0].amount : 0,
        numberOfMonths,
        startDate,
        endDate: (() => { const d = new Date(startDate); d.setMonth(d.getMonth() + numberOfMonths); return d })(),
        installmentSchedule: serverSchedule,
        roundingPolicy,
        interestModel,
        reference: update.reference && String(update.reference).trim() ? String(update.reference).trim() : undefined,
      }
      
      // Handle guarantors - if reference is provided and no guarantors, set to undefined
      if (hasReference && (!processedGuarantors || processedGuarantors.length === 0)) {
        finalUpdate.guarantors = undefined
      } else if (processedGuarantors && processedGuarantors.length > 0) {
        finalUpdate.guarantors = processedGuarantors
      }
      
      // Handle bankCheque - if reference is provided, bank details are optional
      if (hasReference && (!update.bankCheque || !Object.keys(update.bankCheque).some(key => update.bankCheque[key]))) {
        finalUpdate.bankCheque = undefined
      } else if (update.bankCheque && Object.keys(update.bankCheque).some(key => update.bankCheque[key])) {
        finalUpdate.bankCheque = update.bankCheque
      }
      
      const updated = await InstallmentPlan.findByIdAndUpdate(req.params.id, finalUpdate, { new: true })
      if (!updated) {
        throw new NotFoundError("Installment plan")
      }
      res.json(updated)
    } catch (error) {
      // No session to abort, just throw
      throw error
    }
  }),
)

// Approval endpoint removed

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_installments"),
  [param("id").isMongoId().withMessage("Invalid installment id"), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    // Attempt a transaction; if not available (standalone Mongo), fall back to guarded non-transactional flow.
    let session: any = null
    let usingTransaction = false
    try {
      const db = mongoose.connection?.db
      if (db) {
        const admin = db.admin()
        let helloRes: any
        try {
          helloRes = await admin.command({ hello: 1 })
        } catch (e) {
          helloRes = await admin.command({ ismaster: 1 })
        }
        if (helloRes && (helloRes.setName || helloRes.msg === "isdbgrid")) {
          session = await InstallmentPlan.startSession()
          await session.startTransaction()
          usingTransaction = true
        }
      } else {
        usingTransaction = false
      }
    } catch (e: any) {
      if (session) {
        try { await session.endSession() } catch (er) {}
      }
      session = null
      usingTransaction = false
    }

    try {
      const plan = session ? await InstallmentPlan.findById(req.params.id).session(session) : await InstallmentPlan.findById(req.params.id)
      if (!plan) throw new NotFoundError("Installment plan")

      const Payment = (await import("../models/Payment.js")).default
      // Find payments related to this plan (exclude reversed)
      const paymentsQuery = Payment.find({ installmentPlanId: plan._id, status: { $ne: "reversed" } }).select("amount receivedBy").lean()
      if (session) paymentsQuery.session(session)
      const payments = await paymentsQuery

      // Sum amounts per receivedBy user
      const sums: Record<string, number> = {}
      for (const p of payments) {
        if (!p.receivedBy) continue
        const id = String(p.receivedBy)
        sums[id] = (sums[id] || 0) + (Number(p.amount) || 0)
      }

      const User = (await import("../models/User.js")).default
      if (usingTransaction && session) {
        for (const userId of Object.keys(sums)) {
          await User.findByIdAndUpdate(userId, { $inc: { cashBalance: -Math.abs(sums[userId]) } }, { session })
        }
        await Payment.deleteMany({ installmentPlanId: plan._id }).session(session)
        await InstallmentPlan.findByIdAndDelete(req.params.id).session(session)
        await session.commitTransaction()
        session.endSession()
        res.json({ success: true })
      } else {
        // Non-transactional fallback: apply guarded updates and delete payments; if anything fails, attempt best-effort compensation
        try {
          for (const userId of Object.keys(sums)) {
            await User.findByIdAndUpdate(userId, { $inc: { cashBalance: -Math.abs(sums[userId]) } })
          }
          await Payment.deleteMany({ installmentPlanId: plan._id })
          await InstallmentPlan.findByIdAndDelete(req.params.id)
          res.json({ success: true })
        } catch (innerErr) {
          // Attempt to revert user balance changes if possible (best-effort)
          try {
            for (const userId of Object.keys(sums)) {
              await User.findByIdAndUpdate(userId, { $inc: { cashBalance: Math.abs(sums[userId]) } })
            }
          } catch (revertErr) {
            // log and continue
          }
          throw innerErr
        }
      }
    } catch (err) {
      if (usingTransaction && session) {
        try { await session.abortTransaction() } catch (e) {}
        session.endSession()
      }
      throw err
    }
  }),
)

export default router

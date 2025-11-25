import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import InstallmentPlan from "../models/InstallmentPlan.js"
import Product from "../models/Product.js"
import { encryptPII, maskCnic } from "../utils/crypto.js"
import { generateSchedule } from "../utils/finance.js"
import { body, param, query } from "express-validator"
import { validateRequest } from "../middleware/validate.js"

const router = express.Router()

router.get(
  "/",
  authenticate,
  [
    query("customerId").optional().isMongoId().withMessage("customerId must be a valid id"),
    query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.query as { customerId?: string }
      const page = Number.parseInt((req.query.page as string) || "1") || 1
      const limit = Number.parseInt((req.query.limit as string) || "20") || 20

      const filter: Record<string, any> = {}
      if (customerId) filter.customerId = customerId

      const total = await InstallmentPlan.countDocuments(filter)
      const installments = await InstallmentPlan.find(filter)
        .populate("customerId")
        .populate("productId")
        .populate("approvedBy")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)

      res.json({ data: installments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch installments" })
    }
  },
)

router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const installment = await InstallmentPlan.findById(req.params.id).populate("customerId").populate("productId")
    res.json(installment)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch installment" })
  }
})

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
    body("bankCheque.bankName").notEmpty().withMessage("bank name is required"),
    body("bankCheque.accountNumber").notEmpty().withMessage("account number is required"),
    body("startDate").optional().isISO8601().toDate().withMessage("startDate must be a valid date"),
    body("roundingPolicy").optional().isIn(["nearest", "up", "down"]).withMessage("Invalid roundingPolicy"),
    body("interestModel").optional().isIn(["amortized", "flat", "equal"]).withMessage("Invalid interestModel"),
    body("guarantors").isArray({ min: 2, max: 2 }).withMessage("Two guarantors are required"),
    body("guarantors.*.cnic").custom((val) => {
      if (!val) throw new Error("guarantor CNIC is required");
      const digits = String(val).replace(/\D/g, "");
      if (digits.length !== 13) throw new Error("CNIC must be 13 digits");
      return true;
    }),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
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
      } = req.body

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
          return res.status(400).json({ error: "Provided installment schedule does not match server calculation" })
        }
      }

      const creatorRole = req.user?.role
      const autoApprove = creatorRole === "admin" || creatorRole === "manager"

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
        status: autoApprove ? "approved" : "pending",
        approvedBy: autoApprove ? req.user?.id : undefined,
      })

      await plan.save()
      res.status(201).json(plan)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create installment" })
    }
  },
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_installments"),
  [param("id").isMongoId().withMessage("Invalid installment id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const update = req.body as any

      const planDoc = await InstallmentPlan.findById(req.params.id)
      if (!planDoc) return res.status(404).json({ error: "Installment not found" })

      const markupPercent = update.markupPercent !== undefined ? Number(update.markupPercent) : Number(planDoc.markupPercent || 40)
      const downPayment = update.downPayment !== undefined ? Number(update.downPayment) : Number(planDoc.downPayment)
      const numberOfMonths = update.numberOfMonths !== undefined ? Number(update.numberOfMonths) : Number(planDoc.numberOfMonths)
      const startDate = update.startDate ? new Date(update.startDate) : new Date(planDoc.startDate)
      const roundingPolicy = update.roundingPolicy || planDoc.roundingPolicy || "nearest"
      const interestModel = update.interestModel || planDoc.interestModel || "amortized"

      const productIdToUse = update.productId !== undefined ? update.productId : (typeof planDoc.productId === "string" ? planDoc.productId : planDoc.productId?._id)
      const prod = productIdToUse ? await Product.findById(productIdToUse) : null
      const basePrice = prod ? Number(prod.price || 0) : Number(planDoc.totalAmount || 0)
      const totalAmount = Number(basePrice) + (Number(basePrice) * Number(markupPercent) / 100)
      const remainingBalance = totalAmount - downPayment

      const serverSchedule = generateSchedule(
        remainingBalance,
        markupPercent,
        numberOfMonths,
        startDate,
        roundingPolicy as any,
        interestModel as any,
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

      let processedGuarantors: any[] | undefined = undefined
      if (Array.isArray(update.guarantors) && update.guarantors.length) {
        processedGuarantors = update.guarantors.map((g: any) => {
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
      }

      if (processedGuarantors) finalUpdate.guarantors = processedGuarantors

      const updated = await InstallmentPlan.findByIdAndUpdate(req.params.id, finalUpdate, { new: true })
      res.json(updated)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update installment" })
    }
  },
)

router.put(
  "/:id/approve",
  authenticate,
  authorizePermission("approve_installments"),
  [param("id").isMongoId().withMessage("Invalid installment id"), validateRequest],
  async (req: Request, res: Response) => {
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
  },
)

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_installments"),
  [param("id").isMongoId().withMessage("Invalid installment id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const deleted = await InstallmentPlan.findByIdAndDelete(req.params.id)
      if (!deleted) return res.status(404).json({ error: "Installment not found" })
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete installment" })
    }
  },
)

export default router

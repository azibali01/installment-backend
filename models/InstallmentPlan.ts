import mongoose, { Schema, type Document } from "mongoose"
import { getNextSequence } from "../utils/counters.js"
import Payment from "./Payment.js"
import User from "./User.js"
import { calculateRemainingBalance } from "../utils/finance.js"

export interface IInstallmentPlan extends Document {
  installmentId?: string
  customerId: mongoose.Types.ObjectId
  productId: mongoose.Types.ObjectId
  createdBy?: mongoose.Types.ObjectId
  bankCheque?: {
    bankName?: string
    branch?: string
    accountNumber?: string
    chequeNumber?: string
  }
  totalAmount: number
  downPayment: number
  remainingBalance: number
  monthlyInstallment: number
  numberOfMonths: number
  startDate: Date
  endDate: Date
  roundingPolicy: "nearest" | "up" | "down"
  interestModel: "amortized" | "flat" | "equal"
  markupPercent?: number
  // Removed status and approvedBy fields
  reference?: string
  guarantors?: Array<{
    name?: string
    relation?: string
    phone?: string
    cnicMasked?: string
    cnicEncrypted?: string
  }>
  installmentSchedule: Array<{
    month: number
    dueDate: Date
    amount: number
    status: "pending" | "paid" | "overdue"
    paidDate?: Date
    paidAmount?: number
    principal?: number
    interest?: number
    balance?: number
  }>
  createdAt: Date
  updatedAt: Date
}

const installmentPlanSchema = new Schema<IInstallmentPlan>(
  {
    installmentId: { type: String, unique: true, sparse: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    bankCheque: {
      bankName: { type: String },
      branch: { type: String },
      accountNumber: { type: String },
      chequeNumber: { type: String },
    },
    totalAmount: { type: Number, required: true },
    downPayment: { type: Number, required: true },
    remainingBalance: { type: Number, required: true },
    monthlyInstallment: { type: Number, required: true },
    numberOfMonths: { type: Number, required: true },
    startDate: { type: Date, required: true },
    markupPercent: { type: Number, default: 40 },
    roundingPolicy: { type: String, enum: ["nearest", "up", "down"], default: "nearest" },
    interestModel: { type: String, enum: ["amortized", "flat", "equal"], default: "equal" },
    endDate: { type: Date, required: true },
    // Removed status and approvedBy fields
    reference: { type: String },
    guarantors: [
      {
        name: String,
        relation: String,
        phone: String,
        cnicMasked: String,
        cnicEncrypted: String,
      },
    ],
    installmentSchedule: [
      {
        month: Number,
        dueDate: Date,
        amount: Number,
        status: { type: String, enum: ["pending", "paid", "overdue"], default: "pending" },
        paidDate: Date,
        paidAmount: { type: Number, default: 0 },
        principal: Number,
        interest: Number,
        balance: Number,
      },
    ],
  },
  { timestamps: true },
)

installmentPlanSchema.pre("save", async function (next) {
  // Auto-generate installmentId if not provided and this is a new document
  if (this.isNew && !this.installmentId) {
    try {
      // Use counter collection for numeric IDs
      const nextNum = await getNextSequence("installmentId")
      this.installmentId = String(nextNum)
    } catch (error) {
      // Fallback: Find the maximum numeric installmentId and increment by 1
      try {
        const maxPlan = await mongoose.model<IInstallmentPlan>("InstallmentPlan")
          .findOne({ installmentId: { $exists: true, $regex: /^\d+$/ } })
          .sort({ installmentId: -1 })
          .select("installmentId")
          .lean()
        
        if (maxPlan && maxPlan.installmentId) {
          const maxNum = parseInt(maxPlan.installmentId, 10)
          this.installmentId = String(isNaN(maxNum) ? 1 : maxNum + 1)
        } else {
          this.installmentId = "1"
        }
      } catch (fallbackError) {
        // If error, start from 1
        this.installmentId = "1"
      }
    }
  }
  next()
})

installmentPlanSchema.index({ customerId: 1 })
installmentPlanSchema.index({ createdAt: -1 })
// Removed status index
installmentPlanSchema.index({ productId: 1 })
installmentPlanSchema.index({ "installmentSchedule.dueDate": 1 }) // For reports and overdue queries

// Cascade-delete related payments when an InstallmentPlan is removed.
// Handles both document `.remove()` and query-based deletions like `findOneAndDelete()`.
// Cascade logic handled in the installments route to ensure transactional safety.

export default mongoose.model<IInstallmentPlan>("InstallmentPlan", installmentPlanSchema)

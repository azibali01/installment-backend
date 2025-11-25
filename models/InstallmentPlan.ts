import mongoose, { Schema, type Document } from "mongoose"

export interface IInstallmentPlan extends Document {
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
  status: "pending" | "approved" | "rejected" | "completed"
  approvedBy?: mongoose.Types.ObjectId
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
  }>
  createdAt: Date
  updatedAt: Date
}

const installmentPlanSchema = new Schema<IInstallmentPlan>(
  {
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
    status: { type: String, enum: ["pending", "approved", "rejected", "completed"], default: "pending" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
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
      },
    ],
  },
  { timestamps: true },
)

installmentPlanSchema.index({ customerId: 1 })
installmentPlanSchema.index({ createdAt: -1 })

export default mongoose.model<IInstallmentPlan>("InstallmentPlan", installmentPlanSchema)

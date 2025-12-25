import mongoose, { Schema, type Document } from "mongoose"

export interface PaymentBreakdown {
  principal: number
  interest: number
  fees?: number
  downPaymentApplied?: number
}

export interface AppliedMonth {
  month: number
  applied: number
}

export interface IPayment extends Document {
  installmentPlanId: mongoose.Types.ObjectId
  installmentMonth: number
  amount: number
  paymentDate: Date
  recordedBy: mongoose.Types.ObjectId
  receivedBy?: mongoose.Types.ObjectId
  notes?: string
  breakdown?: PaymentBreakdown
  allocation?: AppliedMonth[]
  idempotencyKey?: string
  status?: "recorded" | "reversed" | "failed"
  createdAt: Date
  updatedAt: Date
}

const appliedMonthSchema = new Schema<AppliedMonth>(
  {
    month: { type: Number, required: true },
    applied: { type: Number, required: true },
  },
  { _id: false },
)

const paymentSchema = new Schema<IPayment>(
  {
    installmentPlanId: { type: Schema.Types.ObjectId, ref: "InstallmentPlan", required: true },
    installmentMonth: { type: Number, required: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: String,
    breakdown: {
      principal: { type: Number, required: true },
      interest: { type: Number, required: true },
      fees: { type: Number, default: 0 },
      downPaymentApplied: { type: Number, default: 0 },
    },
    allocation: { type: [appliedMonthSchema], default: [] },
    idempotencyKey: { type: String, index: true },
    status: { type: String, enum: ["recorded", "reversed", "failed"], default: "recorded" },
  },
  { timestamps: true },
)

// Indexes for faster queries
paymentSchema.index({ installmentPlanId: 1, paymentDate: -1 })
paymentSchema.index({ recordedBy: 1 })
paymentSchema.index({ receivedBy: 1 })
paymentSchema.index({ status: 1 })

// Add indexes for frequently queried fields
paymentSchema.index({ installmentPlanId: 1 })
paymentSchema.index({ paymentDate: -1 })
paymentSchema.index({ recordedBy: 1 })
paymentSchema.index({ createdAt: -1 })
paymentSchema.index({ status: 1 })

export default mongoose.model<IPayment>("Payment", paymentSchema)

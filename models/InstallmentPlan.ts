import mongoose, { Schema, type Document } from "mongoose"

export interface IInstallmentPlan extends Document {
  customerId: mongoose.Types.ObjectId
  productId: mongoose.Types.ObjectId
  createdBy?: mongoose.Types.ObjectId
  totalAmount: number
  downPayment: number
  remainingBalance: number
  monthlyInstallment: number
  interestRate: number
  numberOfMonths: number
  startDate: Date
  endDate: Date
  status: "pending" | "approved" | "rejected" | "completed"
  approvedBy?: mongoose.Types.ObjectId
  installmentSchedule: Array<{
    month: number
    dueDate: Date
    amount: number
    status: "pending" | "paid" | "overdue"
    paidDate?: Date
  }>
  createdAt: Date
  updatedAt: Date
}

const installmentPlanSchema = new Schema<IInstallmentPlan>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    totalAmount: { type: Number, required: true },
    downPayment: { type: Number, required: true },
    remainingBalance: { type: Number, required: true },
    monthlyInstallment: { type: Number, required: true },
    interestRate: { type: Number, required: true },
    numberOfMonths: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected", "completed"], default: "pending" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    installmentSchedule: [
      {
        month: Number,
        dueDate: Date,
        amount: Number,
        status: { type: String, enum: ["pending", "paid", "overdue"], default: "pending" },
        paidDate: Date,
      },
    ],
  },
  { timestamps: true },
)

export default mongoose.model<IInstallmentPlan>("InstallmentPlan", installmentPlanSchema)

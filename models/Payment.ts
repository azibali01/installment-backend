import mongoose, { Schema, type Document } from "mongoose"

export interface IPayment extends Document {
  installmentPlanId: mongoose.Types.ObjectId
  installmentMonth: number
  amount: number
  paymentDate: Date
  recordedBy: mongoose.Types.ObjectId
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const paymentSchema = new Schema<IPayment>(
  {
    installmentPlanId: { type: Schema.Types.ObjectId, ref: "InstallmentPlan", required: true },
    installmentMonth: { type: Number, required: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    notes: String,
  },
  { timestamps: true },
)

export default mongoose.model<IPayment>("Payment", paymentSchema)

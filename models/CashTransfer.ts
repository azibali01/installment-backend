import mongoose, { Schema, type Document } from "mongoose"

export interface ICashTransfer extends Document {
  fromUser: mongoose.Types.ObjectId
  toUser: mongoose.Types.ObjectId
  amount: number
  notes?: string
  status: "pending" | "completed" | "rejected"
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const cashTransferSchema = new Schema<ICashTransfer>(
  {
    fromUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, max: 500 },
    status: { type: String, enum: ["pending", "completed", "rejected"], default: "completed" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
)

// Indexes for faster queries
cashTransferSchema.index({ fromUser: 1, createdAt: -1 })
cashTransferSchema.index({ toUser: 1, createdAt: -1 })
cashTransferSchema.index({ status: 1 })

export default mongoose.model<ICashTransfer>("CashTransfer", cashTransferSchema)


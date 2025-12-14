import mongoose, { Schema } from "mongoose"

const PaymentRequestSchema = new Schema(
    {
        paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true },
        type: { type: String, enum: ["edit", "delete"], required: true },
        requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        requestedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        changes: { type: Schema.Types.Mixed },
        reason: { type: String },
        reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
        reviewedAt: { type: Date },
        reviewComment: { type: String },
    },
    { timestamps: true },
)

PaymentRequestSchema.index({ paymentId: 1 })
PaymentRequestSchema.index({ requestedBy: 1 })
PaymentRequestSchema.index({ status: 1 })

export default mongoose.model("PaymentRequest", PaymentRequestSchema)


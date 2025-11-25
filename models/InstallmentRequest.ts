import mongoose, { Schema } from "mongoose"

const InstallmentRequestSchema = new Schema(
    {
        installmentId: { type: Schema.Types.ObjectId, ref: "InstallmentPlan", required: true },
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

export default mongoose.model("InstallmentRequest", InstallmentRequestSchema)

import mongoose, { Schema, type Document } from "mongoose"

export interface IContactLog extends Document {
    planId?: mongoose.Types.ObjectId
    customerId?: mongoose.Types.ObjectId
    scheduleIndex?: number
    contactedBy?: mongoose.Types.ObjectId
    response?: string
    contactMethod?: string
    nextContactDate?: Date
    contactDate: Date
    notes?: string
}

const contactLogSchema = new Schema<IContactLog>(
    {
        planId: { type: Schema.Types.ObjectId, ref: "InstallmentPlan" },
        customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
        scheduleIndex: { type: Number },
        contactedBy: { type: Schema.Types.ObjectId, ref: "User" },
        response: { type: String },
        contactMethod: { type: String },
        nextContactDate: { type: Date },
        contactDate: { type: Date, default: () => new Date() },
        notes: { type: String },
    },
    { timestamps: true },
)

contactLogSchema.index({ planId: 1 })
contactLogSchema.index({ customerId: 1 })
contactLogSchema.index({ nextContactDate: 1 })

export default mongoose.model<IContactLog>("ContactLog", contactLogSchema)

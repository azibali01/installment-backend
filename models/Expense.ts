import mongoose, { Schema, type Document } from "mongoose"

export interface IExpense extends Document {
  category:
  | "salary"
  | "rent"
  | "utilities"
  | "inventory_purchase"
  | "supplies"
  | "marketing"
  | "maintenance"
  | "logistics"
  | "taxes"
  | "other"
  amount: number
  date: Date
  description: string
  userId: mongoose.Types.ObjectId
  relatedUser?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const expenseSchema = new Schema<IExpense>(
  {
    category: {
      type: String,
      enum: [
        "salary",
        "rent",
        "utilities",
        "inventory_purchase",
        "supplies",
        "marketing",
        "maintenance",
        "logistics",
        "taxes",
        "other",
      ],
      required: true,
    },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    description: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    relatedUser: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
)

// Indexes for faster queries
expenseSchema.index({ userId: 1, date: -1 })
expenseSchema.index({ category: 1 })
expenseSchema.index({ relatedUser: 1 })

export default mongoose.model<IExpense>("Expense", expenseSchema)

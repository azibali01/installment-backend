import mongoose, { Schema, type Document } from "mongoose"

export interface IProduct extends Document {
  name: string
  price: number
  description?: string
  quantity?: number
  createdAt: Date
  updatedAt: Date
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, unique: true },
    price: { type: Number, required: true },
    description: String,
    quantity: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export default mongoose.model<IProduct>("Product", productSchema)

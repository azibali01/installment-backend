import mongoose, { Schema, type Document } from "mongoose"

export interface ICustomer extends Document {
  name: string
  phone: string
  cnic: string
  address: string
  createdAt: Date
  updatedAt: Date
}

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    cnic: { type: String, required: true, unique: true },
    address: { type: String, required: true },
  },
  { timestamps: true },
)

export default mongoose.model<ICustomer>("Customer", customerSchema)

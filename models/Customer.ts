import mongoose, { Schema, type Document } from "mongoose"
import { normalizeCNIC, formatCNIC } from "../utils/cnic.js"

export interface ICustomer extends Document {
  name: string
  phone: string
  cnic: string
  address: string
  so?: string
  cast?: string
  createdAt: Date
  updatedAt: Date
}

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    cnic: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    so: { type: String },
    cast: { type: String },
  },
  { timestamps: true },
)


customerSchema.pre("save", function (next) {
  if (this.isModified("cnic") && this.cnic) {
    const normalized = normalizeCNIC(this.cnic as unknown as string)
    if (normalized) this.cnic = normalized as unknown as string
  }
  next()
})

if (!customerSchema.options.toJSON) customerSchema.options.toJSON = {}
customerSchema.options.toJSON.transform = function (doc: any, ret: any) {
  if (ret.cnic) {
    ret.cnic = formatCNIC(ret.cnic)
  }
  return ret
}

export default mongoose.model<ICustomer>("Customer", customerSchema)

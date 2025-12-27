import mongoose, { Schema, type Document } from "mongoose"
import { normalizeCNIC, formatCNIC } from "../utils/cnic.js"
import { getNextSequence } from "../utils/counters.js"
import { claimFreedId, releaseFreedId } from "../utils/freedIds.js"

export interface ICustomer extends Document {
  customerId?: number
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
    customerId: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    cnic: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    so: { type: String },
    cast: { type: String },
  },
  { timestamps: true },
)

// Add indexes for frequently queried fields
customerSchema.index({ phone: 1 })
customerSchema.index({ name: "text" }) // Text search index
customerSchema.index({ customerId: 1 })
customerSchema.index({ cnic: 1 })

customerSchema.pre("save", async function (next) {
  if (this.isModified("cnic") && this.cnic) {
    const normalized = normalizeCNIC(this.cnic as unknown as string)
    if (normalized) this.cnic = normalized as unknown as string
  }
  
  // Auto-generate customerId if not provided and this is a new document
  if (this.isNew && !this.customerId) {
    try {
      // Prefer reusing any freed (deleted) IDs to keep a compact sequence
      const reclaimed = await claimFreedId("customerId")
      if (reclaimed && Number.isFinite(reclaimed) && reclaimed > 0) {
        this.customerId = reclaimed
      } else {
        // Use counter collection for better performance
        this.customerId = await getNextSequence("customerId")
      }
    } catch (error) {
      // Fallback: Find the maximum customerId and increment by 1
      try {
        const maxCustomer = await mongoose.model<ICustomer>("Customer").findOne().sort({ customerId: -1 }).select("customerId").lean()
        this.customerId = maxCustomer && maxCustomer.customerId ? maxCustomer.customerId + 1 : 1
      } catch (fallbackError) {
        // If error, start from 1
        this.customerId = 1
      }
    }
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

// When a customer is deleted via findOneAndDelete / findByIdAndDelete, release their customerId for reuse
customerSchema.post("findOneAndDelete", async function (doc: any) {
  try {
    if (doc && doc.customerId) {
      await releaseFreedId("customerId", Number(doc.customerId))
    }
  } catch (e) {
    // ignore errors here
  }
})

// Also release id on document deleteOne (document middleware)
customerSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function (this: any) {
    try {
      if (this && this.customerId) {
        await releaseFreedId("customerId", Number(this.customerId))
      }
    } catch (e) {
      // ignore
    }
  },
)

import mongoose, { Schema, type Document } from "mongoose"

export interface IRolePermission extends Document {
    role: string
    permissions: string[]
    createdAt: Date
    updatedAt: Date
}

const rolePermissionSchema = new Schema<IRolePermission>(
    {
        role: { type: String, required: true, unique: true },
        permissions: { type: [String], default: [] },
    },
    { timestamps: true },
)

export default mongoose.model<IRolePermission>("RolePermission", rolePermissionSchema)

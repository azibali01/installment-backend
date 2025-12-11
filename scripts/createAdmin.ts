import dotenv from "dotenv"
import connectDB from "../utils/db.js"
import User from "../models/User.js"
import RolePermission from "../models/RolePermission.js"

dotenv.config()

const name = process.env.ADMIN_NAME || "admin"
const email = process.env.ADMIN_EMAIL || "admin@admin.com"
const password = process.env.ADMIN_PASSWORD || "admin@123"
const role = "admin"

async function run() {
  try {
    await connectDB()
    console.log("Connected to MongoDB for creating admin user")

    // Ensure admin role permissions exist (no overwrite by default)
    const defaultPermissions = [
      "view_dashboard",
      "view_customers",
      "manage_customers",
      "view_products",
      "manage_products",
      "view_installments",
      "manage_installments",
      "approve_installments",
      "view_payments",
      "manage_payments",
      "view_expenses",
      "manage_expenses",
      "view_reports",
      "manage_users",
      "manage_roles",
    ]

    await RolePermission.findOneAndUpdate(
      { role },
      { $setOnInsert: { permissions: defaultPermissions, role } },
      { upsert: true },
    )

    const existing = await User.findOne({ email })
    if (existing) {
      existing.name = name
      existing.password = password
      existing.role = role
      await existing.save()
      console.log(`Updated existing admin user: ${email}`)
    } else {
      const user = new User({ name, email, password, role })
      await user.save()
      console.log(`Created admin user: ${email}`)
    }

    console.log("Done")
    process.exit(0)
  } catch (err) {
    console.error("Create admin failed:", err)
    process.exit(1)
  }
}

run()

import express, { Request, Response, NextFunction } from "express"
import cors from "cors"
import dotenv from "dotenv"

import connectDB from "./utils/db.js"
import { getFrontendUrl, getJwtSecret, NODE_ENV } from "./utils/config.js"
import { createCorsOptions } from "./utils/cors.js"

import authRoutes from "./routes/auth.js"
import userRoutes from "./routes/users.js"
import productRoutes from "./routes/products.js"
import customerRoutes from "./routes/customers.js"
import installmentRoutes from "./routes/installments.js"
import paymentRoutes from "./routes/payments.js"
import expenseRoutes from "./routes/expenses.js"
import reportRoutes from "./routes/reports.js"
import roleRoutes from "./routes/roles.js"
import RolePermission from "./models/RolePermission.js"

dotenv.config()

// Ensure required secrets are present (exits in production if missing)
getJwtSecret()

const app = express()
const PORT = process.env.PORT || 5000

const FRONTEND_URL = getFrontendUrl()
const envList = process.env.FRONTEND_URLS || ""


const defaultLocal = ["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"]
const combinedEnv = [envList].filter(Boolean).concat(defaultLocal).join(',')

const corsOptions = createCorsOptions(combinedEnv || FRONTEND_URL)

console.log(`${new Date().toISOString()} - NODE_ENV=${NODE_ENV} - using FRONTEND_URL=${FRONTEND_URL} - FRONTEND_URLS=${envList} - combined=${combinedEnv}`)


app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - origin: ${req.headers.origin || "<none>"}`)
  next()
})


app.use((corsOptions && (corsOptions as any).origin) ? (cors as any)(corsOptions) : (req: Request, res: Response, next: NextFunction) => next())
app.options("*", (req: Request, res: Response, next: NextFunction) => {
  const opts = createCorsOptions(combinedEnv || FRONTEND_URL)
    ; (cors as any)(opts)(req, res, next)
})

app.use(express.json())

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), env: process.env.NODE_ENV || "development" })
})

// Connect DB
connectDB()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err)
    process.exit(1)
  })

  // Ensure default admin role permissions exist (development convenience)
  ; (async () => {
    try {
      const defaultPermissions = [
        "view_reports",
        "manage_customers",
        "manage_products",
        "manage_payments",
        "manage_installments",
        "approve_installments",
        "view_expenses",
        "manage_expenses",
      ]
      await RolePermission.findOneAndUpdate(
        { role: "admin" },
        { $set: { permissions: defaultPermissions } },
        { upsert: true, new: true }
      )
      console.log("Ensured default 'admin' role permissions exist")
    } catch (err) {
      console.error("Failed to ensure admin role permissions:", err)
    }
  })()

// API Routes
app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/products", productRoutes)
app.use("/api/customers", customerRoutes)
app.use("/api/installments", installmentRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/expenses", expenseRoutes)
app.use("/api/reports", reportRoutes)
app.use("/api/roles", roleRoutes)

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

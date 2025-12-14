import express, { Request, Response, NextFunction } from "express"
import cors from "cors"
import dotenv from "dotenv"
import helmet from "helmet"
import rateLimit from "express-rate-limit"

import connectDB from "./utils/db.js"
import { getFrontendUrl, getJwtSecret, NODE_ENV } from "./utils/config.js"
import { createCorsOptions, parseAllowedOrigins } from "./utils/cors.js"

import authRoutes from "./routes/auth.js"
import cookieParser from "cookie-parser"
import userRoutes from "./routes/users.js"
import productRoutes from "./routes/products.js"
import customerRoutes from "./routes/customers.js"
import installmentRoutes from "./routes/installments.js"
import installmentRequestRoutes from "./routes/installmentRequests.js"
import paymentRoutes from "./routes/payments.js"
import expenseRoutes from "./routes/expenses.js"
import reportRoutes from "./routes/reports.js"
import contactRoutes from "./routes/contacts.js"
import roleRoutes from "./routes/roles.js"
import cashRoutes from "./routes/cash.js"
import RolePermission from "./models/RolePermission.js"

import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables from env file
dotenv.config({ path: path.resolve(__dirname, "./env") })


getJwtSecret()

const app = express()
const PORT = process.env.PORT || 5000

const FRONTEND_URL = getFrontendUrl()
const envList = process.env.FRONTEND_URLS || ""

// Default localhost origins for development
const defaultLocal = ["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"]
// Determine if we're in production: check NODE_ENV OR if FRONTEND_URLS is set (indicates deployment)
const isProductionEnv = NODE_ENV === "production" || (envList.length > 0 && !envList.includes("localhost"))
// Combine environment URLs with localhost defaults
// In production, only use envList; in dev, add localhost origins
const combinedEnv = isProductionEnv
  ? envList 
  : [envList].filter(Boolean).concat(defaultLocal).join(',')

const corsOptions = createCorsOptions(combinedEnv || FRONTEND_URL)
const allowedOrigins = parseAllowedOrigins(combinedEnv || FRONTEND_URL)

// Always log CORS configuration for debugging
console.log(`${new Date().toISOString()} - CORS Config - NODE_ENV=${NODE_ENV} - isProductionEnv=${isProductionEnv} - FRONTEND_URL=${FRONTEND_URL} - FRONTEND_URLS=${envList} - combined=${combinedEnv}`)
console.log(`${new Date().toISOString()} - Allowed Origins: ${JSON.stringify(allowedOrigins)}`)

if (NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - origin: ${req.headers.origin || "<none>"}`)
    next()
  })
}



// Ensure CORS headers are added as early as possible so any middleware
// (including rate limiters) that short-circuits can still return responses
// with the appropriate CORS headers. This middleware echoes back the
// requesting origin when it's allowed and sets credentials headers.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin as string | undefined
  try {
    if (!origin) return next()

    // In development, if no explicit FRONTEND_URLS provided, echo any origin
    // BUT: If FRONTEND_URLS is set (even if NODE_ENV is not production), use strict CORS
    const isProductionEnv = NODE_ENV === "production" || (envList.length > 0 && !envList.includes("localhost"))
    if (!isProductionEnv && (!process.env.FRONTEND_URL && !process.env.FRONTEND_URLS)) {
      res.header("Access-Control-Allow-Origin", origin)
      res.header("Access-Control-Allow-Credentials", "true")
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      )
      res.header(
        "Access-Control-Allow-Methods",
        "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
      )
      return next()
    }

    const ok = allowedOrigins.some((a) => {
      if (typeof a === "string") return a === origin
      return (a as RegExp).test(origin)
    })
    if (ok) {
      res.header("Access-Control-Allow-Origin", origin)
      res.header("Access-Control-Allow-Credentials", "true")
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      )
      res.header(
        "Access-Control-Allow-Methods",
        "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
      )
    }
  } catch (err) {
    // don't block requests if CORS check fails
  }
  return next()
})

app.use(helmet())
function setCorsHeadersForReq(res: Response, origin?: string | undefined) {
  if (!origin) return
  res.header("Access-Control-Allow-Origin", origin)
  res.header("Access-Control-Allow-Credentials", "true")
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  )
  res.header(
    "Access-Control-Allow-Methods",
    "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
  )
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    try {
        const origin = req.headers.origin as string | undefined
        // Always attempt to echo the Origin header when present so short-circuit
        // responses (like 429) include the required CORS headers for the browser.
        // We still rely on the main CORS middleware for strict origin checks in
        // production, but returning the header here prevents the browser from
        // blocking the response when the request is rate-limited.
        if (origin) setCorsHeadersForReq(res, origin)
    } catch (err) {
      // ignore header set errors
    }
    res.status(429).json({ error: "Too many requests" })
  }
})

app.use((corsOptions && (corsOptions as any).origin) ? (cors as any)(corsOptions) : (req: Request, res: Response, next: NextFunction) => next())
app.options("*", (req: Request, res: Response, next: NextFunction) => {
  const opts = createCorsOptions(combinedEnv || FRONTEND_URL)
    ; (cors as any)(opts)(req, res, next)
})

// Apply rate limiting after CORS so error responses include CORS headers
app.use(globalLimiter)

app.use(express.json())
app.use(cookieParser())

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), env: process.env.NODE_ENV || "development" })
})


connectDB()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err)
    process.exit(1)
  })


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
        { $setOnInsert: { permissions: defaultPermissions, role: "admin" } },
        { upsert: true, new: true }
      )
      console.log("Ensured default 'admin' role permissions exist (no overwrite)")
    } catch (err) {
      console.error("Failed to ensure admin role permissions:", err)
    }
  })()



const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Increased from 10 to 50 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    try {
        const origin = req.headers.origin as string | undefined
        if (origin) setCorsHeadersForReq(res, origin)
    } catch (err) {}
    res.status(429).json({ error: "Too many requests. Please try again after 15 minutes." })
  }
})
app.use("/api/auth", authLimiter, authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/products", productRoutes)
app.use("/api/customers", customerRoutes)
app.use("/api/installments", installmentRoutes)
app.use("/api/installment-requests", installmentRequestRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/expenses", expenseRoutes)
app.use("/api/reports", reportRoutes)
app.use("/api/roles", roleRoutes)
app.use("/api/contacts", contactRoutes)
app.use("/api/cash", cashRoutes)


import errorHandler from "./middleware/errorHandler.js"
app.use(errorHandler)


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

import express from "express"
import connectDB from "./utils/db.js"
import cors from "cors"
import dotenv from "dotenv"
import authRoutes from "./routes/auth.js"
import userRoutes from "./routes/users.js"
import productRoutes from "./routes/products.js"
import customerRoutes from "./routes/customers.js"
import installmentRoutes from "./routes/installments.js"
import paymentRoutes from "./routes/payments.js"
import expenseRoutes from "./routes/expenses.js"
import reportRoutes from "./routes/reports.js"
import roleRoutes from "./routes/roles.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000


const FRONTEND_URL = process.env.FRONTEND_URL || "https://installment-expense-management-cveb2ntqq.vercel.app"
const allowedOrigins = [FRONTEND_URL, "http://localhost:3000", "http://localhost:5173", "http://localhost:5174"]

app.use((req, res, next) => {

  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - origin: ${req.headers.origin || "<none>"}`)
  next()
})

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      console.log("Blocked CORS origin:", origin)
      return callback(new Error("Not allowed by CORS"))
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
)


app.options("*", (req, res) => {
  console.log("Preflight (OPTIONS)", req.originalUrl, "from", req.headers.origin)
  res.sendStatus(204)
})

app.use(express.json())


app.get("/health", async (req, res) => {
  const dbState = (await import("./utils/db.js")).default

  res.json({ status: "ok", uptime: process.uptime(), env: process.env.NODE_ENV || "development" })
})


connectDB()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err)
    process.exit(1)
  })


app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/products", productRoutes)
app.use("/api/customers", customerRoutes)
app.use("/api/installments", installmentRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/expenses", expenseRoutes)
app.use("/api/reports", reportRoutes)
app.use("/api/roles", roleRoutes)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

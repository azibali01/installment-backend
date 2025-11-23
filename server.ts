import express from "express";
import connectDB from "./utils/db.js";
import cors from "cors";
import dotenv from "dotenv";
import { getFrontendUrl, getJwtSecret, NODE_ENV } from "./utils/config.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import productRoutes from "./routes/products.js";
import customerRoutes from "./routes/customers.js";
import installmentRoutes from "./routes/installments.js";
import paymentRoutes from "./routes/payments.js";
import expenseRoutes from "./routes/expenses.js";
import reportRoutes from "./routes/reports.js";
import roleRoutes from "./routes/roles.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;


getJwtSecret()


const FRONTEND_URL = getFrontendUrl()

const allowedOrigins = [

  ...(FRONTEND_URL ? [FRONTEND_URL] : []),
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
]

console.log(`${new Date().toISOString()} - NODE_ENV=${NODE_ENV} - allowedOrigins: ${allowedOrigins.join(", ")}`)

// Log incoming requests
app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} - ${req.method} ${req.originalUrl} - origin: ${req.headers.origin || "<none>"
    }`
  );
  next();
});

// Enable CORS
app.use(
  cors({
    origin: (origin, callback) => {
      try {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);

        console.log("Blocked CORS origin:", origin);
        return callback(null, false);
      } catch (err) {
        console.error("CORS origin check failed:", err);
        return callback(null, false);
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);


app.options("*", (req, res) => {
  const origin = req.headers.origin as string | undefined;
  if (!origin || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.headers.origin && allowedOrigins.includes(req.headers.origin)) {
      res.header("Access-Control-Allow-Credentials", "true");
    }
    return res.sendStatus(204);
  }

  console.log("Blocked preflight from origin:", origin);
  return res.status(403).send("CORS Forbidden");
});

app.use(express.json());


app.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    env: process.env.NODE_ENV || "development",
  });
});

// Connect DB
connectDB()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/installments", installmentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/roles", roleRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

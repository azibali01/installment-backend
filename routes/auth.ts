import express, { type Request, type Response } from "express"
import jwt from "jsonwebtoken"
import User from "../models/User.js"
import RefreshToken from "../models/RefreshToken.js"
import RolePermission from "../models/RolePermission.js"
import { getJwtSecret } from "../utils/config.js"
import { body, validationResult } from "express-validator"
import crypto from "crypto"
import { authenticate } from "../middleware/auth.js"

const router = express.Router()

router.post(
  "/register",
  [
    body("name").notEmpty().withMessage("name is required"),
    body("email").isEmail().withMessage("valid email is required"),
    body("password").isLength({ min: 6 }).withMessage("password must be at least 6 characters"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
      }

      const { name, email, password } = req.body


      const role = "employee"

      const existingUser = await User.findOne({ email })
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" })
      }

      const user = new User({ name, email, password, role })
      await user.save()

      res.status(201).json({ message: "User registered successfully" })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Registration failed" })
    }
  },
)

router.post(
  "/login",
  [body("email").isEmail(), body("password").notEmpty()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
      }

      const { email, password } = req.body

      const user = await User.findOne({ email })
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" })
      }

      const isPasswordValid = await user.comparePassword(password)
      if (!isPasswordValid) {
        return res.status(401).json({ error: "Invalid credentials" })
      }


      const accessToken = jwt.sign({ id: user._id, role: user.role }, getJwtSecret(), {
        expiresIn: "15m",
      })

      const refreshTokenValue = crypto.randomBytes(40).toString("hex")
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await RefreshToken.create({ token: refreshTokenValue, user: user._id, expiresAt: refreshExpires })


      res.cookie("refreshToken", refreshTokenValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/api",
        expires: refreshExpires,
      })

      const rp = await RolePermission.findOne({ role: user.role })
      const permissions = rp?.permissions || []

      res.json({ token: accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions } })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Login failed" })
    }
  },
)


router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const cookie = req.cookies?.refreshToken
    if (!cookie) return res.status(401).json({ error: "No refresh token" })

    const stored = await RefreshToken.findOne({ token: cookie })
    if (!stored) return res.status(401).json({ error: "Invalid refresh token" })
    if (stored.expiresAt < new Date()) {
      await RefreshToken.deleteOne({ token: cookie })
      return res.status(401).json({ error: "Refresh token expired" })
    }

    const user = await User.findById(stored.user)
    if (!user) return res.status(401).json({ error: "Invalid refresh token user" })


    await RefreshToken.deleteOne({ token: cookie })
    const newRefreshValue = crypto.randomBytes(40).toString("hex")
    const newRefreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await RefreshToken.create({ token: newRefreshValue, user: user._id, expiresAt: newRefreshExpires })


    const accessToken = jwt.sign({ id: user._id, role: user.role }, getJwtSecret(), { expiresIn: "15m" })


    res.cookie("refreshToken", newRefreshValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/api",
      expires: newRefreshExpires,
    })

    res.json({ token: accessToken })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Refresh failed" })
  }
})

// Logout - revoke refresh token
router.post("/logout", async (req: Request, res: Response) => {
  try {
    const cookie = req.cookies?.refreshToken
    if (cookie) {
      await RefreshToken.deleteOne({ token: cookie })
    }
    res.clearCookie("refreshToken", { path: "/api", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", secure: process.env.NODE_ENV === "production" })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Logout failed" })
  }
})

router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const UserModel = await import("../models/User.js")
    const RolePermission = await import("../models/RolePermission.js")
    const user = await UserModel.default.findById(req.user?.id).select("_id name email role")
    if (!user) return res.status(404).json({ error: "User not found" })

    const rp = await RolePermission.default.findOne({ role: user.role })
    const permissions = rp?.permissions || []

    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions } })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch user" })
  }
})

export default router

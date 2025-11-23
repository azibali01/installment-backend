import express, { type Request, type Response } from "express"
import jwt from "jsonwebtoken"
import User from "../models/User.js"

const router = express.Router()

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body

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
})

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body


    console.log(`Login attempt for email: ${email}`)

    const user = await User.findOne({ email })
    console.log(`User lookup for ${email}: ${user ? "found" : "not found"}`)
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" })
    }

    const isPasswordValid = await user.comparePassword(password)
    console.log(`Password valid for ${email}: ${isPasswordValid}`)
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" })
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || "secret", {
      expiresIn: "7d",
    })

    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Login failed" })
  }
})

export default router

import express, { type Request, type Response } from "express"
import { authenticate, authorize } from "../middleware/auth.js"
import User from "../models/User.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const users = await User.find().select("-password")
    res.json(users)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch users" })
  }
})

router.post(
  "/",
  authenticate,
  authorize(["admin"]),
  [
    body("name").notEmpty().withMessage("name is required"),
    body("email").isEmail().withMessage("valid email is required"),
    body("password").isLength({ min: 6 }).withMessage("password must be at least 6 characters"),
    body("role").isIn(["admin", "manager", "employee"]).withMessage("invalid role"),
    // Phone: allow optional international prefix and 9-12 digits
    body("phone").optional().matches(/^(\+?\d{1,3}[- ]?)?\d{9,12}$/).withMessage("phone must be a valid phone number"),
    body("salary").optional().isFloat({ min: 0 }),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { name, email, password, role, phone, salary } = req.body

      const existingUser = await User.findOne({ email })
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" })
      }

      const user = new User({ name, email, password, role, phone, salary })
      await user.save()

      res.status(201).json({ message: "User created", user: user.toObject() })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create user" })
    }
  },
)

router.put(
  "/:id",
  authenticate,
  authorize(["admin"]),
  [
    param("id").isMongoId().withMessage("Invalid user id"),
    body("name").optional().notEmpty(),
    body("email").optional().isEmail(),
    body("role").optional().isIn(["admin", "manager", "employee"]),
    body("phone").optional().matches(/^(\+?\d{1,3}[- ]?)?\d{9,12}$/).withMessage("phone must be a valid phone number"),
    body("salary").optional().isFloat({ min: 0 }),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { name, email, role, phone, salary, isActive } = req.body
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { name, email, role, phone, salary, isActive },
        { new: true },
      )
      res.json(user)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update user" })
    }
  },
)

router.delete(
  "/:id",
  authenticate,
  authorize(["admin"]),
  [param("id").isMongoId().withMessage("Invalid user id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      await User.findByIdAndDelete(req.params.id)
      res.json({ message: "User deleted" })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete user" })
    }
  },
)

export default router

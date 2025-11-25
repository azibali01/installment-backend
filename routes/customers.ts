import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Customer from "../models/Customer.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const customers = await Customer.find()
    res.json(customers)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch customers" })
  }
})

router.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Invalid customer id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const customer = await Customer.findById(req.params.id)
      if (!customer) return res.status(404).json({ error: "Customer not found" })
      res.json(customer)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch customer" })
    }
  },
)

router.post(
  "/",
  authenticate,
  authorizePermission("manage_customers"),
  [
    body("name").notEmpty().withMessage("name is required"),

    body("phone")
      .optional()
      .matches(/^(\+?\d{1,3}[- ]?)?\d{9,12}$/)
      .withMessage("phone must be a valid phone number"),

    body("cnic")
      .notEmpty()
      .withMessage("cnic is required")
      .matches(/^(\d{13}|\d{5}-\d{7}-\d{1})$/)
      .withMessage("cnic must be 13 digits or formatted as 12345-1234567-1"),
    body("address").notEmpty().withMessage("address is required"),
    body("so").optional().isString().isLength({ max: 100 }).withMessage("so must be a string up to 100 chars"),
    body("cast").optional().isString().isLength({ max: 100 }).withMessage("cast must be a string up to 100 chars"),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { name, phone, cnic, address, so, cast } = req.body
      const customer = new Customer({ name, phone, cnic, address, so, cast })
      await customer.save()
      res.status(201).json(customer)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create customer" })
    }
  },
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_customers"),
  [
    param("id").isMongoId().withMessage("Invalid customer id"),
    body("name").optional().notEmpty(),
    body("phone").optional().matches(/^(\+?\d{1,3}[- ]?)?\d{9,12}$/).withMessage("phone must be a valid phone number"),
    body("cnic").optional().matches(/^(\d{13}|\d{5}-\d{7}-\d{1})$/).withMessage("cnic must be 13 digits or formatted as 12345-1234567-1"),
    body("address").optional().notEmpty(),
    body("so").optional().isString().isLength({ max: 100 }).withMessage("so must be a string up to 100 chars"),
    body("cast").optional().isString().isLength({ max: 100 }).withMessage("cast must be a string up to 100 chars"),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {

      const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true })
      res.json(customer)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update customer" })
    }
  },
)

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_customers"),
  [param("id").isMongoId().withMessage("Invalid customer id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const deleted = await Customer.findByIdAndDelete(req.params.id)
      if (!deleted) return res.status(404).json({ error: "Customer not found" })
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete customer" })
    }
  },
)

export default router

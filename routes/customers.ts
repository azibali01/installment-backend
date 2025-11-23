import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Customer from "../models/Customer.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const customers = await Customer.find()
    res.json(customers)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch customers" })
  }
})

router.post("/", authenticate, authorizePermission("manage_customers"), async (req: Request, res: Response) => {
  try {
    const { name, phone, cnic, address } = req.body
    const customer = new Customer({ name, phone, cnic, address })
    await customer.save()
    res.status(201).json(customer)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create customer" })
  }
})

router.put("/:id", authenticate, authorizePermission("manage_customers"), async (req: Request, res: Response) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true })
    res.json(customer)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update customer" })
  }
})

export default router

import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Product from "../models/Product.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const products = await Product.find()
    res.json(products)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch products" })
  }
})

router.post("/", authenticate, authorizePermission("manage_products"), async (req: Request, res: Response) => {
  try {
    const { name, price, description, quantity } = req.body
    const product = new Product({ name, price, description, quantity })
    await product.save()
    res.status(201).json(product)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create product" })
  }
})

router.put("/:id", authenticate, authorizePermission("manage_products"), async (req: Request, res: Response) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
    res.json(product)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update product" })
  }
})

export default router

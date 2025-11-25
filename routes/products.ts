import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Product from "../models/Product.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"

const router = express.Router()

router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const products = await Product.find()
    res.json(products)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch products" })
  }
})

router.post(
  "/",
  authenticate,
  authorizePermission("manage_products"),
  [
    body("name").notEmpty().withMessage("name is required"),
    body("price").isFloat({ gt: 0 }).withMessage("price must be a positive number"),
    body("description").optional().isString(),
    body("quantity").optional().isInt({ min: 0 }).withMessage("quantity must be >= 0"),
    validateRequest,
  ],
  async (req: Request, res: Response) => {
    try {
      const { name, price, description, quantity } = req.body
      const product = new Product({ name, price, description, quantity })
      await product.save()
      res.status(201).json(product)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create product" })
    }
  },
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_products"),
  [param("id").isMongoId().withMessage("Invalid product id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
      res.json(product)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update product" })
    }
  },
)

router.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Invalid product id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const product = await Product.findById(req.params.id)
      if (!product) return res.status(404).json({ error: "Product not found" })
      res.json(product)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch product" })
    }
  },
)

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_products"),
  [param("id").isMongoId().withMessage("Invalid product id"), validateRequest],
  async (req: Request, res: Response) => {
    try {
      const product = await Product.findByIdAndDelete(req.params.id)
      if (!product) return res.status(404).json({ error: "Product not found" })
      res.json({ message: "Product deleted" })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete product" })
    }
  },
)

export default router

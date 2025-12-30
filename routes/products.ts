import express, { type Request, type Response } from "express"
import { authenticate, authorizePermission } from "../middleware/auth.js"
import Product from "../models/Product.js"
import { body, param } from "express-validator"
import { validateRequest } from "../middleware/validate.js"
import { asyncHandler } from "../middleware/asyncHandler.js"
import { NotFoundError } from "../utils/errors.js"

const router = express.Router()

router.get("/", authenticate, asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page || 1))
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)))
  const skip = (page - 1) * limit
  const total = await Product.countDocuments()
  
  const products = await Product.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean()
  
  res.json({ 
    data: Array.isArray(products) ? products : [], 
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  })
}))

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
  asyncHandler(async (req: Request, res: Response) => {
    const { name, price, description, quantity } = req.body
    // Check for duplicate product name
    const existingProduct = await Product.findOne({ name })
    if (existingProduct) {
      return res.status(409).json({ error: "Product with this name already exists." })
    }
    const product = new Product({ name, price, description, quantity })
    await product.save()
    res.status(201).json(product)
  }),
)

router.put(
  "/:id",
  authenticate,
  authorizePermission("manage_products"),
  [param("id").isMongoId().withMessage("Invalid product id"), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!product) throw new NotFoundError("Product")
    res.json(product)
  }),
)

router.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Invalid product id"), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const product = await Product.findById(req.params.id)
    if (!product) throw new NotFoundError("Product")
    res.json(product)
  }),
)

router.delete(
  "/:id",
  authenticate,
  authorizePermission("manage_products"),
  [param("id").isMongoId().withMessage("Invalid product id"), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const product = await Product.findByIdAndDelete(req.params.id)
    if (!product) throw new NotFoundError("Product")
    res.json({ message: "Product deleted" })
  }),
)

export default router

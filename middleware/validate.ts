import type { Request, Response, NextFunction } from "express"
import { validationResult } from "express-validator"

export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        const arr = errors.array()
        // In development, include a short message and log the full errors for debugging
        if (process.env.NODE_ENV !== 'production') {
            console.warn('Validation failed:', arr)
            return res.status(400).json({ message: arr[0]?.msg || 'Validation error', errors: arr })
        }
        return res.status(400).json({ message: arr[0]?.msg || 'Validation error', errors: arr })
    }
    next()
}

export default validateRequest

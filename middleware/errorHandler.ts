import type { Request, Response, NextFunction } from "express"
import { NODE_ENV } from "../utils/config.js"
import { AppError, createErrorResponse } from "../utils/errors.js"

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
    // Determine status code
    const status = err instanceof AppError ? err.statusCode : err?.status || 500

    // Create standardized error response
    const isDevelopment = NODE_ENV !== "production"
    const errorResponse = createErrorResponse(err, isDevelopment)

    // Log error
    if (isDevelopment) {
        console.error("Error:", err)
        if (err?.stack) {
            console.error("Stack:", err.stack)
        }
    } else {
        const timestamp = new Date().toISOString()
        const errorMessage = err instanceof Error ? err.message : "Internal Server Error"
        console.error(`${timestamp} - ERROR [${status}]: ${errorMessage}`)
        
        // Log additional context for non-operational errors
        if (err instanceof AppError && !err.isOperational) {
            console.error("Non-operational error details:", {
                name: err.name,
                message: err.message,
                stack: err.stack,
            })
        }
    }

    res.status(status).json(errorResponse)
}

export default errorHandler

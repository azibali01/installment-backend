/**
 * Custom error classes for standardized error handling
 */

export class AppError extends Error {
  statusCode: number
  isOperational: boolean

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation failed") {
    super(message, 400)
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad request") {
    super(message, 400)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403)
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource conflict") {
    super(message, 409)
  }
}

/**
 * Standardized error response format
 */
export interface ErrorResponse {
  error: string
  code?: string
  details?: any
  stack?: string
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: Error | AppError | unknown,
  includeStack: boolean = false
): ErrorResponse {
  if (error instanceof AppError) {
    return {
      error: error.message,
      code: error.name,
      ...(includeStack && { stack: error.stack }),
    }
  }

  if (error instanceof Error) {
    return {
      error: error.message || "Internal Server Error",
      code: "Error",
      ...(includeStack && { stack: error.stack }),
    }
  }

  return {
    error: "Internal Server Error",
    code: "UnknownError",
  }
}


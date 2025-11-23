import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string }
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1]

  if (!token) {
    return res.status(401).json({ error: "No token provided" })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret") as { id: string; role: string }
    req.user = decoded
    next()
  } catch (error) {
    res.status(401).json({ error: "Invalid token" })
  }
}

export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" })
    }
    next()
  }
}

export const authorizePermission = (permission: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" })
      const RolePermission = await import("../models/RolePermission.js")
      const rp = await RolePermission.default.findOne({ role: req.user.role })
      if (!rp || !Array.isArray(rp.permissions) || !rp.permissions.includes(permission)) {
        return res.status(403).json({ error: "Access denied (missing permission)" })
      }
      next()
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Permission check failed" })
    }
  }
}

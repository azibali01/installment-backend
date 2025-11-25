import type { Request, Response, NextFunction } from "express"
import { NODE_ENV } from "../utils/config.js"

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
    const status = err?.status || 500

    const body: any = { error: err?.message || "Internal Server Error" }

    if (NODE_ENV !== "production") {
        body.stack = err?.stack
        console.error(err)
    } else {

        console.error(`${new Date().toISOString()} - ERROR: ${err?.message || "Internal Server Error"}`)
    }

    res.status(status).json(body)
}

export default errorHandler

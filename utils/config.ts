import dotenv from "dotenv"

dotenv.config()

export const NODE_ENV = process.env.NODE_ENV || "development"

export const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET
    if (!secret) {
        if (NODE_ENV === "production") {
            console.error(
                "FATAL: JWT_SECRET is not set. Set the JWT_SECRET environment variable for production and restart."
            )
            process.exit(1)
        }

        console.warn(
            "Warning: JWT_SECRET is not set. Using an insecure default secret for development only."
        )
        return "dev-secret"
    }
    return secret
}

export const getFrontendUrl = () => {
    const url = process.env.FRONTEND_URL
    if (!url) {
        if (NODE_ENV === "production") {
            console.error(
                "FATAL: FRONTEND_URL is not set. Set FRONTEND_URL env on the backend host (Render) to your frontend origin."
            )
            process.exit(1)
        }


        return undefined
    }
    return url
}

export default {
    NODE_ENV,
    getJwtSecret,
    getFrontendUrl,
}

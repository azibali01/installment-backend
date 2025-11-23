import mongoose from "mongoose"
import dotenv from "dotenv"

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI

export function requireMongoURI() {
    if (!MONGODB_URI) {
        console.error("MONGODB_URI environment variable is not set. Set it before running this script.")
        process.exit(1)
    }


    let uri = MONGODB_URI.trim()


    if (uri.startsWith("MONGODB_URI=")) {
        const stripped = uri.split("=").slice(1).join("=").trim()
        console.warn("MONGODB_URI env var contained the key name; stripping the prefix and using the value portion.")
        uri = stripped
    }

    const hasValidScheme = uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://")
    if (!hasValidScheme) {
        const preview = uri.slice(0, 30)
        console.error(
            "MONGODB_URI has an invalid scheme. Expected a connection string starting with 'mongodb://' or 'mongodb+srv://'.\n" +
            `Current value (first 30 chars): '${preview}'` +
            "\nPlease set the MONGODB_URI env var in your hosting provider (do not commit it to source control)."
        )
        process.exit(1)
    }

    return uri
}

export async function connectDB() {
    const uri = requireMongoURI()

    try {
        const masked = uri.replace(/(mongodb(\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1$3:***@");
        console.log("Using MONGODB_URI (masked):", masked);
    } catch (e) {

    }

    try {
        await mongoose.connect(uri)
    } catch (err) {
        console.error("MongoDB connection error:", err)
        throw err
    }
}

export default connectDB

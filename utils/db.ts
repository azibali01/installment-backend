import mongoose from "mongoose"
import dotenv from "dotenv"

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI

export function requireMongoURI() {
    if (!MONGODB_URI) {
        console.error("MONGODB_URI environment variable is not set. Set it before running this script.")
        process.exit(1)
    }
    return MONGODB_URI
}

export async function connectDB() {
    const uri = requireMongoURI()
    await mongoose.connect(uri)
}

export default connectDB

import dotenv from "dotenv"
import mongoose from "mongoose"
import User from "./models/User.js"

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/installment_system"

async function run() {
    try {
        await mongoose.connect(MONGODB_URI)
        console.log("Connected to MongoDB for password check")

        const user = await User.findOne({ email: "admin@shop.com" })
        if (!user) {
            console.error("User admin@shop.com not found")
            process.exit(1)
        }

        const isValid = await user.comparePassword("admin123")
        console.log("Password valid:", isValid)
        process.exit(isValid ? 0 : 2)
    } catch (err) {
        console.error("Error checking password:", err)
        process.exit(1)
    }
}

run()

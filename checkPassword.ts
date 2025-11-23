import dotenv from "dotenv"
import connectDB from "./utils/db.js"
import User from "./models/User.js"

dotenv.config()



async function run() {
    try {
        await connectDB()
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

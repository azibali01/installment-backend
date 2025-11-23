import dotenv from "dotenv"
import mongoose from "mongoose"
import User from "./models/User.js"

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/installment_system"

const admin = { name: "Admin", email: "admin@shop.com", password: "admin123", role: "admin" }

async function seed() {
    try {
        await mongoose.connect(MONGODB_URI)
        console.log("Connected to MongoDB for seeding")

        const existing = await User.findOne({ email: admin.email })
        if (existing) {
            console.log(`Admin user ${admin.email} already exists, skipping`)
        } else {
            const user = new User(admin)
            await user.save()
            console.log(`Created admin user ${admin.email}`)
        }

        console.log("Seeding complete")
        process.exit(0)
    } catch (err) {
        console.error("Seeding error:", err)
        process.exit(1)
    }
}

seed()

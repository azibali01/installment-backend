import dotenv from "dotenv"
import connectDB from "./utils/db.js"
import User from "./models/User.js"

dotenv.config()



const admin = { name: "Admin", email: "admin@shop.com", password: "admin123", role: "admin" }

async function seed() {
    try {
        await connectDB()
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

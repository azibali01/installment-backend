import dotenv from "dotenv"
import connectDB from "./utils/db.js"
import Customer from "./models/Customer.js"

dotenv.config()

async function migrateCustomerIds() {
  try {
    await connectDB()
    console.log("Connected to MongoDB")

    // Get all customers without customerId, sorted by creation date
    const customersWithoutId = await Customer.find({ customerId: { $exists: false } }).sort({ createdAt: 1 })
    
    if (customersWithoutId.length === 0) {
      console.log("No customers need migration")
      process.exit(0)
    }

    // Get the maximum existing customerId
    const maxCustomer = await Customer.findOne().sort({ customerId: -1 }).select("customerId").lean()
    let nextId = maxCustomer && maxCustomer.customerId ? maxCustomer.customerId + 1 : 1

    console.log(`Found ${customersWithoutId.length} customers without customerId`)
    console.log(`Starting from customerId: ${nextId}`)

    // Assign sequential IDs
    for (const customer of customersWithoutId) {
      customer.customerId = nextId
      await customer.save()
      console.log(`Assigned customerId ${nextId} to customer: ${customer.name} (${customer._id})`)
      nextId++
    }

    console.log(`Migration completed! Assigned IDs to ${customersWithoutId.length} customers`)
    process.exit(0)
  } catch (err) {
    console.error("Migration failed:", err)
    process.exit(1)
  }
}

migrateCustomerIds()


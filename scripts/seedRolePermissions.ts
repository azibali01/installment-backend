import mongoose from "mongoose";
import dotenv from "dotenv";
import RolePermission from "../models/RolePermission.js";
import connectDB from "../utils/db.js";

dotenv.config();

async function run() {
    await connectDB();
    console.log("Connected to Mongo for seeding role permissions");

    const defaults = [
        {
            role: "admin",
            permissions: [
                "view_dashboard",
                "view_customers",
                "manage_customers",
                "view_products",
                "manage_products",
                "view_installments",
                "manage_installments",
                "approve_installments",
                "view_payments",
                "manage_payments",
                "view_expenses",
                "manage_expenses",
                "view_reports",
                "manage_users",
                "manage_roles",
            ],
        },
        {
            role: "manager",
            permissions: [
                "view_dashboard",
                "view_customers",
                "manage_customers",
                "view_products",
                "manage_products",
                "view_installments",
                "manage_installments",
                "view_payments",
                "manage_payments",
                "view_expenses",
                "manage_expenses",
                "view_reports",
            ],
        },
        {
            role: "employee",
            permissions: [
                "view_dashboard",
                "view_customers",
                "view_products",
                "view_installments",
                "view_payments",
                "view_expenses",
            ],
        },
    ];

    for (const def of defaults) {
        await RolePermission.findOneAndUpdate({ role: def.role }, { $set: { permissions: def.permissions } }, { upsert: true });
        console.log(`Seeded permissions for role: ${def.role}`);
    }

    console.log("Seeding complete");
    process.exit(0);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});

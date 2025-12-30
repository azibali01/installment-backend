/**
 * Migration script to fix remainingBalance for all existing installment plans
 * This recalculates remainingBalance from schedule for all plans in the database
 * 
 * Usage: npx tsx scripts/fixRemainingBalances.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import InstallmentPlan from "../models/InstallmentPlan.js";
import { calculateRemainingBalance } from "../utils/finance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (try both .env and env)
const envPath = path.resolve(__dirname, "../.env");
const envPathAlt = path.resolve(__dirname, "../env");
dotenv.config({ path: envPath });
if (!process.env.MONGODB_URI) {
  dotenv.config({ path: envPathAlt });
}

async function fixRemainingBalances() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/installment-management";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    // Find all installment plans
    const plans = await InstallmentPlan.find({});
    console.log(`Found ${plans.length} installment plans to check`);

    let fixed = 0;
    let unchanged = 0;

    for (const plan of plans) {
      if (!plan.installmentSchedule || !Array.isArray(plan.installmentSchedule)) {
        console.log(`Plan ${plan._id} has no schedule, skipping`);
        unchanged++;
        continue;
      }

      // Calculate correct remainingBalance from schedule
      const correctBalance = calculateRemainingBalance(plan.installmentSchedule);
      const currentBalance = Number(plan.remainingBalance || 0);

      // Only update if different (avoid unnecessary writes)
      if (Math.abs(correctBalance - currentBalance) > 0.01) {
        plan.remainingBalance = correctBalance;
        await plan.save();
        console.log(
          `Fixed plan ${plan._id} (${plan.installmentId || "N/A"}): ` +
          `${currentBalance} → ${correctBalance}`
        );
        fixed++;
      } else {
        unchanged++;
      }
    }

    console.log("\n=== Summary ===");
    console.log(`Total plans: ${plans.length}`);
    console.log(`Fixed: ${fixed}`);
    console.log(`Unchanged: ${unchanged}`);

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
    process.exit(0);
  } catch (error) {
    console.error("Error fixing remaining balances:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
fixRemainingBalances();


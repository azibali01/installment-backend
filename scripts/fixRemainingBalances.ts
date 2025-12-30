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
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB\n");

    // Find all installment plans
    const plans = await InstallmentPlan.find({});
    console.log(`📊 Found ${plans.length} installment plans to check\n`);

    let fixed = 0;
    let unchanged = 0;
    let errors = 0;
    const fixedPlans: Array<{ id: string; old: number; new: number }> = [];

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      try {
        if (!plan.installmentSchedule || !Array.isArray(plan.installmentSchedule)) {
          console.log(`⚠️  Plan ${plan._id} (${plan.installmentId || "N/A"}) has no schedule, skipping`);
          unchanged++;
          continue;
        }

        // Calculate correct remainingBalance from schedule
        // This calculates ONLY unpaid installments (down payment already excluded from schedule)
        const correctBalance = calculateRemainingBalance(plan.installmentSchedule);
        const currentBalance = Number(plan.remainingBalance || 0);
        const downPayment = Number(plan.downPayment || 0);
        const totalAmount = Number(plan.totalAmount || 0);

        // Only update if different (avoid unnecessary writes)
        if (Math.abs(correctBalance - currentBalance) > 0.01) {
          plan.remainingBalance = correctBalance;
          await plan.save();
          
          fixedPlans.push({
            id: plan.installmentId || String(plan._id).slice(-8),
            old: currentBalance,
            new: correctBalance,
          });
          
          console.log(
            `✅ Fixed plan ${i + 1}/${plans.length}: ${plan.installmentId || "N/A"} ` +
            `(${currentBalance.toFixed(2)} → ${correctBalance.toFixed(2)}) ` +
            `[Total: ${totalAmount.toFixed(2)}, Down: ${downPayment.toFixed(2)}]`
          );
          fixed++;
        } else {
          unchanged++;
          if ((i + 1) % 10 === 0) {
            process.stdout.write(`\rChecked ${i + 1}/${plans.length} plans...`);
          }
        }
      } catch (err: any) {
        console.error(`\n❌ Error processing plan ${plan._id}:`, err?.message);
        errors++;
      }
    }

    console.log("\n\n" + "=".repeat(60));
    console.log("📈 SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total plans: ${plans.length}`);
    console.log(`✅ Fixed: ${fixed}`);
    console.log(`✓ Unchanged: ${unchanged}`);
    if (errors > 0) {
      console.log(`❌ Errors: ${errors}`);
    }
    
    if (fixedPlans.length > 0) {
      console.log("\n📋 Fixed Plans Details:");
      fixedPlans.forEach((p, idx) => {
        console.log(`  ${idx + 1}. ID ${p.id}: ${p.old.toFixed(2)} → ${p.new.toFixed(2)}`);
      });
    }

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
    console.log("\n✨ Script completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error fixing remaining balances:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
fixRemainingBalances();


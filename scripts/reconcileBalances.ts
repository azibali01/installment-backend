import connectDB from "../utils/db.js";
import User from "../models/User.js";
import Payment from "../models/Payment.js";
import CashTransfer from "../models/CashTransfer.js";
import Expense from "../models/Expense.js";

async function main() {
  await connectDB();

  const apply = process.argv.includes("--apply");
  console.log(`Reconciliation script started (apply=${apply})`);

  const users = await User.find().lean();

  for (const u of users) {
    const uid = u._id;

    const paymentsAgg = await Payment.aggregate([
      { $match: { receivedBy: uid, status: { $ne: "reversed" } } },
      { $group: { _id: null, totalPayments: { $sum: "$amount" } } },
    ]);
    const totalPayments = paymentsAgg[0]?.totalPayments || 0;

    const inAgg = await CashTransfer.aggregate([
      { $match: { toUser: uid, status: { $ne: "rejected" } } },
      { $group: { _id: null, totalIn: { $sum: "$amount" } } },
    ]);
    const totalTransfersIn = inAgg[0]?.totalIn || 0;

    const outAgg = await CashTransfer.aggregate([
      { $match: { fromUser: uid, status: { $ne: "rejected" } } },
      { $group: { _id: null, totalOut: { $sum: "$amount" } } },
    ]);
    const totalTransfersOut = outAgg[0]?.totalOut || 0;

    const expAgg = await Expense.aggregate([
      { $match: { userId: uid } },
      { $group: { _id: null, totalExpenses: { $sum: "$amount" } } },
    ]);
    const totalExpenses = expAgg[0]?.totalExpenses || 0;

    const expected = (totalPayments + totalTransfersIn) - (totalTransfersOut + totalExpenses);
    const stored = Number(u.cashBalance || 0);
    const diff = stored - expected;

    console.log(`User: ${u.name} (${u.role}) id=${uid}`);
    console.log(`  stored: ${stored.toLocaleString()}`);
    console.log(`  payments: ${totalPayments.toLocaleString()}, transfersIn: ${totalTransfersIn.toLocaleString()}, transfersOut: ${totalTransfersOut.toLocaleString()}, expenses: ${totalExpenses.toLocaleString()}`);
    console.log(`  expected: ${expected.toLocaleString()}, diff: ${diff.toLocaleString()}`);

    if (diff !== 0 && apply) {
      console.log(`  -> Applying fix: setting cashBalance = expected (${expected})`);
      await User.findByIdAndUpdate(uid, { $set: { cashBalance: expected } });
    }
    console.log("---");
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

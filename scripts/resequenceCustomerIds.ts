import connectDB from "../utils/db.js";
import Customer from "../models/Customer.js";
import mongoose from "mongoose";

async function main() {
  await connectDB();
  const apply = process.argv.includes("--apply");
  console.log(`Resequence customerId script (apply=${apply})`);

  const customers = await Customer.find().sort({ createdAt: 1 }).select("_id customerId name createdAt").lean();
  if (!customers || customers.length === 0) {
    console.log("No customers found");
    process.exit(0);
  }

  let nextId = 1;
  const ops: Array<any> = [];

  for (const c of customers) {
    const newId = nextId++;
    if ((c.customerId || 0) !== newId) {
      ops.push({ _id: c._id, old: c.customerId || null, newId });
    }
  }

  if (ops.length === 0) {
    console.log("All customerIds are already sequential starting at 1");
    process.exit(0);
  }

  console.log(`Will update ${ops.length} customers. Preview:`);
  console.table(ops.map(o => ({ id: String(o._id), name: (customers.find(x => String(x._id) === String(o._id))?.name) || '', from: o.old, to: o.newId })));

  if (!apply) {
    console.log("Run with --apply to perform changes. BACKUP your DB before applying.");
    process.exit(0);
  }

  // Apply updates in a transaction if possible
  const db = mongoose.connection?.db;
  let session: any = null;
  let usingTransaction = false;
  try {
    if (db) {
      const admin = db.admin();
      let helloRes: any;
      try { helloRes = await admin.command({ hello: 1 }); } catch (e) { helloRes = await admin.command({ ismaster: 1 }); }
      if (helloRes && (helloRes.setName || helloRes.msg === 'isdbgrid')) {
        session = await mongoose.startSession();
        session.startTransaction();
        usingTransaction = true;
      }
    }
  } catch (e) {
    if (session) try { await session.endSession(); } catch (e) {}
    session = null;
    usingTransaction = false;
  }

  try {
    for (const o of ops) {
      if (usingTransaction && session) {
        await Customer.updateOne({ _id: o._id }, { $set: { customerId: o.newId } }, { session });
      } else {
        await Customer.updateOne({ _id: o._id }, { $set: { customerId: o.newId } });
      }
    }

    // Reset counter to max assigned
    const maxAssigned = nextId - 1;
    const Counter = mongoose.models.Counter || mongoose.model('Counter', new mongoose.Schema({ _id: String, seq: Number }));
    if (usingTransaction && session) {
      await Counter.findByIdAndUpdate('customerId', { $set: { seq: maxAssigned } }, { upsert: true, session });
    } else {
      await Counter.findByIdAndUpdate('customerId', { $set: { seq: maxAssigned } }, { upsert: true });
    }

    // Clear freed id pool for customerId
    const FreeId = mongoose.models.FreeId || mongoose.model('FreeId', new mongoose.Schema({ name: String, value: Number }));
    if (usingTransaction && session) {
      await FreeId.deleteMany({ name: 'customerId' }).session(session);
    } else {
      await FreeId.deleteMany({ name: 'customerId' });
    }

    if (usingTransaction && session) {
      await session.commitTransaction();
      await session.endSession();
    }

    console.log(`Applied ${ops.length} updates. customerId resequenced starting at 1 (max ${maxAssigned}).`);
    process.exit(0);
  } catch (err) {
    if (usingTransaction && session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { await session.endSession(); } catch (e) {}
    }
    console.error('Error applying resequence:', err);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

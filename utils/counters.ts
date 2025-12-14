import mongoose from "mongoose"

/**
 * Counter collection for auto-incrementing IDs
 * More efficient than finding max value on each save
 */
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
})

const Counter = mongoose.models.Counter || mongoose.model("Counter", CounterSchema)

/**
 * Get next sequence number for a given counter name
 * @param name - Counter name (e.g., "customerId", "installmentId")
 * @returns Next sequence number
 */
export async function getNextSequence(name: string): Promise<number> {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  )
  return counter.seq
}

/**
 * Initialize counter with a starting value
 * @param name - Counter name
 * @param startValue - Starting value (default: 0, will return 1 on first call)
 */
export async function initCounter(name: string, startValue: number = 0): Promise<void> {
  await Counter.findByIdAndUpdate(
    name,
    { $set: { seq: startValue } },
    { upsert: true }
  )
}


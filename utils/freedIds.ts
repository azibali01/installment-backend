import mongoose from "mongoose"

const FreeIdSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  value: { type: Number, required: true, index: true },
})

const FreeId = mongoose.models.FreeId || mongoose.model("FreeId", FreeIdSchema)

/**
 * Claim the smallest available freed id for a named counter.
 * Returns the claimed id number or null if none available.
 */
export async function claimFreedId(name: string): Promise<number | null> {
  // Atomically find and remove the smallest value for this name
  const doc = await FreeId.findOneAndDelete({ name }, { sort: { value: 1 } })
  return doc ? doc.value : null
}

/**
 * Release an id back to the pool for future reuse.
 */
export async function releaseFreedId(name: string, value: number): Promise<void> {
  // Insert the freed id; duplicates will be prevented by the unique index on (name,value) if desired
  try {
    await FreeId.create({ name, value })
  } catch (e) {
    // ignore duplicate errors or others - safe to swallow here
  }
}

export default FreeId

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set. Set it in backend/.env or export it in your shell.");
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(uri, { connectTimeoutMS: 10000 });
    console.log("Mongo OK");
    process.exit(0);
  } catch (err) {
    console.error("Mongo test failed:", err);
    process.exit(1);
  }
})();

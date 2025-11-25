import mongoose, { Schema, model } from "mongoose";

export interface IRefreshToken {
    token: string;
    user: mongoose.Types.ObjectId;
    expiresAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>({
    token: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
});

const RefreshToken = model<IRefreshToken>("RefreshToken", refreshTokenSchema);

export default RefreshToken;

import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    // select:false -> the hash never leaks through an accidental query/serialisation.
    passwordHash: { type: String, required: true, select: false },
    // Never settable through the public API; only seed/admin tooling writes this.
    role: { type: String, enum: ROLES, default: 'user', required: true },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

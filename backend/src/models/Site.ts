import { Schema, model } from 'mongoose';

const siteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, default: '' },
    location: { type: String, default: '' },
    // Hard ceiling per day across all slots (informational; slot capacity is what is enforced).
    dailyCapacity: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Site = model('Site', siteSchema);

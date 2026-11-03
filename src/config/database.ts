import mongoose from 'mongoose';
export async function connectDatabase(uri: string): Promise<void> {
  // Filters are built only from validated scalar inputs; range operators are server-owned.
  mongoose.set('sanitizeFilter', false);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    minPoolSize: 1,
  });
}

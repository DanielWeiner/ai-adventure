import { MongoClient } from "mongodb";

const {
    MONGO_USERNAME,
    MONGO_PASSWORD,
    MONGO_DB,
    MONGO_PORT
} = process.env;

export function createMongoClient() {
    return new MongoClient(`mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@db:${MONGO_PORT}`);
}

export function getMongoDatabase(mongoClient: MongoClient) {
    return mongoClient.db(MONGO_DB);
}

let client;
let authClientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  if (!(global as any)._mongoClientPromise) {
    client = createMongoClient();
    (global as any)._mongoClientPromise = client.connect();
  }
  authClientPromise = (global as any)._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  client = createMongoClient();
  authClientPromise = client.connect();
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export { authClientPromise };
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

const {
    MONGO_USERNAME,
    MONGO_PASSWORD,
    MONGO_DB,
    MONGO_HOST,
    MONGO_PORT,
    MONGO_AUTH_DB
} = process.env;

const mongoConnectionString = `mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOST}:${MONGO_PORT}`;

export function createMongoClient() {
    return new MongoClient(mongoConnectionString);
}

export function getMongoDatabase(mongoClient: MongoClient) {
    return mongoClient.db(MONGO_DB);
}

export function getMongoAuthDatabase(mongoClient: MongoClient) {
  return mongoClient.db(MONGO_AUTH_DB);
}

let client;
let authClientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  if (!(global as any)._mongoClientPromise) {
    client = new MongoClient(mongoConnectionString);
    (global as any)._mongoClientPromise = client.connect();
  }
  authClientPromise = (global as any)._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(mongoConnectionString);
  authClientPromise = client.connect();
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export { authClientPromise };

type ApiRouteFn = (req: NextRequest, param: any) => Promise<NextResponse<any>>;

export function mongo(this: any, originalMethod: ApiRouteFn, context: ClassMethodDecoratorContext) {
  if (context.kind === 'method') {
      return async function(this: any, req: NextRequest, param: any) {
          let close = true;
          const mongoClient = createMongoClient();
          await mongoClient.connect();
          const newParams = {
              mongoClient,
              mongoKeepOpen: () => { close = false; },
              ...param?.params ?? null
          };
  
          const result = await originalMethod.call(this, req, { ...param, params: { ...newParams }});

          if (close) {
            await mongoClient.close();
          }
          return result;
      };
  }
}
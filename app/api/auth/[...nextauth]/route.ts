import { authClientPromise } from "@/app/mongo";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google"

const { MONGO_AUTH_DB, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = process.env;

export const authOptions : NextAuthOptions = {
  adapter: MongoDBAdapter(authClientPromise, {
    databaseName: MONGO_AUTH_DB
  }),
  providers: [
    GoogleProvider({
      clientId: GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: GOOGLE_OAUTH_CLIENT_SECRET!
    })
  ],
  session: {
    strategy: "database"
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };


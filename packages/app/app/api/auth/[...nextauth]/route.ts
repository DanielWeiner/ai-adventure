import { authClientPromise } from "@/app/mongo";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google"
import { headers } from "next/headers";
import { NextRequest } from "next/server";

const { 
  MONGO_AUTH_DB, 
  GOOGLE_OAUTH_CLIENT_ID, 
  GOOGLE_OAUTH_CLIENT_SECRET, 
  NEXTAUTH_SECRET,
  APP_HOST,
  APP_PORT
} = process.env;

const authOptions : NextAuthOptions = {
  adapter: MongoDBAdapter(authClientPromise, {
    databaseName: MONGO_AUTH_DB,
  }),
  providers: [
    GoogleProvider({
      clientId: GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: GOOGLE_OAUTH_CLIENT_SECRET!,
    })
  ],
  session: {
    strategy: "database",
  },
  secret: NEXTAUTH_SECRET,
};

const handler = async (req: NextRequest, params: any) => {
  const currentHeaders = headers();
  const referer = currentHeaders.get('Referer');
  const protocol = referer ? new URL(referer).protocol.slice(0, -1) : currentHeaders.get('X-Forwarded-Proto') || 'http';
  const host = currentHeaders.get('Host') || currentHeaders.get('X-Forwarded-Host') || `${APP_HOST}${APP_PORT ? `:${APP_PORT}` : ''}` || 'localhost:3000';
  process.env.NEXTAUTH_URL = `${protocol}://${host}`;

  return NextAuth(authOptions)(req, params);
};

export { handler as GET, handler as POST };
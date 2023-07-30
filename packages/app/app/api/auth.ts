import { cookies } from "next/headers";
import { authClientPromise, getMongoAuthDatabase } from "../mongo";
import { NextRequest, NextResponse } from "next/server";

export interface User {
    id: string;
    name: string;
    email: string;
    image: string;
}

interface DbUser {
    _id: string;
    name: string;
    email: string;
    image: string;
}

interface DbSession {
    _id: string;
    sessionToken: string;
    userId: string;
    expires: Date
}

export interface Session {
    token: string;
    user:  User;
}

async function getAuthDatabase() {
    const authClient = await authClientPromise;
    return getMongoAuthDatabase(authClient);
}

async function getSessionCollection() {
    return (await getAuthDatabase()).collection<DbSession>('sessions');
}

async function getUserCollection() {
    return (await getAuthDatabase()).collection<DbUser>('users');
}


async function getDbSession(sessionToken: string | null) {
    if (!sessionToken) {
        return null;
    }
    const sessions = await getSessionCollection();
    return sessions.findOne({ sessionToken, expires: { $gt: new Date() } });
}

async function getDbUser(userId: string | null) {
    if (!userId) {
        return null;
    }
    const users = await getUserCollection();
    return users.findOne({ _id: userId });
}

export function getSessionToken() : string | null {
    return cookies().get('next-auth.session-token')?.value || cookies().get('__Secure-next-auth.session-token')?.value || null;
}

export async function getSession() : Promise<Session | null> {
    const sessionToken = getSessionToken();
    const dbSession = await getDbSession(sessionToken);
    const dbUser = await getDbUser(dbSession?.userId ?? null);
    if (!sessionToken || !dbSession || !dbUser) {
        return null;
    }

    return {
        token: sessionToken,
        user: {
            id: dbUser._id,
            email: dbUser.email,
            image: dbUser.image,
            name: dbUser.name
        }
    };
}

export async function getUser(): Promise<User | null> {
    const session = await getSession();
    if (!session) {
        return null;
    }

    return session.user;
}

type ApiRouteFn = (req: NextRequest, param: any) => Promise<NextResponse<any>>;

export function authorize(originalMethod: ApiRouteFn, context: ClassMethodDecoratorContext) {
    if (context.kind === 'method') {
        return async function(this: any, req: NextRequest, param: any) {
            const session = await getSession();
            if (!session) {
                return NextResponse.json("Unauthorized", { status: 401 });
            }
    
            const newParams = {
                session,
                ...param?.params ?? null
            };
    
            return originalMethod.call(this, req, { ...param, params: { ...newParams }});
        };
    }
}
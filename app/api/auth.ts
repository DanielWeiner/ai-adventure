import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authClientPromise, getMongoAuthDatabase } from "../mongo";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export interface User {
    id: string;
    name: string;
    email: string;
    image: string;
}

export function getSessionToken() {
    return cookies().get('next-auth.session-token')?.value;
}

export async function getUser(): Promise<User | null> {
    const serverSession = await getServerSession(authOptions);

    if (!serverSession) {
        return null;
    }

    const sessionToken = cookies().get('next-auth.session-token')!.value;
    const mongoAuthClient = await authClientPromise;
    const authDb = getMongoAuthDatabase(mongoAuthClient);
    const sessions = authDb.collection<{ sessionToken: string, userId: string }>('sessions');
    const { userId } = (await sessions.findOne({ sessionToken: sessionToken }))!;

    return {
        id: userId,
        email: serverSession.user!.email!,
        name: serverSession.user!.name!,
        image: serverSession.user!.image!
    };
}
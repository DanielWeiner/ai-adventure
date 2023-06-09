import { NextRequest, NextResponse } from "next/server";
import { getSessionToken, getUser } from "../auth";
import { v4 as uuid } from "uuid";
import { Conversation, getConversationCollection } from "../conversation";
import { createMongoClient } from "@/app/mongo";
import { revalidateTag } from "next/cache";

export async function POST(req: NextRequest) {
    const user = await getUser();
    if (!user) {
        return NextResponse.json("Unauthorized", { status: 400 });
    }
    const sessionToken = getSessionToken();

    const conversation : Conversation = {
        _id: uuid(),
        messages: [],
        userId: user.id
    };

    const mongoClient = createMongoClient();
    await mongoClient.connect();
    const conversations = getConversationCollection(mongoClient);

    await conversations.insertOne(conversation);
    await mongoClient.close();

    revalidateTag(`conversation_${sessionToken}_${conversation._id}`);

    return NextResponse.json(conversation);
}
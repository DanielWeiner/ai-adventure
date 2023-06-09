import { getSessionToken, getUser } from "@/app/api/auth";
import { getConversationCollection, Message } from "@/app/api/conversation";
import { createMongoClient } from "@/app/mongo";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest, { params: { conversationId } } : { params: { conversationId: string } }) {
    const user = await getUser();
    if (!user) {
        return NextResponse.json("Unauthorized", { status: 401 });
    }
    const sessionToken = getSessionToken();

    const { message } = await req.json();
    if (!message) {
        return NextResponse.json("Bad Request", { status: 400 });
    }

    const mongoClient = createMongoClient();
    await mongoClient.connect();

    const conversations = getConversationCollection(mongoClient);

    const conversation = await conversations.findOne({ _id: conversationId });
    if (!conversation) {
        await mongoClient.close();
        return NextResponse.json("Not Found", { status: 404 });
    }

    const newMessage : Message = {
        content: message,
        role: 'user'
    };

    await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
    
    revalidateTag(`conversation_${sessionToken}_${conversationId}`);

    await mongoClient.close();
    
    return NextResponse.json("ok");
}

export async function GET(_: NextRequest, { params: { conversationId } } : { params: { conversationId: string } }) {
    const mongoClient = createMongoClient();
    const conversationCollection = getConversationCollection(mongoClient);
    const conversation = await conversationCollection.findOne({ _id: conversationId });
    mongoClient.close();

    return NextResponse.json((conversation?.messages || []).filter(message => message.role !== 'system'));
}
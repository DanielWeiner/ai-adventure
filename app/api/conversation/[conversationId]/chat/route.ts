import { createMongoClient, getConversationCollection, findOrCreateConversation } from "@/app/conversation";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from 'uuid';

export async function POST(req: NextRequest, { params: { conversationId } } : { params: { conversationId: string } }) {
    const message = await req.json();
    
    if (!message) {
        return NextResponse.json("");
    }

    const mongoClient = createMongoClient();
    const conversations = getConversationCollection(mongoClient);
    await findOrCreateConversation(conversations, conversationId);
    const chatId = uuid();
    await conversations.updateOne({ _id: conversationId }, { $push: { userMessages: { _id: chatId, message } } });
    
    mongoClient.close();
    
    return NextResponse.json(chatId);
}
import { createMongoClient, getConversationCollection } from "@/app/conversation";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_: NextRequest, { params: { conversationId } } : { params: { conversationId: string } }) {
    const mongoClient = createMongoClient();
    const conversationCollection = getConversationCollection(mongoClient);
    const conversation = await conversationCollection.findOne({ _id: conversationId });
    mongoClient.close();

    return NextResponse.json(conversation?.messages || []);
}
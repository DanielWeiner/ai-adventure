import { Session, authorize } from "@/app/api/auth";
import { findRelevantInformation, getConversationCollection, Message, startAssistantPrompt, startSentenceSplitting } from "@/app/api/conversation";
import { mongo } from "@/app/mongo";
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";

class Route {
    @authorize
    @mongo
    async POST(req: NextRequest, { params: { conversationId, session, mongoClient } } : { params: { session: Session, conversationId: string, mongoClient: MongoClient } }) {
        const message = await req.json();
        if (!message) {
            return NextResponse.json("Bad Request", { status: 400 });
        }
    
        const conversations = getConversationCollection(mongoClient);
    
        const conversation = await conversations.findOne({ _id: conversationId, userId: session.user.id });
        if (!conversation) {
            return NextResponse.json("Not Found", { status: 404 });
        }

        const newMessage : Message = {        
            role:                      'user',
            content:                   message,
            id:                        uuid(),
            chatPending:               false,
            splitSentencesPending:     false,
            intentDetectionPending:    false,
            lastSeenChatId:            '',
            lastSeenIntentDetectionId: '',
        };

        await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
        const { messages, purpose } = (await conversations.findOne({ _id: conversationId }))!;
        const openaiMessages = messages.map(({ role, content }) => ({ role, content }));
        const relevantInfo = await findRelevantInformation(conversationId, purpose.type, purpose.context);

        await startAssistantPrompt(mongoClient, conversationId, true, relevantInfo);
        await startSentenceSplitting(openaiMessages, relevantInfo, conversationId);
        
        return NextResponse.json("ok");
    }

    @authorize
    @mongo
    async GET(_: NextRequest, { params: { conversationId, mongoClient, session } } : { params: { conversationId: string, session: Session, mongoClient: MongoClient } }) {
        const conversationCollection = getConversationCollection(mongoClient);
        const conversation = await conversationCollection.findOne({ _id: conversationId, userId: session.user.id });
    
        return NextResponse.json((conversation?.messages || []).filter(message => message.role !== 'system'));
    }
}

export const { GET, POST } = new Route();
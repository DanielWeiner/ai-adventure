import { Session, authorize } from "@/app/api/auth";
import { findRelevantInformation, getConversationCollection, rollbackConversationRevision, startAssistantPrompt } from "@/app/api/conversation";
import { resetNounRevision } from "@/app/api/noun";
import { mongo } from "@/app/mongo";
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";

class Route {
    @authorize
    @mongo
    async PUT(req: NextRequest, { params: { conversationId, messageId, session, mongoClient } } : { params: { session: Session, conversationId: string, messageId: string, mongoClient: MongoClient } }) {
        const message = await req.json() as { content: string; };
        if (!message?.content) {
            return NextResponse.json("Bad Request", { status: 400 });
        }
    
        const conversations = getConversationCollection(mongoClient);
    
        const conversation = await conversations.findOne({ _id: conversationId, userId: session.user.id });
        if (!conversation) {
            return NextResponse.json("Not Found", { status: 404 });
        }

        const foundMessage = conversation.messages.find(message => messageId === message.id);
        if (!foundMessage) {
            return NextResponse.json("Bad Request", { status: 400 });
        }

        const foundRevision = foundMessage.revision;
        if (isNaN(foundRevision)) {
            return NextResponse.json("Bad Request");
        }
        
        const conversationMessages = conversation.messages.filter(({ revision }) => revision === foundRevision);
        const messagesToRetain = conversationMessages.slice(0, conversationMessages.findIndex(({ role }) => role === 'user'));

        await rollbackConversationRevision(mongoClient, conversationId, foundMessage.revision || 0);
        if (conversation.purpose.type === 'create') {
            await resetNounRevision(mongoClient, conversationId, foundRevision);
        }

        messagesToRetain.push({        
            role:         'user',
            content:      message.content,
            id:           uuid(),
            aiPipelineId: '',
            pending:      false,
            revision:     foundRevision
        });

        await conversations.updateOne({ _id: conversationId }, { $push: { messages: {
            $each: messagesToRetain
        } } });
        const { purpose } = (await conversations.findOne({ _id: conversationId }))!;
        const relevantInfo = await findRelevantInformation(conversationId, purpose.type, purpose.context, foundRevision);
        await startAssistantPrompt(mongoClient, conversationId, true, relevantInfo, uuid(), foundRevision);
        
        return NextResponse.json("ok");
    }
}

export const { PUT } = new Route();
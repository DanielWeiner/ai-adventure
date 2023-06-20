import { Session, authorize } from "@/app/api/auth";
import { getConversationCollection, Message } from "@/app/api/conversation";
import { mongo } from "@/app/mongo";
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

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
            content: message,
            role: 'user'
        };
    
        await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
                
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
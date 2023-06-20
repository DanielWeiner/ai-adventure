import { NextRequest, NextResponse } from "next/server";
import { Session, authorize } from "../auth";
import { v4 as uuid } from "uuid";
import { Conversation, ConversationPurpose, getConversationCollection } from "../conversation";
import { mongo } from "@/app/mongo";
import { revalidateTag } from "next/cache";
import { MongoClient } from "mongodb";

class Route {
    @authorize
    @mongo
    async POST(req: NextRequest, { params: { session, mongoClient } } : { params: { session: Session, mongoClient: MongoClient} }) {
        const { purpose = null } = (await req.json() as { purpose: ConversationPurpose | null }) ?? { purpose: null };
        if (!purpose?.context || !purpose?.type) {
            return NextResponse.json("Bad Request", { status: 400 });
        }
    
        const conversation : Conversation = {
            _id: uuid(),
            messages: [],
            userId: session.user.id,
            purpose
        };
    
        const conversations = getConversationCollection(mongoClient);
        await conversations.insertOne(conversation);
        
        return NextResponse.json(conversation);
    }
}

export const { POST } = new Route();
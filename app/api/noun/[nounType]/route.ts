import { getMongoDatabase, mongo } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Session, authorize } from "../../auth";
import { v4 as uuid } from 'uuid';
import { Noun, NounType } from "../../noun";
import { revalidateTag } from "next/cache";
import { Conversation, getConversationCollection } from "../../conversation";
import { MongoClient } from "mongodb";

class Route {
    @authorize
    @mongo
    async GET(request: NextRequest, { params: { nounType, session, mongoClient } } : { params: { nounType: NounType, session: Session, mongoClient: MongoClient} }) {    
        const db = getMongoDatabase(mongoClient);
        const nouns = db.collection<Noun>('nouns');
        
        const resultNouns = await nouns.find({ userId: session.user.id, type: nounType }).toArray();
    
        return NextResponse.json(resultNouns);
    }

    @authorize
    @mongo
    async POST(request: NextRequest, { params: { nounType, session, mongoClient } } : { params: { nounType: NounType, session: Session, mongoClient: MongoClient} }) {
        const db = getMongoDatabase(mongoClient);
        const nouns = db.collection<Noun>('nouns');
        const conversations = getConversationCollection(mongoClient);
    
        const conversation : Conversation = {
            _id: uuid(),
            userId: session.user.id,
            purpose: {
                context: nounType,
                type: 'create'
            },
            messages: []
        };
        await conversations.insertOne(conversation);
    
        const noun : Noun = { 
            _id: uuid(),
            userId: session.user.id, 
            type: nounType,
            conversationId: conversation._id,
            attributes: [],
            name: `New ${nounType}`
        };
    
        await nouns.insertOne(noun);
    
        revalidateTag(`conversation_${session.token}_${conversation._id}`);
        revalidateTag(`noun_${session.token}_${nounType}_${noun._id}`);
        revalidateTag(`noun_${session.token}_${nounType}`);
    
        return NextResponse.json(noun);
    }
}

export const { GET, POST } = new Route();
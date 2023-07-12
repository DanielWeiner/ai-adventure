import { getMongoDatabase, mongo } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Session, authorize } from "../../auth";
import { v4 as uuid } from 'uuid';
import { Noun, NounType } from "../../noun";
import { Conversation, findRelevantInformation, getConversationCollection, startAssistantPrompt } from "../../conversation";
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
            messages: [],
            events: [],
            locked: false
        };
        await conversations.insertOne(conversation);
    
        const noun : Noun = { 
            _id: uuid(),
            userId: session.user.id, 
            type: nounType,
            conversationId: conversation._id,
            traits: [],
            properties: {},
            name: ''
        };
    
        await nouns.insertOne(noun);

        const relevantInfo = await findRelevantInformation(conversation._id, conversation.purpose.type, conversation.purpose.context);
        await startAssistantPrompt(mongoClient, conversation._id, false, relevantInfo);
    
        return NextResponse.json(noun);
    }
}

export const { GET, POST } = new Route();
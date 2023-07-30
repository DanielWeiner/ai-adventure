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
        
        const resultNouns = await nouns.find({ userId: session.user.id, type: nounType }, {
            projection: {
                name: 1, 
                traits: 1, 
                properties: 1, 
                revision: 1, 
                conversationId: 1
            }
        }).toArray();
    
        return NextResponse.json(resultNouns);
    }

    @authorize
    @mongo
    async POST(request: NextRequest, { params: { nounType, session, mongoClient } } : { params: { nounType: NounType, session: Session, mongoClient: MongoClient} }) {
        const db = getMongoDatabase(mongoClient);
        const nouns = db.collection<Noun>('nouns');
        const conversations = getConversationCollection(mongoClient);
    
        const pipelineId = uuid();
        const revision = 0;

        const conversation : Conversation = {
            _id: uuid(),
            userId: session.user.id,
            purpose: {
                context: nounType,
                type: 'create'
            },
            messages: [],
            events: [],
            locked: false,
            revision
        };
        await conversations.insertOne(conversation);
    
        const noun : Noun = { 
            _id: uuid(),
            userId: session.user.id, 
            type: nounType,
            conversationId: conversation._id,
            traits: [],
            properties: {},
            name: '',
            revision,
            revisions: [ {
                name:'',
                traits: [],
                properties: {},
                revision: 0
            }]
        };
    
        await nouns.insertOne(noun);

        const relevantInfo = await findRelevantInformation(conversation._id, conversation.purpose.type, conversation.purpose.context, conversation.revision);
        await startAssistantPrompt(mongoClient, conversation._id, false, relevantInfo, pipelineId, revision);
    
        return NextResponse.json(noun);
    }
}

export const { GET, POST } = new Route();
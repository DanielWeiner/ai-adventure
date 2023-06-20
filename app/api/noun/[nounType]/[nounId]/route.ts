import { Session, authorize } from "@/app/api/auth";
import { getMongoDatabase, mongo } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Noun, NounType } from "../../../noun";
import { revalidateTag } from "next/cache";
import { MongoClient } from "mongodb";
import { Conversation } from "@/app/api/conversation";

class Route {
    @authorize
    @mongo
    async GET(request: NextRequest, { params: { nounType, session, nounId, mongoClient } } : { params: { session: Session, nounType: NounType, nounId: string, mongoClient: MongoClient } }) {            
        const db = getMongoDatabase(mongoClient);
        const nouns = db.collection<Noun>('nouns');
    
        const noun = await nouns.findOne({ userId: session.user.id, type: nounType, _id: nounId });
    
        if (!noun) {
            return NextResponse.json("Not Found", { status: 404 });
        }
    
        return NextResponse.json(noun);
    }

    @authorize
    @mongo
    async DELETE(request: NextRequest, { params: { nounType, nounId, session, mongoClient } } : { params: { session: Session, nounType: NounType, nounId: string, mongoClient: MongoClient } }) {
        const db = getMongoDatabase(mongoClient);
        const nouns = db.collection<Noun>('nouns');
        const conversations = db.collection<Conversation>('conversations');
    
        const existingNoun = await nouns.findOne({ _id: nounId, userId: session.user.id, type: nounType });
        if (!existingNoun) {
            return NextResponse.json("Not Found", { status: 404 });
        }

        await conversations.deleteOne({ _id: existingNoun.conversationId });
        await nouns.deleteOne({ _id: nounId });
        
        return NextResponse.json("ok");
    }

    @authorize
    @mongo
    async PUT(request: NextRequest, { params: { nounType, nounId, session, mongoClient } } : { params: { session: Session, nounType: NounType, nounId: string, mongoClient: MongoClient } }) {
        const nounInput = await request.json() as Noun;
        if (!nounInput?.attributes && !nounInput?.name) {
            return NextResponse.json("Bad Request", { status: 400 });
        }
    
        const db = getMongoDatabase(mongoClient);
        const nouns = db.collection<Noun>('nouns');
    
        const existingNoun = await nouns.findOne({ _id: nounId, userId: session.user.id, type: nounType });
        if (!existingNoun) {
            return NextResponse.json("Not Found", { status: 404 });
        }
    
        const noun = { 
            ...existingNoun,
            ...nounInput,
            userId: session.user.id, 
            type: nounType 
        };
    
        await nouns.replaceOne({ _id: nounId }, noun);
    
        return NextResponse.json(noun);
    }
}

export const { GET, PUT, DELETE } = new Route();
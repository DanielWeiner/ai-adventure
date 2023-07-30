import { Session, authorize } from "@/app/api/auth";
import { getNounCollection } from "@/app/api/noun";
import { mongo } from "@/app/mongo";
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

class Route {
    @authorize
    @mongo
    async GET(request: NextRequest, { params: { conversationId, session, mongoClient } } : { params: { conversationId: string, session: Session, mongoClient: MongoClient }}) {
        const nouns = getNounCollection(mongoClient);
        const noun = await nouns.findOne({ conversationId, userId: session.user.id });
        if (!noun) {
            return NextResponse.json('Not Found', { status: 404 });
        }
        const { _id, name, traits, properties, revision = 0 } = noun;
        return NextResponse.json({ _id, name, traits, properties, revision });
    }
}
export const { GET } = new Route();
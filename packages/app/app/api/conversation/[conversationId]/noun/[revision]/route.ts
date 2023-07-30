import { Session, authorize } from "@/app/api/auth";
import { calculateRevisionProjection, getNounCollection } from "@/app/api/noun";
import { mongo } from "@/app/mongo";
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

class Route {
    @authorize
    @mongo
    async GET(request: NextRequest, { params: { conversationId, session, mongoClient, revision: revisionStr } } : { params: { conversationId: string, session: Session, mongoClient: MongoClient, revision: string }}) {
        const nouns = getNounCollection(mongoClient);
        const revision = parseInt(revisionStr);
        if (isNaN(revision)) {
            return NextResponse.json('Invalid revision', { status: 400 });
        }

        const noun = await nouns.findOne({ conversationId, userId: session.user.id }, {
            projection: calculateRevisionProjection(revision)
        });

        if (!noun) {
            return NextResponse.json('Not Found', { status: 404 });
        }

        const { _id, name, traits, properties } = noun;
        return NextResponse.json({ _id, name, traits, properties, revision: noun.revision });
    }
}
export const { GET } = new Route();
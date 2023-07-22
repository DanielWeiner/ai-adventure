import { cookies } from "next/headers";
import { apiUrl } from "./api";
import { Collection, MongoClient } from "mongodb";
import { getMongoDatabase } from "../mongo";
import { RequestInit } from "next/dist/server/web/spec-extension/request";

export type NounType = 'class' | 'character' | 'faction' | 'location' | 'species' | 'world';

export interface Noun {
    _id:             string;
    userId:          string;
    conversationId:  string;
    type:            NounType;
    name:            string;
    traits:          string[];
    properties: {
        [key in string]: string
    };
    revisions: NounRevision[];
    revision: number;
}

export type NounRevision = Pick<Noun, 'name' | 'traits' | 'properties' | 'revision'>;

export function getNounCollection(mongoClient: MongoClient) : Collection<Noun> {
    return getMongoDatabase(mongoClient).collection<Noun>('nouns');
}

const fetchJson = async <T>(url: string, options?: RequestInit) : Promise<T> => {
    const response = await fetch(apiUrl(url), {
        headers: {
            Cookie: cookies().toString()
        },
        cache: 'no-cache',
        ...options
    });

    if (response.status >= 400) {
        throw new Error(await response.json());
    }

    return response.json();
}

function calculateRevisionField(revision: number, field: string, ...fallbacks: any[]) {
    return {
        [field]: {
            $ifNull: [
                {
                    $getField: {
                        input: {
                            $arrayElemAt: [
                                {
                                    $filter: {
                                        input: '$revisions',
                                        as:    'revision',
                                        cond: {
                                            $eq: ['$$revision.revision', revision]
                                        }
                                    }
                                },
                                0
                            ]
                        },
                        field: field
                    }
                },
                `$${field}`,
                ...fallbacks
            ]
        }
    }
}

export function calculateRevisionProjection(revision: number) {
    return {
        ...calculateRevisionField(revision, 'name'),
        ...calculateRevisionField(revision, 'traits'),
        ...calculateRevisionField(revision, 'properties'),
        ...calculateRevisionField(revision, 'revision', 0)
    };
}

export async function resetNounRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const nouns = getNounCollection(mongoClient);
    const noun = (await nouns.findOne({ conversationId }, {
        projection: {
            ...calculateRevisionProjection(revision),
            revisions: {
                $ifNull: [
                    {
                        $filter: {
                            input: '$revisions',
                            as:    'revision',
                            cond: {
                                $lte: ['$$revision.revision', revision]
                            }
                        }
                    },
                    []
                ]
            }
        }
    }))!;

    await nouns.updateOne({ _id: noun._id }, {
        $set: {
            properties: noun.properties,
            traits:     noun.traits,
            revisions:  noun.revisions,
            revision:   revision
        },
    });
}

export async function getNounRevision(mongoClient: MongoClient, conversationId: string, revision: number) : Promise<NounRevision | null> {
    const nouns = getNounCollection(mongoClient);
    return nouns.findOne({ conversationId }, calculateRevisionProjection(revision));
}

export async function updateNounRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const nouns = getNounCollection(mongoClient);
    const { _id, name = '', properties = {}, traits = [] } = await nouns.findOne({ conversationId }) ?? {};

    if (!_id) {
        return;
    }

    await nouns.updateOne({ _id },{
        $set: {
            revision
        },
        $push: {
            revisions: {
                name,
                properties,
                traits,
                revision
            }
        }
    });
}

export const getNouns = (nounType: NounType) => fetchJson<Noun[]>(`noun/${nounType}`);
export const getNoun = (nounType: NounType, nounId: string) => fetchJson<Noun | null>(`noun/${nounType}/${nounId}`);
export const getConversationNoun = (conversationId: string) => fetchJson<Noun | null>(`conversation/${conversationId}/noun`);
export const getConversationNounRevision = (conversationId: string, revision: number) => fetchJson<NounRevision | null>(`conversation/${conversationId}/noun/${revision}`);
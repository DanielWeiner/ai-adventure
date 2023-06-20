import { cookies } from "next/headers";
import { getSessionToken } from "../api/auth";
import { Message, getMessages } from "../api/conversation";
import { Noun, NounType, getNoun, getNouns } from "../api/noun";

export interface CreationPageState {
    sessionToken: string;
    nounType:     NounType | "";
    noun:         Noun | null;
    messages:     Message[];
    nouns:        Noun[];
};

export async function generateInitialState({ pageName, nounId } : { pageName: NounType, nounId: string }) : Promise<CreationPageState> {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
        console.log(cookies().toString());
        return { sessionToken: "", nounType: "", noun: null, messages: [], nouns: [] };
    }

    if (!['character', 'class', 'faction', 'location', 'species', 'world'].includes(pageName)) {
        return { sessionToken, nounType: "", noun: null, messages: [], nouns: [] };
    }
    
    if (!nounId) {
        return { sessionToken, nounType: pageName, noun: null, messages: [], nouns: [] };
    }

    const [ nouns, noun ] = await Promise.all([ 
        getNouns(pageName), 
        getNoun(pageName, nounId).catch(() => null)
    ]);

    if (!noun) {
        return { sessionToken, nounType: pageName, noun: null, nouns, messages: [] };
    }

    return { sessionToken, nounType: pageName, noun, nouns, messages: await getMessages(sessionToken, noun.conversationId) };
}
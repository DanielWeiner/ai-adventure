import { getSessionToken } from "../api/auth";
import { Message, getMessages } from "../api/conversation";
import { Noun, NounType, getNoun, getNouns } from "../api/noun";

export interface CreationPageState {
    sessionToken:    string;
    nounType:        NounType | "";
    noun:            Noun | null;
    messages:        Message[];
    nouns:           Noun[];
    awaitingNewNoun: boolean;
};

export async function generateInitialState({ pageName, nounId } : { pageName: NounType, nounId: string }) : Promise<CreationPageState> {
    const sessionToken = getSessionToken();
    const awaitingNewNoun = nounId === 'new';

    if (!['character', 'class', 'faction', 'location', 'species', 'world'].includes(pageName)) {
        return { sessionToken: sessionToken || "", nounType: "", noun: null, messages: [], nouns: [], awaitingNewNoun: false };
    }

    if (!sessionToken) {
        return { sessionToken: "", nounType: pageName, noun: null, messages: [], nouns: [], awaitingNewNoun: false };
    }

    if (!nounId) {
        return { sessionToken, nounType: pageName, noun: null, messages: [], nouns: [], awaitingNewNoun: false };
    }

    const [ nouns, noun ] = await Promise.all([ 
        getNouns(pageName), 
        awaitingNewNoun ? Promise.resolve(null) : getNoun(pageName, nounId).catch(() => null)
    ]);

    if (!noun) {
        return { sessionToken, nounType: pageName, noun: null, nouns, messages: [], awaitingNewNoun };
    }

    return { sessionToken, nounType: pageName, noun, nouns, messages: await getMessages(noun.conversationId), awaitingNewNoun };
}
import { notFound } from "next/navigation";
import CreationPage from "../creationPage";
import ChatBox from "@/app/components/chatbox";
import { apiUrl } from "@/app/api/api";
import { getSessionToken } from "@/app/api/auth";
import { Noun } from "@/app/api/noun/noun";
import { Message } from "@/app/api/conversation/conversation";
import { cookies } from "next/headers";

async function getMessages(conversationId: string) {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
        return null;
    }

    const response = await fetch(apiUrl(`conversation/${conversationId}/messages`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { 
            tags: [ `conversation_${sessionToken}_${conversationId}` ] 
        } 
    });

    return response.json();
}

async function getNouns(nounType: string) {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
        return null;
    }

    const response = await fetch(apiUrl(`noun/${nounType}`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { tags: [`noun_${sessionToken}_${nounType}`] } 
    });

    return response.json();
}

const ucFirst = (str: string) => str[0].toUpperCase() + str.slice(1);

export default async function Create({ params: { pageName } } : { params: { pageName: string } }) {
    if (!['character', 'class', 'faction', 'location', 'species', 'world'].includes(pageName)) {
        return notFound();
    }

    const messages : Message[] = await getMessages(pageName);
    const nouns : Noun[] = await getNouns(pageName);

    console.log(nouns);

    return(
        <CreationPage pageName={pageName}>
            <section className="w-2/12">
                <ul className="flex flex-col">
                    {
                        nouns.map(({ name }, i) => (
                            <li key={i}>{name}</li>
                        ))
                    }
                    <li key="new">New {ucFirst(pageName)}</li>
                </ul>
            </section>
            <section className="w-6/12">
                <ChatBox conversationId={pageName} purpose={{ context: pageName, type: 'create' }} initialChatLog={messages} />
            </section>

            <section className="w-4/12">

            </section>
        </CreationPage>
    )
}
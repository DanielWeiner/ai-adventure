import { notFound } from "next/navigation";
import CreationPage from "../creationPage";
import ChatPanel from "./chatPanel";
import CreationPageWrapper from "../wrapper";
import { generateInitialState } from "../state";

export default async function Create({ params: { pageName  } } : { params: { pageName: string } }) {
    const initialState = await generateInitialState({ pageName,  nounId: "" });
    const { sessionToken, nounType} = initialState;
    
    if (!nounType || !sessionToken) {
        return notFound();
    }

    return(
        <CreationPage pageName={nounType}>
            <CreationPageWrapper initialState={initialState}>
                <ChatPanel />
            </CreationPageWrapper>
        </CreationPage>
    )
}
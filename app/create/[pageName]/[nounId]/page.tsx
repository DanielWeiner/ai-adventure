import { notFound, redirect } from "next/navigation";
import CreationPage from "../../creationPage";
import ChatPanel from "../chatPanel";
import { generateInitialState } from "../../state";
import CreationPageWrapper from "../../wrapper";
import { NounType } from "@/app/api/noun";

export default async function Create({ params: { pageName, nounId } } : { params: { pageName: NounType, nounId: string } }){
    const initialState = await generateInitialState({ pageName, nounId });
    const { sessionToken, nounType, noun } = initialState;
    
    if (!nounType || !sessionToken) {
        return notFound();
    }

    if (!noun) {
        return redirect(`/create/${nounType}`);
    }

    return(
        <CreationPage pageName={nounType}>
            <CreationPageWrapper initialState={initialState}>
                <ChatPanel />
            </CreationPageWrapper>
        </CreationPage>
    )
}
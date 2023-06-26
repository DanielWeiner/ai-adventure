import { notFound } from "next/navigation";
import CreationPage from "../creationPage";
import ChatPanel from "./chatPanel";
import CreationPageWrapper from "../wrapper";
import { generateInitialState } from "../state";
import { NounType } from "@/app/api/noun";

export default async function Create({ params: { pageName  } } : { params: { pageName: NounType } }) {
    const initialState = await generateInitialState({ pageName,  nounId: "" });
    const { nounType} = initialState;
    
    if (!nounType) {
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
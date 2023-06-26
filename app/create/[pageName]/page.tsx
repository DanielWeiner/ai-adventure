import { notFound } from "next/navigation";
import CreationPage from "../creationPage";
import ChatPanel from "./chatPanel";
import CreationPageWrapper from "../wrapper";
import { generateInitialState } from "../state";
import { NounType } from "@/app/api/noun";

export default async function Create({ params: { pageName  } } : { params: { pageName: NounType } }) {
    const initialState = await generateInitialState({ pageName,  nounId: "" });
    const { nounType, sessionToken } = initialState;
    
    if (!nounType) {
        return notFound();
    }

    return(
        <CreationPage pageName={nounType}>
            {
                sessionToken ? 
                    <CreationPageWrapper initialState={initialState}>
                        <ChatPanel />
                    </CreationPageWrapper> : 
                    <div className="w-full h-full flex justify-center items-center">
                        <span>Please log in to start creating.</span>
                    </div>
            }
        </CreationPage>
    )
}
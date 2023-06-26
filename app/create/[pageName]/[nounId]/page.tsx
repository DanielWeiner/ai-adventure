import { notFound, redirect } from "next/navigation";
import CreationPage from "../../creationPage";
import ChatPanel from "../../../components/chatPanel";
import { generateInitialState } from "../../state";
import CreationPageWrapper from "../../wrapper";
import { NounType } from "@/app/api/noun";

export default async function Create({ params: { pageName, nounId } } : { params: { pageName: NounType, nounId: string } }){
    const initialState = await generateInitialState({ pageName, nounId });
    const { nounType, noun, sessionToken } = initialState;
    
    if (!nounType) {
        return notFound();
    }

    if (!noun) {
        return redirect(`/create/${nounType}`);
    }

    return (
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
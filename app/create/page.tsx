import { getSessionToken } from "../api/auth";
import CreationPage from "./creationPage";

export default function CreateDashboard() {
    const sessionToken = getSessionToken();

    return <CreationPage pageName="">
        {
            sessionToken ? <div className="flex h-full w-full justify-center items-center">
                <p className="text-center">Create your world with the help of AI! Select a category to get started.</p>
            </div> : 
            <div className="w-full h-full flex justify-center items-center">
                <span>Please log in to start creating.</span>
            </div>
        }
        
    </CreationPage>
}
import React from "react"
import { CreationPageState } from "./state"

const CreateContext = React.createContext<CreationPageState>({
    messages: [],
    noun: null,
    nouns: [],
    nounType: "",
    sessionToken: '',
    awaitingNewNoun: false
});

export default CreateContext;

export function useCreationContext() {
    return React.useContext(CreateContext);
}
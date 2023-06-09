'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { CreationPageState } from "./state";
import CreateContext from "./context";

const queryClient = new QueryClient();

export default function CreationPageWrapper({ initialState, children } : { initialState: CreationPageState, children?: React.ReactNode}) {
    return (
        <CreateContext.Provider value={initialState}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </CreateContext.Provider>
    )
}
import React from "react";

export default function Main({ children } : { children: React.ReactNode}) {
    return (
        <main className="justify-center px-4 py-0 flex-grow relative">
            <div className="absolute top-0 right-0 left-0 bottom-0">
                {children}
            </div>
        </main>
    );
}
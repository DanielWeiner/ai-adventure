import React from "react";

export default function Main({ children } : { children: React.ReactNode}) {
    return (
        
        <main className="justify-center px-4 py-0">{children}</main>
    );
}
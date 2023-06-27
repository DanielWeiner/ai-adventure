import React from "react";
import { CharacterIcon, SpeciesIcon } from "../components/icons";
import { ClassIcon } from "../components/icons";
import { FactionIcon } from "../components/icons";
import { LocationIcon, WorldIcon } from "../components/icons";
import Link from "next/link";

const createNavLinkComponent = (pageName: string) => ({ nounType, tooltip, icon: Icon } : { nounType: string, tooltip: string, icon: React.FC<{className?: string, size: string}>}) => (
    <Link 
        href="/create/[pageName]" 
        as={`/create/${nounType}`} 
        {...pageName === nounType ? { 'aria-current': 'page' } : {} } 
        className="max-lg:max-h-[16.666666666667vw] p-1 flex flex-1 flex-col font-medium text-xs text-center [&[aria-current=page]]:bg-slate-500 lg:border-b max-lg:border-r lg:last:border-b-0 max lg:last:border-r-0 border-slate-500"
    >
        <Icon size="auto" className="flex-grow max-h-20" />
        <span>
            { tooltip }
        </span> 
    </Link>
);

export default function CreationPage({ pageName, children } : { pageName: string, children?: React.ReactNode }) {
    const NavLink = createNavLinkComponent(pageName);

    return (
        <div className="flex flex-col lg:flex-row w-full h-full">
            <div className="lg:max-w-[5rem] border-gray-200 lg:border-gray-300 dark:border-gray-700 border-b-2 lg:border-b-0">
                <nav className="flex mr-0 max-w-full lg:-mr-0.5 flex-row lg:flex-col -mb-0.5 lg:mb-0 justify-evenly lg:justify-normal lg:space-x-0">
                    <NavLink icon={WorldIcon} nounType="world" tooltip="Worlds" />
                    <NavLink icon={LocationIcon} nounType="location" tooltip="Locations" />
                    <NavLink icon={FactionIcon} nounType="faction" tooltip="Factions" />
                    <NavLink icon={SpeciesIcon} nounType="species" tooltip="Species" />
                    <NavLink icon={ClassIcon} nounType="class" tooltip="Classes" />
                    <NavLink icon={CharacterIcon} nounType="character" tooltip="Characters" />
                </nav>
            </div>
            {children}
        </div>
    );
}
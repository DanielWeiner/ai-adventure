import React from "react";
import { CharacterIcon, SpeciesIcon } from "../components/icons";
import { ClassIcon } from "../components/icons";
import { FactionIcon } from "../components/icons";
import { LocationIcon, WorldIcon } from "../components/icons";
import Link from "next/link";

const iconSize = '48';

const NavLink = ({ pageName, nounType, tooltip, Icon } : { pageName: string, nounType: string, tooltip: string, Icon: React.FC<{className?: string, size: string}>}) => (
    <Link href="/create/[pageName]" as={`/create/${nounType}`} {...pageName === nounType ? { 'aria-current': 'page' } : {} } className="hs-tooltip [--placement:bottom] lg:[--placement:right] [&[aria-current=page]]:bg-slate-500 p-2">
        <Icon className="hs-tooltip-toggle" size={iconSize} />

        <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-sm font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
            { tooltip }
        </span> 
    </Link>
)

export default function CreationPage({ pageName, children } : { pageName: string, children?: React.ReactNode }) {
    return (
        <div className="flex flex-col lg:flex-row w-full h-full">
            <div className="lg:max-w-[5rem] border-gray-200 lg:border-gray-300 dark:border-gray-700 border-b-2 lg:border-b-0">
                <nav className="flex mr-0 lg:-mr-0.5 flex-row lg:flex-col space-y-0 lg:space-y-2 -mb-0.5 lg:mb-0 justify-evenly lg:justify-normal space-x-6 lg:space-x-0">
                    <NavLink Icon={WorldIcon} nounType="world" pageName={pageName} tooltip="Worlds" />
                    <NavLink Icon={LocationIcon} nounType="location" pageName={pageName} tooltip="Locations" />
                    <NavLink Icon={FactionIcon} nounType="faction" pageName={pageName} tooltip="Factions" />
                    <NavLink Icon={SpeciesIcon} nounType="species" pageName={pageName} tooltip="Species" />
                    <NavLink Icon={ClassIcon} nounType="class" pageName={pageName} tooltip="Classes" />
                    <NavLink Icon={CharacterIcon} nounType="character" pageName={pageName} tooltip="Characters" />
                </nav>
            </div>
            {children}
        </div>
    );
}
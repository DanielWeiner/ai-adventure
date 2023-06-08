import React from "react";
import { CharacterIcon, SpeciesIcon } from "../components/icons";
import { ClassIcon } from "../components/icons";
import { FactionIcon } from "../components/icons";
import { LocationIcon, WorldIcon } from "../components/icons";
import Link from "next/link";

const iconSize = '48';

export default function CreationPage({ pageName, children } : { pageName: string, children?: React.ReactNode }) {
    return (
        <div className="flex flex-row w-full h-full">
            <nav className="flex flex-col flex-shrink bg-slate-400 text-slate-800">
                <Link href="/create/world" data-active={pageName === 'world'} className="hs-tooltip [--placement:right] p-4 border-b-2 border-b-slate-500 [&[data-active=true]]:bg-slate-500">
                    <WorldIcon className="hs-tooltip-toggle" size={iconSize} />

                    <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
                        Worlds
                    </span> 
                </Link>
                <Link href="/create/location" data-active={pageName === 'location'} className="hs-tooltip [--placement:right] p-4 border-b-2 border-b-slate-500 [&[data-active=true]]:bg-slate-500">
                    <LocationIcon className="hs-tooltip-toggle" size={iconSize} />

                    <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
                        Locations
                    </span>
                </Link>
                <Link href="/create/faction" data-active={pageName === 'faction'} className="hs-tooltip [--placement:right] p-4 border-b-2 border-b-slate-500 [&[data-active=true]]:bg-slate-500">
                    <FactionIcon className="hs-tooltip-toggle" size={iconSize} />

                    <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
                        Factions
                    </span>
                </Link>
                <Link href="/create/species" data-active={pageName === 'species'} className="hs-tooltip [--placement:right] p-4 border-b-2 border-b-slate-500 [&[data-active=true]]:bg-slate-500">
                    <SpeciesIcon className="hs-tooltip-toggle" size={iconSize} />

                    <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
                        Species
                    </span>
                </Link>
                <Link href="/create/class" data-active={pageName === 'class'} className="hs-tooltip [--placement:right] p-4 border-b-2 border-b-slate-500 [&[data-active=true]]:bg-slate-500">
                    <ClassIcon className="hs-tooltip-toggle" size={iconSize} />

                    <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
                        Classes
                    </span>
                </Link>
                <Link href="/create/character" data-active={pageName === 'character'} className="hs-tooltip [--placement:right] p-4 border-b-2 border-b-slate-500 [&[data-active=true]]:bg-slate-500">
                    <CharacterIcon className="hs-tooltip-toggle" size={iconSize} />

                    <span className="hs-tooltip-content hs-tooltip-shown:opacity-100 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-md shadow-sm dark:bg-slate-700" role="tooltip">
                        Characters
                    </span>
                </Link>
            </nav>
            <section className="flex flex-row flex-grow h-full">{children}</section>
        </div>
    );
}
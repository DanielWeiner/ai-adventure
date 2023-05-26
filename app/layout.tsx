import './globals.css'
import { Inter } from 'next/font/google'
import React from 'react'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Talk to a Mob Boss',
  description: 'Have a conversation with a mob boss, powered by OpenAI API and GPT-3.5',
}

export default function RootLayout({ children } : { children : React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-100`}>{children}</body>
    </html>
  )
}

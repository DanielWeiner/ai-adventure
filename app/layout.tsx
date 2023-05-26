import './globals.css'
import { Inter } from 'next/font/google'
import React from 'react'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'AI Adventure',
  description: 'Create an AI Adventure.',
}

export default function RootLayout({ children } : { children : React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-100`}>{children}</body>
    </html>
  )
}
